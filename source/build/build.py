#!/usr/bin/env python3
"""Assemble les 2 fichiers du projet Apps Script (Code.gs et Index.html).

    python3 app/build/build.py               → app/dist/            (version du groupe SLV)
    python3 app/build/build.py --generique   → app/dist-generique/  (version pour un nouveau groupe)
    python3 app/build/build.py --generique --sortie /chemin/dossier

La version générique utilise seed_generique.js (lignes, règles et unités standard,
budget vide, groupe à renseigner) et n'intègre pas de logo.
"""
import argparse
import base64
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
SRC = RACINE / "src"
VERSION = (RACINE / "VERSION").read_text(encoding="utf-8").strip() if (RACINE / "VERSION").exists() else "dev"


def lire(nom):
    return (SRC / nom).read_text(encoding="utf-8")


def construire(generique=False, sortie=None):
    generique = generique or not (SRC / "seed.js").exists()   # dépôt public : seulement la version générique
    dist = Path(sortie) if sortie else RACINE / ("dist-generique" if generique else "dist")
    dist.mkdir(parents=True, exist_ok=True)
    seed = "seed_generique.js" if generique else "seed.js"
    entete = (f"/* Budget du groupe — version {VERSION}{' (générique)' if generique else ''}\n"
              " * FICHIER GÉNÉRÉ par app/build/build.py — modifier app/src/ puis relancer le build. */\n\n")
    code = entete + lire("engine.js") + "\n\n" + lire(seed) + "\n\n" + lire("Code.gs")
    code = code.replace("/*VERSION*/", VERSION)
    (dist / "Code.gs").write_text(code, encoding="utf-8")

    html = lire("index.html")
    html = html.replace("<script>\n/*SEED_NONE*/\n</script>\n", "")
    for marque, contenu in (("/*STYLES*/", lire("styles.css")), ("/*ENGINE*/", lire("engine.js")), ("/*APP*/", lire("app.js"))):
        assert marque in html, marque
        html = html.replace(marque, contenu)
    html = html.replace("/*VERSION*/", VERSION)
    # Logo du groupe SLV (app/src/logo.png) intégré dans sa version ; les autres groupes l'envoient dans Paramètres › Groupe
    logo = SRC / "logo.png"
    if logo.exists() and not generique:
        html = html.replace("/*LOGO*/", "data:image/png;base64," + base64.b64encode(logo.read_bytes()).decode())
    assert "</script" not in lire("engine.js") + lire("app.js")
    (dist / "Index.html").write_text(html, encoding="utf-8")
    for f in ("Code.gs", "Index.html"):
        print(f"{dist.name}/{f} : {(dist / f).stat().st_size // 1024} ko")
    return dist


if __name__ == "__main__":
    a = argparse.ArgumentParser()
    a.add_argument("--generique", action="store_true")
    a.add_argument("--sortie")
    o = a.parse_args()
    construire(o.generique, o.sortie)
