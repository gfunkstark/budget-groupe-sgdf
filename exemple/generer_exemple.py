"""Exports Comptaweb fictifs d'un « Groupe Exemple » (3 saisons) pour la démonstration et les captures.
Aucune donnée réelle : montants et intitulés inventés, pas de noms de personnes."""
import random, csv, datetime as dt, sys
from pathlib import Path

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent; OUT.mkdir(parents=True, exist_ok=True)
ENT = "Date;Compte bancaire 1;Rapprochée 1;Compte bancaire 2;Rapprochée 2;Saison écriture bancaire;Intitulé;Dépense;Devise dépense;Recette;Devise recette;N° de pièce;Mode de transaction;Catégorie tiers;Structure tiers;Type;Nature;Activité;Branche/Pôle;Dépense ventilation;Devise dépense ventilation;Recette ventilation;Devise recette ventilation".split(";")
UNITES = {"Farfadets": 12, "Louveteaux-Jeannettes": 36, "Scouts-Guides": 40, "Pionniers-Caravelles": 26, "Compagnons": 10}
COMPAS = ["Compagnons - Les Baroudeurs", "Compagnons - Cap au Sud"]

def saison(annee, fin=None, facteur=1.0, seed=1):
    rnd = random.Random(seed)
    lignes, numeros = [], {}
    lib = f"Sept {annee} - Août {annee + 1}"
    def piece(d):
        k = d.strftime("%Y%m%d"); numeros[k] = numeros.get(k, 0) + 1; return f"{k}_{numeros[k]}"
    def ecr(d, intitule, ventils, mode="Carte bancaire", tiers="Autre : pas structure SGDF", avec_piece=True):
        if fin and d > fin: return
        dep = round(sum(v[3] for v in ventils), 2); rec = round(sum(v[4] for v in ventils), 2)
        rap = "Oui" if (fin is None or (fin - d).days > 25 or rnd.random() < .6) else "Non"
        p = piece(d) if (avec_piece and dep > 0 and mode not in ("Prélèvement",)) else ""
        base = [d.strftime("%d/%m/%Y"), "GROUPE EXEMPLE", rap, "", "", "", intitule]
        lignes.append(base + [f"{dep:.2f}".replace(".", ",") if dep else "", "EUR" if dep else "", f"{rec:.2f}".replace(".", ",") if rec else "", "EUR" if rec else "", p, mode, tiers, "National" if tiers == "Echelon National" else "", "Ecriture", "", "", "", "", "", "", ""])
        for (nat, act, br, dv, rv) in ventils:
            b2 = [d.strftime("%d/%m/%Y"), "GROUPE EXEMPLE", rap, "", "", lib, intitule, "", "", "", "", "", mode, tiers, "", "Ventilation", nat, act, br,
                  f"{dv:.2f}".replace(".", ",") if dv else "", "EUR" if dv else "", f"{rv:.2f}".replace(".", ",") if rv else "", "EUR" if rv else ""]
            lignes.append(b2)
    D = lambda m, j: dt.date(annee + (1 if m < 9 else 0), m, j)
    f = facteur
    # Inscriptions (septembre-octobre)
    for k in range(14):
        d = D(9 if k < 9 else 10, 3 + 2 * k % 27)
        part = round(rnd.uniform(600, 1900) * f, 2); cot = round(part * .42, 2); don = round(rnd.choice([0, 0, 50, 120]) * f, 2)
        v = [("Participation Activités (camp, we...)", "Inscriptions", "Groupe", 0, part), ("Cotisations SGDF", "Inscriptions", "Groupe", 0, cot)]
        if don: v.append(("Dons avec Reçu Fiscal", "Inscriptions", "Groupe", 0, don))
        ecr(d, f"Groupe - Inscriptions - Chèques et virements lot {k + 1}", v, mode=rnd.choice(["Chèque", "Virement"]))
    # Prélèvement du National (octobre et février)
    for d, coef in ((D(10, 15), .7), (D(2, 10), .3)):
        jeunes = sum(UNITES.values()) + 20
        v = [("Cotisations SGDF", "Inscriptions", "National", round(jeunes * 140 * coef * f, 2), 0), ("Assurances", "Fonctionnement", "Groupe", round(240 * coef, 2), 0)]
        if coef > .5:
            v += [("Participation au Fct du Territoire", "Participation au Mouvement", "Groupe", round(jeunes * 5, 2), 0), ("Participation au FSI", "Participation au Mouvement", "Groupe", round(jeunes * 5, 2), 0),
                  ("Péréquation", "Participation au Mouvement", "Groupe", round(jeunes * 2, 2), 0), ("Participation au Fct du Mouvement", "Participation au Mouvement", "Groupe", round(jeunes * 24, 2), 0)]
        ecr(d, f"Regroupement de prélèvements nationaux du {d.strftime('%d/%m/%Y')}", v, mode="Virement", tiers="Echelon National", avec_piece=False)
    # Sorties et week-ends d'unité
    for u, n in UNITES.items():
        for k in range(rnd.randint(5, 8)):
            d = D(rnd.choice([10, 11, 12, 1, 2, 3, 4, 5, 6]), rnd.randint(1, 27))
            m = round(n * rnd.uniform(3, 9) * f, 2)
            ecr(d, f"{u} - {rnd.choice(['Sortie', 'WE unité', 'Activité'])} - {rnd.choice(['Courses', 'Transport', 'Entrées', 'Matériel'])}",
                [(rnd.choice(["Alimentation, Intendance", "Transport collectif en commun (RER, métro, Tram, bus, etc. )", "Achat Petit Matériel", "Activités, sorties, visites"]), rnd.choice(["Sorties & Activités", "Week-end d'Unité"]), u, m, 0)],
                mode=rnd.choice(["Carte bancaire", "Carte procurement"]))
    # Week-ends de groupe
    for act, m0, nb, tot in (("Week-end de Rentrée", 9, 1, 3800), ("Week-end de Groupe", 3, 1, 5200), ("Week-end de Maitrise", 1, 1, 1100)):
        d = D(m0, 20)
        for nat, part in (("Hébergement, séminaire", .15), ("Transport collectif : en Autocar", .45), ("Location Véhicule/Bateau", .06), ("Carburant", .02), ("Alimentation, Intendance", .25), ("Achat Petit Matériel", .07)):
            ecr(d, f"Groupe - {act} - {nat.split(',')[0].split(':')[0].strip()}", [(nat, act, "Groupe", round(tot * part * f * rnd.uniform(.9, 1.1), 2), 0)], mode=rnd.choice(["Virement", "Carte bancaire"]))
    # Calendriers (décembre)
    for k in range(5):
        u = list(UNITES)[k]
        ecr(D(12, 3 + k * 4), f"{u} - Calendriers - Dépôt ventes", [("Ventes de produits", "Calendriers", u, 0, round(rnd.uniform(500, 1400) * f, 2))], mode="Chèque")
    # Fonctionnement : frais bancaires, internet, matériel
    for m in [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8]:
        ecr(D(m, 5), "Groupe - Frais bancaires mensuels", [("Frais Bancaires", "Frais bancaires", "Groupe", round(18 * f, 2), 0)], mode="Prélèvement", avec_piece=False)
        ecr(D(m, 8), "Groupe - Abonnement stockage en ligne", [("Frais communication et Internet", "Fonctionnement", "Groupe", 2.99, 0)])
    for k in range(4):
        ecr(D(rnd.choice([9, 11, 2, 5]), rnd.randint(1, 25)), "Groupe - Matériel - " + rnd.choice(["Tentes", "Pharmacie", "Malles", "Gamelles"]),
            [("Achat Matériel Pédagogique", "Fonctionnement", "Groupe", round(rnd.uniform(80, 420) * f, 2), 0)])
    ecr(D(11, 18), "Groupe - Formations - Stages des chefs", [("Formation", "Formations", "Groupe", round(980 * f, 2), 0)], mode="Virement")
    ecr(D(10, 2), "Groupe - Conseil de groupe - Collation", [("Alimentation, Intendance", "Réunions (conseils et préparations)", "Groupe", 64.5, 0)])
    # Camps (été) et extra-jobs des Compagnons
    for u in list(UNITES)[1:4]:
        ecr(D(7, 6), f"{u} - Camps - Familles", [("Participation Activités (camp, we...)", "Camps en France", u, 0, round(UNITES[u] * 210 * f, 2))], mode="Virement")
        for nat, part in (("Hébergement, séminaire", .3), ("Alimentation, Intendance", .45), ("Transport collectif : en Autocar", .25)):
            ecr(D(7, 22), f"{u} - Camps - {nat.split(',')[0].split(':')[0].strip()}", [(nat, "Camps en France", u, round(UNITES[u] * 210 * part * f * rnd.uniform(.9, 1.05), 2), 0)], mode="Carte bancaire")
    for c in COMPAS:
        for k in range(4):
            ecr(D(rnd.choice([10, 11, 12, 2, 3, 4]), rnd.randint(1, 26)), f"{c.split(' - ')[1]} - Extrajob - {rnd.choice(['Vente de gâteaux', 'Baby-sitting', 'Emballage cadeaux'])}",
                [("Extra-Jobs", "Extrajobs divers", c, 0, round(rnd.uniform(150, 600), 2))], mode="Chèque")
    # Dépôt d'espèces (mouvement interne)
    ecr(D(10, 12), "Groupe - Dépôt espèces", [("Dépôts, retrait espèces", "Fonctionnement", "Groupe", 300, 300)], mode="Espèces", avec_piece=False)
    lignes.sort(key=lambda l: (dt.datetime.strptime(l[0], "%d/%m/%Y"), l[6], l[15] != "Ecriture"), reverse=False)
    # Comptaweb liste l'écriture puis ses ventilations, du plus récent au plus ancien
    blocs, cur = [], None
    for l in lignes:
        if l[15] == "Ecriture": cur = [l]; blocs.append(cur)
        else: cur.append(l)
    blocs.sort(key=lambda b: dt.datetime.strptime(b[0][0], "%d/%m/%Y"), reverse=True)
    return [l for b in blocs for l in b]

for annee, fin, fac, seed in ((2024, None, .92, 11), (2025, None, 1.0, 12), (2026, dt.date(2026, 10, 20), 1.04, 13)):
    rows = saison(annee, fin, fac, seed)
    with open(OUT / f"comptaweb_{annee}-{str(annee + 1)[2:]}.csv", "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh, delimiter=";"); w.writerow(ENT); w.writerows(rows)
    print(annee, len(rows))
