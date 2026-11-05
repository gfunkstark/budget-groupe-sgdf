import os
import time
import logging
import pandas as pd
from dotenv import load_dotenv
from io import StringIO
from bs4 import BeautifulSoup

# Selenium
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import TimeoutException
from webdriver_manager.chrome import ChromeDriverManager

# Google
import gspread
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

# ======================
# CONFIG
# ======================
load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DOWNLOAD_DIR = os.path.join(BASE_DIR, "downloads")
LOG_DIR = os.path.join(BASE_DIR, "logs")

os.makedirs(DOWNLOAD_DIR, exist_ok=True)
os.makedirs(LOG_DIR, exist_ok=True)

LOGIN_URL = "https://sgdf.production.sirom.net/"
TARGET_URL = "https://comptaweb.sgdf.fr/recettedepense?m=1"
EXERCISE_URL = "https://comptaweb.sgdf.fr/exercice?m=1"
STATS_URL = "https://comptaweb.sgdf.fr/statistiqueslibres?m=1"
BANQUE_URL = "https://comptaweb.sgdf.fr/mouvementsbancaires"

USERNAME = os.getenv("SGDF_USERNAME")
PASSWORD = os.getenv("SGDF_PASSWORD")
SERVICE_ACCOUNT_FILE = os.getenv("SGDF_SERVICE_ACCOUNT_FILE")
SPREADSHEET_URL = os.getenv("SPREADSHEET_URL")
EXPECTED_PERIOD = os.getenv("EXPECTED_PERIOD")
PAUSE_SECONDS = int(os.getenv("PAUSE_SECONDS", "5"))
# Requête de statistiques Comptaweb servant au rapprochement (facultative)
REQUETE_STATS = os.getenv("COMPTAWEB_REQUETE") or "GS - Check Export Trésoriers"

# ======================
# LOGGING
# ======================
LOG_FILE = os.path.join(LOG_DIR, f"pipeline_{time.strftime('%Y-%m-%d_%H-%M-%S')}.log")
logging.basicConfig(filename=LOG_FILE, level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

def log(msg):
    print(msg)
    logging.info(msg)

# ======================
# DRIVER
# ======================
def create_driver(headless=True):
    options = Options()
    if headless:
        options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-gpu")
        options.add_argument("--disable-blink-features=AutomationControlled")

    prefs = {
        "download.default_directory": DOWNLOAD_DIR,
        "download.prompt_for_download": False,
    }
    options.add_experimental_option("prefs", prefs)
    options.add_argument("--window-size=1920,1080")

    # Sur GitHub Actions : Service() sans chemin → Selenium Manager choisit
    # le chromedriver assorti au Chrome installé. En local : webdriver_manager.
    if os.getenv("GITHUB_ACTIONS") == "true":
        return webdriver.Chrome(service=Service(), options=options)
    return webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

# ======================
# GOOGLE CLIENTS
# ======================
def get_gspread():
    creds = Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE,
        scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    return gspread.authorize(creds)


def get_drive():
    creds = Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE,
        scopes=[
            "https://www.googleapis.com/auth/drive.readonly",
            "https://www.googleapis.com/auth/spreadsheets"
        ]
    )
    return build("drive", "v3", credentials=creds)

# ======================
# COMMON ACTIONS
# ======================
def login(driver):
    log("Logging in...")
    driver.get(LOGIN_URL)
    wait = WebDriverWait(driver, 20)

    wait.until(EC.presence_of_element_located((By.ID, "username"))).send_keys(USERNAME)
    driver.find_element(By.ID, "password").send_keys(PASSWORD)
    driver.find_element(By.ID, "kc-login").click()


def ensure_period(driver, period=None):
    period = period or EXPECTED_PERIOD
    wait = WebDriverWait(driver, 20)
    period_div = wait.until(EC.presence_of_element_located(
        (By.XPATH, "//div[@title='Structure et exercice actuellement sélectionnés']")
    ))

    if period not in period_div.text:
        log(f"Période actuelle: {period_div.text.strip()}")
        log("Switching period...")
        driver.get(EXERCISE_URL)

        select = Select(wait.until(EC.presence_of_element_located(
            (By.ID, "exercice_change_identifiants_exercices")
        )))
        select.select_by_visible_text(period)

        # Chercher et cliquer le bouton submit
        btn = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, "input[type='submit'], button[type='submit']")))
        driver.execute_script("arguments[0].click();", btn)
        log("Période mise à jour.")
    else:
        log("Period already correct.")

# ======================
# APPLICATION « BUDGET DU GROUPE »
# ======================
# Si le classeur contient l'onglet « Saisons » (créé par l'application Apps Script),
# le robot écrit dans l'onglet de la saison courante, avec en-têtes en ligne 1,
# et note chaque passage dans « Journal robot ». Sinon : comportement historique.
APP_ONGLET_STATS = "Stats Comptaweb"
APP_ONGLET_FICHIERS = "Fichiers Drive"
APP_ONGLET_JOURNAL = "Journal robot"
APP_ONGLET_BANQUE = "Banque Comptaweb"


def read_app_config():
    """Saison courante lue dans l'onglet Saisons, ou None (ancien classeur)."""
    sheet = get_gspread().open_by_url(SPREADSHEET_URL)
    try:
        ws = sheet.worksheet("Saisons")
    except gspread.WorksheetNotFound:
        return None
    rows = ws.get_all_values()
    if len(rows) < 2:
        return None
    head = [h.strip().lower() for h in rows[0]]
    def col(name):
        for i, h in enumerate(head):
            if h.startswith(name):
                return i
        return None
    i_code, i_tab, i_cur, i_ex = col("saison"), col("onglet"), col("courante"), col("exercice")
    saisons = []
    for r in rows[1:]:
        r = r + [""] * len(head)
        if r[i_code].strip():
            saisons.append({"saison": r[i_code].strip(), "onglet": r[i_tab].strip(),
                            "exercice": r[i_ex].strip() if i_ex is not None else "",
                            "courante": r[i_cur].strip().lower() in ("oui", "true", "vrai", "1")})
    cour = [x for x in saisons if x["courante"]]
    if not cour:
        raise ValueError("Onglet Saisons présent mais aucune saison marquée Courante = Oui.")
    cfg = dict(cour[0]); cfg["exercice"] = cfg["exercice"] or EXPECTED_PERIOD
    # Saison précédente : réexportée aussi, car on continue d'y rapprocher des écritures (chèques encaissés en septembre…)
    avant = sorted([x for x in saisons if x["saison"] < cfg["saison"] and x["exercice"] and x["onglet"]], key=lambda x: x["saison"])
    cfg["precedente"] = avant[-1] if avant else None
    log(f"Application Budget : saison {cfg['saison']} → onglet « {cfg['onglet']} », exercice « {cfg['exercice']} »"
        + (f" ; saison précédente {cfg['precedente']['saison']} réexportée aussi" if cfg["precedente"] else ""))
    return cfg


def worksheet_or_create(sheet, name):
    try:
        return sheet.worksheet(name)
    except gspread.WorksheetNotFound:
        return sheet.add_worksheet(title=name, rows=100, cols=20)


def write_journal(cfg, nb, statut):
    try:
        sheet = get_gspread().open_by_url(SPREADSHEET_URL)
        ws = worksheet_or_create(sheet, APP_ONGLET_JOURNAL)
        from datetime import datetime, timezone
        ws.append_row([datetime.now(timezone.utc).isoformat(timespec="seconds"), cfg["saison"], nb, statut[:200]],
                      value_input_option="RAW")
    except Exception as e:  # le journal ne doit jamais faire échouer le robot
        log(f"Journal non écrit : {e}")


# ======================
# STEP 1: CSV EXPORT
# ======================
def download_csv(driver):
    log("Downloading CSV...")

    # Nettoyer les anciens CSV avant de commencer
    for f in os.listdir(DOWNLOAD_DIR):
        if f.endswith(".csv"):
            os.remove(os.path.join(DOWNLOAD_DIR, f))

    driver.get(TARGET_URL)
    wait = WebDriverWait(driver, 20)

    try:
        wait.until(EC.presence_of_element_located((By.ID, "exportCSV"))).click()
    except TimeoutException:
        log(f"TIMEOUT - current URL: {driver.current_url}")
        log(f"Page title: {driver.title}")
        driver.save_screenshot(os.path.join(BASE_DIR, "error_csv_page.png"))
        with open(os.path.join(BASE_DIR, "error_csv_page.html"), "w", encoding="utf-8") as f:
            f.write(driver.page_source)
        raise
        
    wait.until(EC.element_to_be_clickable((By.ID, "depenserecette_export_generer"))).click()

    file_path = None
    timeout = 60
    elapsed = 0
    while not file_path and elapsed < timeout:
        for f in os.listdir(DOWNLOAD_DIR):
            if f.endswith(".csv") and not f.endswith(".crdownload"):
                file_path = os.path.join(DOWNLOAD_DIR, f)
                break
        time.sleep(1)
        elapsed += 1

    if not file_path:
        raise TimeoutError("CSV download did not complete within 60 seconds.")

    return file_path


def upload_csv_to_sheet(file_path, cfg=None):
    log("Uploading CSV to Sheets...")

    # En mode application, tout est lu en texte (n° de pièce, dates jj/mm/aaaa intacts).
    dtype = str if cfg else None
    try:
        df = pd.read_csv(file_path, sep=";", encoding="latin1", dtype=dtype, keep_default_na=not cfg)
    except Exception:
        df = pd.read_csv(file_path, dtype=dtype)

    client = get_gspread()
    sheet = client.open_by_url(SPREADSHEET_URL)
    ws = worksheet_or_create(sheet, cfg["onglet"]) if cfg else sheet.worksheet(os.getenv("SHEET_COMPTA"))

    # Numeric conversion
    numeric_cols = ["Dépense", "Recette", "Dépense ventilation", "Recette ventilation"]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(
                df[col].astype(str).str.replace(",", ".", regex=False),
                errors="coerce"
            ).fillna(0)

    df = df.replace([float("inf"), float("-inf")], 0)
    df = df.fillna("")

    if cfg:
        if len(df) == 0:
            raise ValueError("Export Comptaweb vide : onglet laissé tel quel.")
        ws.clear()
        ws.update(values=[df.columns.tolist()] + df.values.tolist(), range_name="A1", value_input_option="RAW")
    else:
        ws.update(values=df.values.tolist(), range_name="A3")
    log(f"CSV uploaded: {len(df)} rows.")

    os.remove(file_path)
    return len(df)

# ======================
# STEP 2: STATS SCRAPING
# ======================
def scrape_stats(driver):
    log("Scraping stats...")
    driver.get(STATS_URL)
    wait = WebDriverWait(driver, 20)

    select = Select(wait.until(EC.presence_of_element_located((By.NAME, "requete_a_choisir"))))
    select.select_by_visible_text(REQUETE_STATS)

    # OLD - breaks if label changes even slightly
    #driver.find_element(By.CSS_SELECTOR, "input[value='Afficher les paramètres de la requête sélectionnée']").click()

    # NEW - partial match, won't break on minor label changes
    btn = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, "input[value*='Afficher les param']")))
    driver.execute_script("arguments[0].click();", btn)
    
    # Wait for DOM to settle after partial reload, then re-locate _submit
    time.sleep(2)
    submit_btn = wait.until(EC.element_to_be_clickable((By.ID, "_submit")))
    driver.execute_script("arguments[0].click();", submit_btn)

    time.sleep(PAUSE_SECONDS)

    soup = BeautifulSoup(driver.page_source, "html.parser")
    table = soup.find("table")

    if not table:
        raise ValueError("Stats table not found in page source.")

    rows = []
    for tr in table.find_all("tr"):
        cells = []
        for td in tr.find_all(["td", "th"]):
            btn = td.find("button")
            inp = td.find("input")
            if btn:
                cells.append(btn.get_text(strip=True))
            elif inp:
                cells.append(inp.get("value", "").strip())
            else:
                cells.append(td.get_text(strip=True))
        if cells:
            rows.append(cells)

    if not rows:
        raise ValueError("No rows found in stats table.")

    headers = rows[0]
    data = rows[1:]
    df = pd.DataFrame(data, columns=headers)
    log(f"Scraped stats: {df.shape[0]} rows x {df.shape[1]} cols")
    return df


def upload_stats(df, cfg=None):
    log("Uploading stats to Sheets...")
    client = get_gspread()
    sheet = client.open_by_url(SPREADSHEET_URL)
    ws = worksheet_or_create(sheet, APP_ONGLET_STATS) if cfg else sheet.worksheet(os.getenv("SHEET_STATS"))

    df = df.replace([float("inf"), float("-inf")], 0)
    df = df.fillna("")

    if cfg:
        ws.clear()
        ws.update(values=[df.columns.tolist()] + df.values.tolist(), range_name="A1")
    else:
        ws.update(values=[df.columns.tolist()] + df.values.tolist(), range_name="Q1")
    log("Stats uploaded.")


# ======================
# STEP 2 bis: MOUVEMENTS BANCAIRES NON RAPPROCHÉS
# ======================
def attendre_csv(timeout=60):
    for _ in range(timeout):
        for f in os.listdir(DOWNLOAD_DIR):
            if f.endswith(".csv"):
                return os.path.join(DOWNLOAD_DIR, f)
        time.sleep(1)
    raise TimeoutError("Export des mouvements bancaires non téléchargé en 60 s.")


def download_banque(driver):
    """Exporte, pour chaque compte bancaire du groupe, les mouvements non rapprochés."""
    log("Mouvements bancaires non rapprochés...")
    driver.get(BANQUE_URL)
    wait = WebDriverWait(driver, 20)
    select = Select(wait.until(EC.presence_of_element_located((By.NAME, "comptebancaire"))))
    comptes = [(o.get_attribute("value"), o.text.strip()) for o in select.options if o.get_attribute("value")]
    if not comptes:
        raise ValueError("Aucun compte bancaire dans la liste.")
    lignes, entete = [], None
    for valeur, libelle in comptes:
        for f in os.listdir(DOWNLOAD_DIR):
            if f.endswith(".csv"):
                os.remove(os.path.join(DOWNLOAD_DIR, f))
        select = Select(wait.until(EC.presence_of_element_located((By.NAME, "comptebancaire"))))
        select.select_by_value(valeur)          # la page se recharge (submit du formulaire)
        time.sleep(PAUSE_SECONDS)
        try:
            bouton = WebDriverWait(driver, 10).until(EC.element_to_be_clickable(
                (By.XPATH, "//button[contains(normalize-space(.), 'Export CSV')]")))
        except TimeoutException:
            if driver.find_elements(By.CSS_SELECTOR, "table tbody tr"):
                raise                            # des mouvements affichés mais pas de bouton : on ne conclut rien
            log(f"  {libelle.split(' - ')[-1].strip()} : aucun mouvement non rapproché")
            driver.get(BANQUE_URL)
            continue
        bouton.click()
        df = pd.read_csv(attendre_csv(), sep=";", encoding="latin1", dtype=str, keep_default_na=False)
        entete = entete or df.columns.tolist()
        df = df.reindex(columns=entete, fill_value="")
        lignes += df.values.tolist()
        log(f"  {libelle.split(' - ')[-1].strip()} : {len(df)} mouvement(s) non rapproché(s)")
        driver.get(BANQUE_URL)
    return entete, lignes


def upload_banque(entete, lignes):
    sheet = get_gspread().open_by_url(SPREADSHEET_URL)
    ws = worksheet_or_create(sheet, APP_ONGLET_BANQUE)
    ws.clear()
    ws.update(values=[entete] + lignes, range_name="A1", value_input_option="RAW")
    log("Mouvements bancaires envoyés.")

# ======================
# STEP 3: DRIVE FILE LIST
# ======================
def list_drive_files(folder_id):
    log("Listing Drive files...")
    service = get_drive()

    files = []
    page_token = None
    while True:
        response = service.files().list(
            q=f"'{folder_id}' in parents and trashed=false",
            fields="nextPageToken, files(id, name, webViewLink)",
            pageToken=page_token
        ).execute()
        for f in response.get("files", []):
            lien = f.get("webViewLink") or f"https://drive.google.com/file/d/{f['id']}/view"
            files.append([f["name"], f["id"], lien])
        page_token = response.get("nextPageToken")
        if not page_token:
            break

    log(f"Found {len(files)} files in Drive folder.")
    return files


def upload_drive_files(data, cfg=None):
    log("Uploading Drive file list to Sheets...")
    client = get_gspread()
    sheet = client.open_by_url(SPREADSHEET_URL)
    ws = worksheet_or_create(sheet, APP_ONGLET_FICHIERS) if cfg else sheet.worksheet(os.getenv("SHEET_FILES"))

    if cfg:
        # Nom, identifiant et lien : l'application ouvre la pièce depuis le Réalisé
        ws.clear()
        ws.update(values=[["File Name", "Id", "Lien"]] + data, range_name="A1")
    else:
        ws.update(values=[["File Name"]] + [[r[0]] for r in data], range_name="A1")
    log("Drive file list uploaded.")

# ======================
# MAIN PIPELINE
# ======================
def main():
    log("=== START PIPELINE ===")

    cfg = read_app_config()
    driver = create_driver(headless=True)
    nb = ""

    try:
        login(driver)
        ensure_period(driver, cfg["exercice"] if cfg else None)

        # Step 1 — CSV export
        csv_file = download_csv(driver)
        nb = upload_csv_to_sheet(csv_file, cfg)

        # Step 2 — Stats scraping (facultatif : si la requête n'existe pas, on continue)
        try:
            stats_df = scrape_stats(driver)
            upload_stats(stats_df, cfg)
        except Exception as e:
            if not cfg:
                raise
            log(f"Requête « {REQUETE_STATS} » ignorée : {e}")

        # Step 2 bis — Mouvements bancaires non rapprochés (facultatif)
        if cfg:
            try:
                upload_banque(*download_banque(driver))
            except Exception as e:
                log(f"Mouvements bancaires ignorés : {e}")

        # Step 2 ter — Saison précédente (facultatif) : rapprochements faits depuis son import
        if cfg and cfg.get("precedente") and os.getenv("RAFRAICHIR_SAISON_PRECEDENTE", "oui").lower() not in ("non", "false", "0"):
            prec = cfg["precedente"]
            try:
                ensure_period(driver, prec["exercice"])
                n_prec = upload_csv_to_sheet(download_csv(driver), prec)
                log(f"Saison {prec['saison']} réexportée : {n_prec} lignes.")
            except Exception as e:
                log(f"Saison précédente non réexportée : {e}")
            finally:
                try:
                    ensure_period(driver, cfg["exercice"])   # on laisse Comptaweb sur l'exercice courant
                except Exception as e:
                    log(f"Retour à l'exercice courant impossible : {e}")

        # Step 3 — Drive file list (facultatif : DRIVE_FOLDER_ID vide = pas de contrôle des justificatifs)
        folder_id = os.getenv("DRIVE_FOLDER_ID")
        if folder_id:
            files = list_drive_files(folder_id)
            upload_drive_files(files, cfg)
        else:
            log("DRIVE_FOLDER_ID non renseigné : liste des justificatifs ignorée.")

        if cfg:
            write_journal(cfg, nb, "OK")
        log("=== SUCCESS ===")

    except Exception as e:
        log(f"ERROR: {e}")
        if cfg:
            write_journal(cfg, nb, f"Erreur : {e}")
        driver.save_screenshot(os.path.join(BASE_DIR, "error.png"))
        raise

    finally:
        driver.quit()
        log("Driver closed.")


if __name__ == "__main__":
    main()
