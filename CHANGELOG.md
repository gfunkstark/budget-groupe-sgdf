# Nouveautés

## 1.1.0 — novembre 2026

- **Rapprochement bancaire** : le robot récupère chaque matin, pour chaque compte du groupe, les opérations bancaires non rapprochées de Comptaweb (page Mouvements bancaires).
  Les Contrôles les mettent en regard des écritures non rapprochées : paires à rapprocher (même montant, dates proches), opérations du relevé sans écriture, écritures sans opération.
- Alerte dans la Synthèse pour les dépenses passées en banque mais pas encore saisies, nouvelle étape dans la routine du mois, rubrique dans l'e-mail du lundi.
- **Mise à jour** : remplacer `Code.gs`, `Index` **et** `robot/Budget.py` dans le dépôt privé du robot.

## 1.0.0 — octobre 2026

Première version partagée avec les groupes du territoire.

- Synthèse budget / réel N-1, N-2 / réalisé / à venir / projeté
- Budget des dépenses et des recettes, saisie guidée, versions figées et budget de référence
- Réalisé classé automatiquement par règles, corrections ponctuelles
- Engagements à venir, rapprochés automatiquement des écritures
- Contrôles : rapprochement Comptaweb, justificatifs manquants, dépôt de justificatif, attestation sur l'honneur (PDF), écritures non rapprochées
- Routine du mois, e-mail récapitulatif du lundi
- Camps et flux hors budget par unité, fonds des équipes Compagnons
- Identité du groupe (nom, logo, adresse) réglable, vérification des mises à jour
- Robot Comptaweb facultatif (GitHub Actions)
