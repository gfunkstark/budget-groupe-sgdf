/* =====================================================================
 * Données de départ « génériques » pour un nouveau groupe SGDF.
 * Utilisées une seule fois, par la fonction installer(). Tout se modifie
 * ensuite dans l'application (Paramètres › Lignes, Règles, Unités…).
 * La saison en cours est créée automatiquement à l'installation.
 * ===================================================================== */
var Seed = (function () {
  var S = "Sorties, Activités & WE d'unité";
  var UNIF = 'Uniformes et insignes';

  // Façon de saisir le budget des dépenses (vide = montant)
  var SAISIE = {};
  SAISIE[S] = 'par_unite';
  ['Week-end de Groupe', 'Week-end de Rentrée', 'Week-end de Maîtrise'].forEach(function (l) { SAISIE[l] = 'weekend'; });
  SAISIE['Repas de maîtrise'] = 'diner';
  SAISIE['Participation au Mouvement'] = 'par_jeune';

  // ligne, recette (affichée en recettes), section des dépenses, hors budget
  var lignes = [
    ['Participation au Groupe', true, '', false],
    ['Calendriers', true, '', false],
    ['Dons', true, '', false],
    ['Subventions', true, '', false],
    ['Recettes diverses', true, '', false],
    [UNIF, true, 'Fonctionnement', false],
    ['Formation', true, 'Fonctionnement', false],
    [S, false, 'Activités', false],
    ['Week-end de Groupe', false, 'Activités', false],
    ['Week-end de Rentrée', false, 'Activités', false],
    ['Week-end de Maîtrise', false, 'Activités', false],
    ['Repas de maîtrise', false, 'Activités', false],
    ['Participation aux camps', false, 'Activités', false],
    ['Matériel du groupe', false, 'Fonctionnement', false],
    ['Assurances', false, 'Fonctionnement', false],
    ['Frais bancaires', false, 'Fonctionnement', false],
    ['Communication et Internet', false, 'Fonctionnement', false],
    ['Participation au Mouvement', false, 'Fonctionnement', false],
    ['Fonctionnement divers', false, 'Fonctionnement', false],
    ['Camps', false, '', true],
    ['Extrajobs', false, '', true],
    ['Cotisations SGDF', false, '', true],
    ['Ajustements n-1', false, '', true]
  ].map(function (l, i) {
    return { ligne: l[0], recette: l[1], section: l[2], horsBudget: l[3], ordre: (i + 1) * 10, budget: SAISIE[l[0]] || '' };
  });

  // activité Comptaweb, nature ('*' = toutes), ligne de budget — à compléter avec les activités du groupe
  var regles = [
    ['*', 'Dépôts, retrait espèces', '(Mouvement interne)'],
    ['Inscriptions', '*', 'Participation au Groupe'],
    ['Inscriptions', 'Cotisations SGDF', 'Cotisations SGDF'],
    ['Inscriptions', 'Dons avec Reçu Fiscal', 'Dons'],
    ['Calendriers', '*', 'Calendriers'],
    ['Sorties & Activités', '*', S],
    ["Week-end d'Unité", '*', S],
    ["Week-end d'équipe", '*', S],
    ['Week-end de Groupe', '*', 'Week-end de Groupe'],
    ['Week-end de Rentrée', '*', 'Week-end de Rentrée'],
    ['Week-end de Maitrise', '*', 'Week-end de Maîtrise'],
    ['Camps en France', '*', 'Camps'],
    ["Camps à l'étranger", '*', 'Camps'],
    ['Participation aux Camps', '*', 'Participation aux camps'],
    ['Extrajobs divers', '*', 'Extrajobs'],
    ['Formations', '*', 'Formation'],
    ['Frais bancaires', '*', 'Frais bancaires'],
    ['Participation au Mouvement', '*', 'Participation au Mouvement'],
    ['Ajustements', '*', 'Ajustements n-1'],
    ['Réunions (conseils et préparations)', '*', 'Fonctionnement divers'],
    ['Fonctionnement', '*', 'Fonctionnement divers'],
    ['Fonctionnement', 'Assurances', 'Assurances'],
    ['Fonctionnement', 'Frais Bancaires', 'Frais bancaires'],
    ['Fonctionnement', 'Frais communication et Internet', 'Communication et Internet'],
    ['Fonctionnement', 'Formation', 'Formation'],
    ['Fonctionnement', 'Dons avec Reçu Fiscal', 'Dons'],
    ['Fonctionnement', 'Recettes diverses', 'Recettes diverses'],
    ['Fonctionnement', 'Achat Matériel Pédagogique', 'Matériel du groupe'],
    ['Fonctionnement', 'Achat Petit Matériel', 'Matériel du groupe']
  ].map(function (r) { return { activite: r[0], nature: r[1], ligne: r[2] }; });

  // Branche/Pôle Comptaweb → unité suivie (à adapter aux unités du groupe)
  var unites = [
    ['Farfadets', 'Farfadets'], ['Louveteaux', 'Louveteaux-Jeannettes'], ['Jeannettes', 'Louveteaux-Jeannettes'], ['Louveteaux-Jeannettes', 'Louveteaux-Jeannettes'],
    ['Scouts', 'Scouts-Guides'], ['Guides', 'Scouts-Guides'], ['Scouts-Guides', 'Scouts-Guides'],
    ['Pionniers', 'Pionniers-Caravelles'], ['Caravelles', 'Pionniers-Caravelles'], ['Pionniers-Caravelles', 'Pionniers-Caravelles'],
    ['Compagnons', 'Compagnons'], ['Groupe', 'Groupe'], ['National', 'National']
  ].map(function (u, i) { return { branche: u[0], unite: u[1], ordre: (i + 1) * 10 }; });

  return {
    saisons: [], lignes: lignes, regles: regles, unites: unites, effectifs: [], budget: [],
    groupe: { nom: '', court: '', adresse: '', ville: '' }, depot: ''
  };
})();

if (typeof module !== 'undefined') module.exports = Seed;
