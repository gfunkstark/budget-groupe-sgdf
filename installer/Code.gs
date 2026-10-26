/* Budget du groupe — version 1.0.0 (générique)
 * FICHIER GÉNÉRÉ par app/build/build.py — modifier app/src/ puis relancer le build. */

/* =====================================================================
 * Moteur de calcul — Budget du groupe (Scouts et Guides de France)
 * Partagé tel quel par le serveur (Code.gs), l'interface (Index) et les tests.
 * Aucune dépendance à Apps Script ni au navigateur.
 * ===================================================================== */
var Engine = (function () {

  /* ------------------------------------------------------------ utilitaires */
  function txt(v) { return v === null || v === undefined ? '' : String(v).replace(/\s+$/, '').replace(/^\s+/, ''); }
  function cle(v) { return txt(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' '); }

  /** Nombre depuis une cellule (nombre, "1 234,56", "(12)", "-", ""). */
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = txt(v).replace(/[   €]/g, '');
    if (!s || s === '-') return 0;
    var neg = /^\(.*\)$/.test(s);
    s = s.replace(/[()]/g, '');
    if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.replace(/\./g, '');
    s = s.replace(',', '.');
    var n = parseFloat(s);
    if (!isFinite(n)) return 0;
    return neg ? -n : n;
  }
  function arrondi(n) { return Math.round(n * 100) / 100; }

  /** Date ISO yyyy-mm-dd depuis "dd/mm/yyyy", Date, ou ISO. */
  function dateIso(v) {
    if (v instanceof Date) {
      return v.getFullYear() + '-' + ('0' + (v.getMonth() + 1)).slice(-2) + '-' + ('0' + v.getDate()).slice(-2);
    }
    var s = txt(v), m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[0] : '';
  }

  /* ------------------------------------------------- import des écritures */
  // En-têtes de l'export Comptaweb « recettes / dépenses ».
  var COLS = {
    date: 'Date', compte: 'Compte bancaire 1', rappro: 'Rapprochée 1', compte2: 'Compte bancaire 2',
    rappro2: 'Rapprochée 2', intitule: 'Intitulé', depense: 'Dépense', recette: 'Recette',
    piece: 'N° de pièce', mode: 'Mode de transaction', tiersCat: 'Catégorie tiers',
    tiers: 'Structure tiers', type: 'Type', nature: 'Nature', activite: 'Activité',
    branche: 'Branche/Pôle', depV: 'Dépense ventilation', recV: 'Recette ventilation'
  };

  /** Index des colonnes à partir d'une ligne d'en-têtes (tolérant accents/espaces). */
  function indexEntetes(entetes) {
    var idx = {}, cles = entetes.map(cle);
    Object.keys(COLS).forEach(function (k) {
      var i = cles.indexOf(cle(COLS[k]));
      if (i < 0 && k === 'branche') i = cles.indexOf('branche');
      idx[k] = i;
    });
    var manquantes = ['date', 'intitule', 'type', 'nature', 'activite', 'branche', 'depV', 'recV']
      .filter(function (k) { return idx[k] < 0; });
    if (manquantes.length) throw new Error('Colonnes Comptaweb introuvables : ' + manquantes.map(function (k) { return COLS[k]; }).join(', '));
    return idx;
  }

  /**
   * Transforme les lignes brutes de l'export (tableau de tableaux, en-têtes en
   * première ligne) en écritures et ventilations. Chaque ventilation est
   * rattachée à l'écriture qui la précède dans l'export.
   */
  function lireExport(lignes) {
    if (!lignes || !lignes.length) return { ecritures: [], ventilations: [] };
    var idx = indexEntetes(lignes[0]);
    var g = function (r, k) { return idx[k] >= 0 ? r[idx[k]] : ''; };
    var ecritures = [], ventilations = [], courante = null, vus = {};
    for (var i = 1; i < lignes.length; i++) {
      var r = lignes[i], type = cle(g(r, 'type'));
      if (type === 'ecriture') {
        courante = {
          id: 'E' + ecritures.length, date: dateIso(g(r, 'date')), intitule: txt(g(r, 'intitule')),
          depense: num(g(r, 'depense')), recette: num(g(r, 'recette')), piece: txt(g(r, 'piece')),
          mode: txt(g(r, 'mode')), tiersCat: txt(g(r, 'tiersCat')), tiers: txt(g(r, 'tiers')),
          compte: txt(g(r, 'compte')), rappro: txt(g(r, 'rappro')), compte2: txt(g(r, 'compte2')),
          rappro2: txt(g(r, 'rappro2')), nbVentil: 0
        };
        ecritures.push(courante);
      } else if (type === 'ventilation') {
        var v = {
          date: dateIso(g(r, 'date')), intitule: txt(g(r, 'intitule')), nature: txt(g(r, 'nature')),
          activite: txt(g(r, 'activite')), branche: txt(g(r, 'branche')),
          depense: num(g(r, 'depV')), recette: num(g(r, 'recV')),
          ecriture: courante && courante.intitule === txt(g(r, 'intitule')) ? courante.id : '',
          piece: txt(g(r, 'piece'))
        };
        if (courante && v.ecriture) { courante.nbVentil++; if (!v.piece) v.piece = courante.piece; }
        // Clé stable pour les corrections manuelles : contenu + rang parmi les doublons.
        var base = [v.date, v.intitule, v.nature, v.activite, v.branche, v.depense, v.recette].join('|');
        vus[base] = (vus[base] || 0) + 1;
        v.cle = base + '#' + vus[base];
        ventilations.push(v);
      }
    }
    return { ecritures: ecritures, ventilations: ventilations };
  }

  /* ------------------------------------------------------- classement */
  var INTERNE = '(Mouvement interne)';

  /**
   * Règles : [{activite, nature, ligne}] — '*' = n'importe laquelle.
   * Priorité : activité+nature exactes > nature seule > activité seule.
   */
  function compilerRegles(regles) {
    var exact = {}, parNature = {}, parActivite = {};
    (regles || []).forEach(function (r) {
      var a = cle(r.activite), n = cle(r.nature), l = txt(r.ligne);
      if (!l) return;
      if (a && a !== '*' && n && n !== '*') exact[a + '¦' + n] = l;
      else if ((!a || a === '*') && n && n !== '*') parNature[n] = l;
      else if (a && a !== '*') parActivite[a] = l;
    });
    return function (activite, nature) {
      var a = cle(activite), n = cle(nature);
      return exact[a + '¦' + n] || parNature[n] || parActivite[a] || '';
    };
  }

  /** Branche/Pôle Comptaweb → unité suivie. */
  function compilerUnites(unites) {
    var m = {};
    (unites || []).forEach(function (u) { if (txt(u.branche)) m[cle(u.branche)] = txt(u.unite); });
    return function (branche) {
      var b = cle(branche);
      if (m[b]) return m[b];
      if (b.indexOf('compagnons') === 0) return m['compagnons'] || 'Compagnons';
      return txt(branche) || 'Groupe';
    };
  }

  /**
   * Classe toutes les ventilations. corrections : {cle: ligne} pour les
   * exceptions saisies une par une.
   */
  function classer(ventilations, regles, unites, corrections) {
    var regle = compilerRegles(regles), unite = compilerUnites(unites), corr = corrections || {};
    return ventilations.map(function (v) {
      var ligne = corr[v.cle], source = 'correction';
      if (!ligne) { ligne = regle(v.activite, v.nature); source = ligne ? 'regle' : 'aucune'; }
      var o = {};
      for (var k in v) o[k] = v[k];
      o.ligne = ligne; o.source = source; o.unite = unite(v.branche);
      return o;
    });
  }

  /* -------------------------------------------------------- budget */
  /** Effectifs : [{saison, unite, jeunes}] → fonction (saison, unite) → nombre. */
  function compilerEffectifs(effectifs) {
    var m = {};
    (effectifs || []).forEach(function (e) {
      var s = txt(e.saison);
      m[s] = m[s] || { total: 0 };
      m[s][cle(e.unite)] = num(e.jeunes);
      if (cle(e.unite) !== 'groupe') m[s].total += num(e.jeunes);
    });
    return {
      unite: function (s, u) { return (m[s] && m[s][cle(u)]) || 0; },
      total: function (s) {
        if (!m[s]) return 0;
        return m[s].groupe || m[s].total;
      }
    };
  }

  var METHODES = {
    montant: 'Montant',
    qte_pu: 'Quantité × prix',
    par_jeune: '€ par jeune de l’unité',
    par_jeune_groupe: '€ par jeune du groupe'
  };

  /** Montant d'un poste de budget selon sa méthode. */
  function montantPoste(p, eff) {
    var m = txt(p.methode) || 'montant';
    if (m === 'qte_pu') return arrondi(num(p.quantite) * num(p.prix));
    if (m === 'par_jeune') return arrondi(eff.unite(p.saison, p.unite) * num(p.prix));
    if (m === 'par_jeune_groupe') return arrondi(eff.total(p.saison) * num(p.prix));
    return arrondi(num(p.montant));
  }

  /** Quantité affichée d'un poste (effectif pour les méthodes par jeune). */
  function quantitePoste(p, eff) {
    var m = txt(p.methode);
    if (m === 'par_jeune') return eff.unite(p.saison, p.unite);
    if (m === 'par_jeune_groupe') return eff.total(p.saison);
    if (m === 'qte_pu') return num(p.quantite);
    return null;
  }

  /* ------------------------------------------------------ synthèse */
  /**
   * Agrège les ventilations classées par ligne : {ligne: {r, d}}.
   * Les mouvements internes et non classées sont mis à part.
   */
  function agreger(classees) {
    var t = {};
    classees.forEach(function (v) {
      if (v.ligne === INTERNE) return;
      var k = v.ligne || '';
      t[k] = t[k] || { r: 0, d: 0 };
      t[k].r += v.recette; t[k].d += v.depense;
    });
    for (var k in t) { t[k].r = arrondi(t[k].r); t[k].d = arrondi(t[k].d); }
    return t;
  }

  function sommeBudget(budget, saison, eff) {
    var t = {};
    (budget || []).forEach(function (p) {
      if (txt(p.saison) !== saison) return;
      var k = txt(p.ligne), s = cle(p.sens) === 'recette' ? 'r' : 'd';
      t[k] = t[k] || { r: 0, d: 0 };
      t[k][s] += montantPoste(p, eff);
    });
    for (var k in t) { t[k].r = arrondi(t[k].r); t[k].d = arrondi(t[k].d); }
    return t;
  }

  function sommeEngagements(engagements, saison) {
    var t = {};
    (engagements || []).forEach(function (e) {
      if (txt(e.saison) !== saison || cle(e.statut) === 'regle' || cle(e.statut) === 'annule') return;
      var k = txt(e.ligne), s = cle(e.sens) === 'recette' ? 'r' : 'd';
      t[k] = t[k] || { r: 0, d: 0 };
      t[k][s] += num(e.montant);
    });
    for (var k in t) { t[k].r = arrondi(t[k].r); t[k].d = arrondi(t[k].d); }
    return t;
  }

  /**
   * Construit la synthèse de la saison `saison`.
   * donnees = { saisons:[{code}], classees:{code:[ventilations classées]},
   *             lignes:[{ligne, recette, section, horsBudget, ordre}], budget, engagements, effectifs }
   * Retourne { colonnes, sections:[{titre, sens, lignes:[...], total}], net, horsBudget, aClasser }.
   * Montants signés : recettes positives, dépenses négatives.
   */
  function synthese(donnees, saison) {
    var codes = donnees.saisons.map(function (s) { return s.code; });
    var i = codes.indexOf(saison);
    var n1 = i > 0 ? codes[i - 1] : null, n2 = i > 1 ? codes[i - 2] : null;
    var eff = compilerEffectifs(donnees.effectifs);
    var reel = {};
    [saison, n1, n2].forEach(function (c) { if (c) reel[c] = agreger(donnees.classees[c] || []); });
    var bud = sommeBudget(donnees.budget, saison, eff);
    var eng = sommeEngagements(donnees.engagements, saison);
    var vide = { r: 0, d: 0 };

    var lignes = (donnees.lignes || []).slice().sort(function (a, b) { return num(a.ordre) - num(b.ordre); });
    var connues = {};
    lignes.forEach(function (l) { connues[txt(l.ligne)] = l; });

    function rangee(nom, s) {
      var get = function (t) { return (t && t[nom]) || vide; };
      var sg = s === 'r' ? 1 : -1;
      var r2 = n2 ? sg * get(reel[n2])[s] : null, r1 = n1 ? sg * get(reel[n1])[s] : null;
      var b = sg * get(bud)[s], r = sg * get(reel[saison])[s], e = sg * get(eng)[s];
      var p = r + e;
      return {
        ligne: nom, n2: r2, n1: r1, budget: arrondi(b), varN1: r1 === null ? null : arrondi(b - r1),
        reel: arrondi(r), varBudget: arrondi(r - b), engage: arrondi(e), projete: arrondi(p),
        varProjete: arrondi(p - b)
      };
    }
    function nonVide(x) { return x.n2 || x.n1 || x.budget || x.reel || x.engage; }
    function total(rs) {
      var t = { ligne: 'Total' };
      ['n2', 'n1', 'budget', 'varN1', 'reel', 'varBudget', 'engage', 'projete', 'varProjete'].forEach(function (k) {
        var any = rs.some(function (x) { return x[k] !== null && x[k] !== undefined; });
        t[k] = any ? arrondi(rs.reduce(function (a, x) { return a + (x[k] || 0); }, 0)) : null;
      });
      return t;
    }

    // Toutes les lignes qui ont un montant quelque part.
    var presentes = {};
    [reel[saison], reel[n1], reel[n2], bud, eng].forEach(function (t) { if (t) for (var k in t) presentes[k] = true; });
    delete presentes[''];

    var sections = [], hors = [];
    // Recettes du groupe
    var rec = [];
    lignes.forEach(function (l) {
      if (l.horsBudget) return;
      var x = rangee(txt(l.ligne), 'r');
      if (l.recette || nonVide(x)) rec.push(x);
    });
    sections.push({ titre: 'Recettes du groupe', sens: 'r', lignes: rec, total: total(rec) });
    // Dépenses par section
    var noms = [];
    // Ordre des sections : celui de leur première ligne purement « dépense ».
    [false, true].forEach(function (avecRecette) {
      lignes.forEach(function (l) {
        if (!l.horsBudget && !!l.recette === avecRecette && txt(l.section) && noms.indexOf(txt(l.section)) < 0) noms.push(txt(l.section));
      });
    });
    var depParSection = {};
    noms.forEach(function (sn) { depParSection[sn] = []; });
    var autres = [];
    lignes.forEach(function (l) {
      if (l.horsBudget) return;
      var x = rangee(txt(l.ligne), 'd');
      if (txt(l.section)) depParSection[txt(l.section)].push(x);
      else if (nonVide(x)) autres.push(x);
    });
    noms.forEach(function (sn) {
      var rs = depParSection[sn];
      sections.push({ titre: 'Dépenses — ' + sn, sens: 'd', lignes: rs, total: total(rs) });
    });
    // Lignes inconnues du référentiel (créées par une règle sans être déclarées)
    Object.keys(presentes).forEach(function (k) {
      if (connues[k] || k === INTERNE) return;
      var xr = rangee(k, 'r'), xd = rangee(k, 'd');
      if (nonVide(xr)) rec.push(xr);
      if (nonVide(xd)) autres.push(xd);
    });
    sections[0].total = total(rec);
    if (autres.length) sections.push({ titre: 'Dépenses — Autres', sens: 'd', lignes: autres, total: total(autres) });

    var net = total(sections.map(function (s) { return s.total; }));
    net.ligne = 'Résultat du groupe';

    // Hors budget : flux de passage
    lignes.forEach(function (l) {
      if (!l.horsBudget) return;
      var nom = txt(l.ligne), xr = rangee(nom, 'r'), xd = rangee(nom, 'd');
      hors.push({ ligne: nom, recettes: xr, depenses: xd, solde: total([xr, xd]) });
    });
    var soldeHors = total(hors.map(function (h) { return h.solde; }));
    soldeHors.ligne = 'Solde des flux hors budget';

    var aClasser = (donnees.classees[saison] || []).filter(function (v) { return !v.ligne; });
    var nc = agreger(aClasser)[''] || vide;

    return {
      saison: saison, n1: n1, n2: n2, sections: sections, net: net, horsBudget: hors,
      soldeHorsBudget: soldeHors, aClasser: { nombre: aClasser.length, recettes: nc.r, depenses: nc.d }
    };
  }

  /* ---------------------------------------------- flux par unité (camps…) */
  /** Recettes / dépenses par unité pour les lignes hors budget de la saison. */
  function fluxParUnite(classees, lignes) {
    var hors = {};
    (lignes || []).forEach(function (l) { if (l.horsBudget) hors[txt(l.ligne)] = true; });
    var t = {};
    classees.forEach(function (v) {
      if (!hors[v.ligne]) return;
      var u = v.unite || 'Groupe';
      t[u] = t[u] || {};
      t[u][v.ligne] = t[u][v.ligne] || { r: 0, d: 0 };
      t[u][v.ligne].r += v.recette; t[u][v.ligne].d += v.depense;
    });
    return t;
  }

  /** Réel par ligne et par unité (pour le € par jeune N-1). */
  function reelParUnite(classees, ligne) {
    var t = {};
    classees.forEach(function (v) {
      if (v.ligne !== ligne) return;
      t[v.unite] = arrondi((t[v.unite] || 0) + v.depense - v.recette);
    });
    return t;
  }

  /* --------------------------------------------------------- contrôles */
  /** Identifiant de justificatif depuis un nom de fichier « 20260919_13 - …pdf ». */
  function idFichier(nom) {
    var m = txt(nom).match(/^(\d{7,8}_\d+)/);
    return m ? m[1] : '';
  }

  var MODES_SANS_PIECE = ['caisse (depot)', 'caisse (retrait)', 'caisse (transfert)', 'especes', 'cheque'];

  /**
   * Justificatifs : écritures de dépense qui en demandent un, et leur état.
   * Ne sont pas concernés : prélèvements de l'échelon national, mouvements internes,
   * recettes, montants négatifs (remboursements).
   */
  function controleJustificatifs(ecritures, fichiers) {
    var ids = {};
    (fichiers || []).forEach(function (f) { var id = idFichier(f); if (id) ids[id] = f; });
    var utilises = {}, manquants = [];
    ecritures.forEach(function (e) {
      if (e.piece && ids[e.piece]) utilises[e.piece] = true;
      if (!(e.depense > 0)) return;
      if (cle(e.tiersCat) === 'echelon national' || cle(e.tiersCat) === 'mon groupe') return;
      if (MODES_SANS_PIECE.indexOf(cle(e.mode)) >= 0 && cle(e.mode) !== 'cheque') return;
      if (!e.piece) manquants.push({ ecriture: e, probleme: 'Pas de n° de pièce' });
      else if (!ids[e.piece]) manquants.push({ ecriture: e, probleme: 'Justificatif absent du Drive' });
    });
    var orphelins = Object.keys(ids).filter(function (id) { return !utilises[id]; }).map(function (id) { return ids[id]; });
    return { manquants: manquants, orphelins: orphelins };
  }

  /** Écritures bancaires non rapprochées depuis plus de `jours` jours. */
  function nonRapprochees(ecritures, aujourdHui, jours) {
    var limite = new Date(aujourdHui.getTime() - (jours || 15) * 86400000);
    var lim = dateIso(limite);
    return ecritures.filter(function (e) {
      var r1 = e.compte && cle(e.rappro) === 'non', r2 = e.compte2 && cle(e.rappro2) === 'non';
      return (r1 || r2) && e.date && e.date <= lim;
    });
  }

  /**
   * Engagements ouverts pour lesquels une écriture correspondante est arrivée :
   * même ligne, même sens, montant à 1 € ou 2 % près, datée au plus 60 jours avant l'engagement.
   * Une ventilation ne sert qu'à un engagement. → [{engagement, ventilation}]
   */
  function correspondancesEngagements(engagements, classees, saison) {
    var prises = {}, out = [];
    (engagements || []).filter(function (e) {
      return txt(e.saison) === saison && cle(e.statut) !== 'regle' && cle(e.statut) !== 'annule' && num(e.montant) > 0;
    }).sort(function (a, b) { return txt(a.date) < txt(b.date) ? -1 : 1; }).forEach(function (e) {
      var m = num(e.montant), recette = cle(e.sens) === 'recette', tol = Math.max(1, m * 0.02);
      var avant = e.date ? dateIso(new Date(new Date(txt(e.date) + 'T12:00:00').getTime() - 60 * 86400000)) : '';
      var v = (classees || []).filter(function (x) {
        return !prises[x.cle] && x.ligne === e.ligne && Math.abs((recette ? x.recette : x.depense) - m) <= tol && (!avant || x.date >= avant);
      }).sort(function (a, b) { return Math.abs((recette ? a.recette : a.depense) - m) - Math.abs((recette ? b.recette : b.depense) - m); })[0];
      if (v) { prises[v.cle] = 1; out.push({ engagement: e, ventilation: v }); }
    });
    return out;
  }

  return {
    correspondancesEngagements: correspondancesEngagements,
    txt: txt, cle: cle, num: num, arrondi: arrondi, dateIso: dateIso,
    INTERNE: INTERNE, METHODES: METHODES,
    lireExport: lireExport, classer: classer, compilerRegles: compilerRegles,
    compilerEffectifs: compilerEffectifs, montantPoste: montantPoste, quantitePoste: quantitePoste,
    agreger: agreger, synthese: synthese, fluxParUnite: fluxParUnite, reelParUnite: reelParUnite,
    idFichier: idFichier, controleJustificatifs: controleJustificatifs, nonRapprochees: nonRapprochees
  };
})();

if (typeof module !== 'undefined') module.exports = Engine;


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


/* =====================================================================
 * Budget & suivi d'un groupe Scouts et Guides de France
 * Serveur Apps Script : le classeur sert de base de données.
 * Le moteur (Engine) et les données de départ (Seed) sont ajoutés au
 * début de ce fichier par build/build.py.
 * ===================================================================== */

// Identité par défaut (nom du groupe, dépôt du robot) : dans Seed, propre à chaque build ;
// modifiable ensuite dans Paramètres › Groupe et Paramètres › Imports.
var APP = {
  version: '1.0.0',
  depotPublic: 'gfunkstark/budget-groupe-sgdf',   // où sont publiées les nouvelles versions
  workflow: 'budget.yml',
  branche: 'main'
};

// Tables de paramétrage : nom d'onglet → colonnes (clé objet, en-tête affiché).
var TABLES = {
  Saisons: [['code', 'Saison'], ['onglet', 'Onglet écritures'], ['debut', 'Début'], ['courante', 'Courante'], ['exercice', 'Exercice Comptaweb']],
  Lignes: [['ligne', 'Ligne'], ['recette', 'En recettes'], ['section', 'Section dépenses'], ['horsBudget', 'Hors budget'], ['ordre', 'Ordre'],
    ['budget', 'Saisie du budget']],
  Regles: [['activite', 'Activité Comptaweb'], ['nature', 'Nature'], ['ligne', 'Ligne']],
  Unites: [['branche', 'Branche Comptaweb'], ['unite', 'Unité'], ['ordre', 'Ordre']],
  Effectifs: [['saison', 'Saison'], ['unite', 'Unité'], ['jeunes', 'Jeunes']],
  Budget: [['id', 'Id'], ['saison', 'Saison'], ['ligne', 'Ligne'], ['sens', 'Sens'], ['poste', 'Poste'], ['unite', 'Unité'],
    ['methode', 'Méthode'], ['quantite', 'Quantité'], ['prix', 'Prix unitaire'], ['montant', 'Montant'], ['commentaire', 'Commentaire'],
    ['evenement', 'Événement']],
  Engagements: [['id', 'Id'], ['saison', 'Saison'], ['date', 'Date prévue'], ['ligne', 'Ligne'], ['sens', 'Sens'], ['unite', 'Unité'],
    ['libelle', 'Libellé'], ['montant', 'Montant'], ['statut', 'Statut'], ['commentaire', 'Commentaire']],
  Corrections: [['cle', 'Clé'], ['saison', 'Saison'], ['ligne', 'Ligne'], ['intitule', 'Intitulé (rappel)']],
  // Fonds des équipes Compagnons : statut de chaque équipe (branche Comptaweb) et écritures ou lignes exclues du fonds
  Equipes: [['branche', 'Branche Comptaweb'], ['statut', 'Statut'], ['commentaire', 'Commentaire']],
  FondsExclusions: [['type', 'Type (ligne / ecriture)'], ['valeur', 'Ligne ou clé d\u2019écriture'], ['libelle', 'Rappel']],
  // Versions figées du budget (ex. « Voté en conseil de groupe ») et leurs postes
  Versions: [['id', 'Id'], ['saison', 'Saison'], ['nom', 'Nom'], ['date', 'Figée le'], ['commentaire', 'Commentaire'], ['reference', 'Référence']],
  BudgetFige: [['version', 'Version'], ['saison', 'Saison'], ['ligne', 'Ligne'], ['sens', 'Sens'], ['poste', 'Poste'], ['unite', 'Unité'],
    ['methode', 'Méthode'], ['quantite', 'Quantité'], ['prix', 'Prix unitaire'], ['montant', 'Montant'], ['commentaire', 'Commentaire'], ['evenement', 'Événement'],
    ['effectif', 'Effectif figé']],
  // Routine du mois : étapes cochées à la main
  Routine: [['mois', 'Mois'], ['etape', 'Étape'], ['faitLe', 'Fait le'], ['par', 'Par']],
  // Registre des attestations sur l'honneur générées pour les justificatifs perdus
  Attestations: [['genere', 'Générée le'], ['piece', 'N° de pièce'], ['date', 'Date dépense'], ['intitule', 'Intitulé'], ['montant', 'Montant'],
    ['motif', 'Motif'], ['commentaire', 'Commentaire'], ['payeur', 'Réglée par'], ['lien', 'PDF'], ['fichier', 'Id fichier']]
};
var BOOLEENS = { recette: 1, horsBudget: 1, courante: 1, reference: 1 };
var ONGLET_STATS = 'Stats Comptaweb';
var ONGLET_FICHIERS = 'Fichiers Drive';
var ONGLET_JOURNAL = 'Journal robot';

/* ------------------------------------------------------------ web app */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(identite_().titre)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu(identite_().titre)
    .addItem('Installer / compléter le classeur', 'installer')
    .addItem('Ouvrir l’application', 'ouvrirApp_')
    .addToUi();
}

function ouvrirApp_() {
  var url = urlApp_();
  var html = url
    ? '<p><a href="' + url + '" target="_blank">Ouvrir l’application</a></p>'
    : '<p>Déploie d’abord l’application : Déployer › Nouveau déploiement › Application Web.</p>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(320).setHeight(90), identite_().titre);
}

/* ----------------------------------------------------------- accès classeur */
function classeur_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Classeur introuvable : lance « installer » depuis le classeur.');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}

function onglet_(nom, creer) {
  var ss = classeur_(), sh = ss.getSheetByName(nom);
  if (!sh && creer) sh = ss.insertSheet(nom);
  return sh;
}

function verrou_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function enCellule_(cle, v) {
  if (BOOLEENS[cle]) return v === true || v === 'Oui' || v === 'TRUE' ? 'Oui' : 'Non';
  return v === undefined || v === null ? '' : v;
}
function depuisCellule_(cle, v) {
  if (BOOLEENS[cle]) return v === true || String(v).toLowerCase() === 'oui' || v === 'TRUE';
  if (v instanceof Date) return Engine.dateIso(v);
  return v;
}

function lireTable_(nom) {
  var cols = TABLES[nom], sh = onglet_(nom);
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, cols.length).getValues();
  return vals.filter(function (r) { return r.some(function (c) { return c !== ''; }); }).map(function (r) {
    var o = {};
    cols.forEach(function (c, i) { o[c[0]] = depuisCellule_(c[0], r[i]); });
    return o;
  });
}

function ecrireTable_(nom, objets) {
  var cols = TABLES[nom], sh = onglet_(nom, true);
  sh.clearContents();
  var rows = [cols.map(function (c) { return c[1]; })];
  objets.forEach(function (o) { rows.push(cols.map(function (c) { return enCellule_(c[0], o[c[0]]); })); });
  sh.getRange(1, 1, rows.length, cols.length).setValues(rows);
  sh.getRange(1, 1, 1, cols.length).setFontWeight('bold');
  sh.setFrozenRows(1);
}

function nouvelId_() { return Utilities.getUuid().slice(0, 8); }

/* ------------------------------------------------------------ installation */
/** Crée les onglets manquants et les remplit avec les données de départ. Sans risque si relancé. */
function installer() {
  return verrou_(function () {
    var faits = [];
    var saisons = Seed.saisons.length ? Seed.saisons : [saisonDuJour_()];
    var depart = {
      Saisons: saisons.map(function (s) { return { code: s.code, onglet: s.onglet, debut: s.debut, courante: s.courante, exercice: s.exercice || '' }; }),
      Lignes: Seed.lignes, Regles: Seed.regles, Unites: Seed.unites, Effectifs: Seed.effectifs,
      Budget: Seed.budget.map(function (p) { p.id = nouvelId_(); return p; }), Engagements: [], Corrections: []
    };
    Object.keys(TABLES).forEach(function (nom) {
      var sh = onglet_(nom);
      if (!sh || sh.getLastRow() < 1) { ecrireTable_(nom, depart[nom] || []); faits.push(nom); }
    });
    saisons.forEach(function (s) {
      if (!onglet_(s.onglet)) { onglet_(s.onglet, true); faits.push(s.onglet); }
    });
    [[ONGLET_STATS, null], [ONGLET_FICHIERS, ['File Name']], [ONGLET_JOURNAL, ['Date', 'Saison', 'Écritures', 'Statut']]].forEach(function (x) {
      if (!onglet_(x[0])) {
        var sh = onglet_(x[0], true);
        if (x[1]) sh.getRange(1, 1, 1, x[1].length).setValues([x[1]]).setFontWeight('bold');
        faits.push(x[0]);
      }
    });
    var ss = classeur_(), feuille1 = ss.getSheetByName('Feuille 1') || ss.getSheetByName('Sheet1');
    if (feuille1 && feuille1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(feuille1);
    return faits.length ? 'Créé : ' + faits.join(', ') : 'Tout était déjà en place.';
  });
}

/* --------------------------------------------------------------- lecture */
function lireOngletBrut_(nom) {
  var sh = onglet_(nom);
  if (!sh || sh.getLastRow() < 1) return [];
  return sh.getDataRange().getValues();
}

/** Tout ce dont l'interface a besoin, en un appel. */
function getDonnees() {
  var saisons = lireTable_('Saisons');
  var ecritures = {}, ventilations = {}, erreurs = [];
  saisons.forEach(function (s) {
    try {
      var lu = Engine.lireExport(lireOngletBrut_(s.onglet));
      ecritures[s.code] = lu.ecritures;
      ventilations[s.code] = lu.ventilations;
    } catch (e) {
      ecritures[s.code] = []; ventilations[s.code] = [];
      erreurs.push(s.onglet + ' : ' + e.message);
    }
  });
  var brut = lireOngletBrut_(ONGLET_FICHIERS), liensFichiers = {};
  var tete = (brut[0] || []).map(function (c) { return Engine.cle(c); }), iLien = tete.indexOf('lien'), iId = tete.indexOf('id');
  var fichiers = brut.slice(1).map(function (r) {
    var nom = String(r[0] || '');
    if (nom) {
      var lien = iLien >= 0 ? String(r[iLien] || '') : '', id = iId >= 0 ? String(r[iId] || '') : '';
      if (lien || id) liensFichiers[nom] = lien || 'https://drive.google.com/file/d/' + id + '/view';
    }
    return nom;
  }).filter(String);
  var stats = lireOngletBrut_(ONGLET_STATS).map(function (r) {
    return r.map(function (c) { return c instanceof Date ? Engine.dateIso(c) : c; });
  });
  var journal = lireOngletBrut_(ONGLET_JOURNAL).slice(1).map(function (r) {
    return { date: r[0] instanceof Date ? r[0].toISOString() : String(r[0]), saison: r[1], lignes: r[2], statut: r[3] };
  });
  var corrections = {};
  lireTable_('Corrections').forEach(function (c) { corrections[c.cle] = c.ligne; });
  return {
    saisons: saisons, lignes: lireTable_('Lignes'), regles: lireTable_('Regles'), unites: lireTable_('Unites'),
    effectifs: lireTable_('Effectifs'), budget: lireTable_('Budget'), engagements: lireTable_('Engagements'),
    corrections: corrections, correctionsListe: lireTable_('Corrections'),
    equipes: lireTable_('Equipes'), fondsExclusions: lireTable_('FondsExclusions'),
    ecritures: ecritures, ventilations: ventilations, fichiers: fichiers, liensFichiers: liensFichiers, stats: stats,
    journal: journal.slice(-10), erreurs: erreurs,
    groupe: identite_(), version: APP.version,
    github: { configure: !!PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN'), depot: depotRobot_(),
      expiration: PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN_EXPIRATION') || '' },
    routine: lireTable_('Routine'), notifications: configNotifications_(), appUrl: urlApp_(),
    attestation: configAttestation_(), attestations: lireTable_('Attestations'),
    versions: lireTable_('Versions'), budgetFige: lireTable_('BudgetFige'),
    classeurUrl: classeur_().getUrl(), maintenant: new Date().toISOString()
  };
}

/* --------------------------------------------------------------- écritures */
/** Ajoute ou met à jour une ligne d'une table à identifiant (Budget, Engagements). */
function enregistrer(nom, objet) {
  if (nom !== 'Budget' && nom !== 'Engagements') throw new Error('Table non modifiable ligne à ligne : ' + nom);
  return verrou_(function () {
    var rows = lireTable_(nom), o = nettoyer_(nom, objet);
    if (!o.id) { o.id = nouvelId_(); rows.push(o); }
    else {
      var i = rows.map(function (r) { return r.id; }).indexOf(o.id);
      if (i < 0) rows.push(o); else rows[i] = o;
    }
    ecrireTable_(nom, rows);
    return o;
  });
}

/**
 * Plusieurs postes de budget en une fois : supprime les id de `supprimer`,
 * puis ajoute ou met à jour `postes`. Renvoie les postes enregistrés, dans l'ordre.
 */
function majPostes(supprimer, postes) {
  return verrou_(function () {
    var suppr = supprimer || [];
    var rows = lireTable_('Budget').filter(function (r) { return suppr.indexOf(r.id) < 0; });
    var out = (postes || []).map(function (p) {
      var o = nettoyer_('Budget', p);
      var i = o.id ? rows.map(function (r) { return r.id; }).indexOf(o.id) : -1;
      if (!o.id) o.id = nouvelId_();
      if (i < 0) rows.push(o); else rows[i] = o;
      return o;
    });
    ecrireTable_('Budget', rows);
    return out;
  });
}

function supprimer(nom, id) {
  if (nom !== 'Budget' && nom !== 'Engagements') throw new Error('Suppression impossible dans ' + nom);
  return verrou_(function () {
    ecrireTable_(nom, lireTable_(nom).filter(function (r) { return r.id !== id; }));
    return true;
  });
}

function nettoyer_(nom, o) {
  var r = {};
  TABLES[nom].forEach(function (c) { r[c[0]] = o[c[0]] === undefined ? '' : o[c[0]]; });
  ['quantite', 'prix', 'montant'].forEach(function (k) {
    if (k in r && r[k] !== '') r[k] = Engine.num(r[k]);
  });
  return r;
}

/** Remplace entièrement une table de paramétrage. */
function enregistrerTable(nom, objets) {
  if (['Saisons', 'Lignes', 'Regles', 'Unites', 'Effectifs', 'Equipes', 'FondsExclusions'].indexOf(nom) < 0) throw new Error('Table inconnue : ' + nom);
  return verrou_(function () {
    var propres = (objets || []).map(function (o) { return nettoyer_(nom, o); }).filter(function (o) {
      return TABLES[nom].some(function (c) { return o[c[0]] !== '' && o[c[0]] !== false; });
    });
    if (nom === 'Saisons') {
      var courantes = propres.filter(function (s) { return s.courante === true || s.courante === 'Oui'; });
      if (courantes.length !== 1) throw new Error('Il faut exactement une saison courante.');
      propres.forEach(function (s) { if (s.onglet && !onglet_(s.onglet)) onglet_(s.onglet, true); });
    }
    ecrireTable_(nom, propres);
    return true;
  });
}

/** Crée une ligne de budget (ex. un nouveau week-end) et, si fournie, sa règle de classement. */
function ajouterLigne(ligne, regle) {
  return verrou_(function () {
    var lignes = lireTable_('Lignes');
    if (lignes.some(function (l) { return Engine.cle(l.ligne) === Engine.cle(ligne.ligne); })) throw new Error('La ligne « ' + ligne.ligne + ' » existe déjà.');
    lignes.push(nettoyer_('Lignes', ligne));
    ecrireTable_('Lignes', lignes);
    if (regle && regle.activite) {
      var rows = lireTable_('Regles').filter(function (r) {
        return !(Engine.cle(r.activite) === Engine.cle(regle.activite) && Engine.cle(r.nature) === Engine.cle(regle.nature || '*'));
      });
      rows.push({ activite: regle.activite, nature: regle.nature || '*', ligne: ligne.ligne });
      ecrireTable_('Regles', rows);
    }
    return true;
  });
}

/** Ajoute une règle de classement (remplace une règle identique activité + nature). */
function ajouterRegle(regle) {
  return verrou_(function () {
    var rows = lireTable_('Regles').filter(function (r) {
      return !(Engine.cle(r.activite) === Engine.cle(regle.activite) && Engine.cle(r.nature) === Engine.cle(regle.nature));
    });
    rows.push({ activite: regle.activite, nature: regle.nature || '*', ligne: regle.ligne });
    ecrireTable_('Regles', rows);
    return true;
  });
}

/** Classe une ventilation précise (exception), ou retire l'exception si ligne vide. */
function corriger(cle, saison, ligne, intitule) {
  return verrou_(function () {
    var rows = lireTable_('Corrections').filter(function (c) { return c.cle !== cle; });
    if (ligne) rows.push({ cle: cle, saison: saison, ligne: ligne, intitule: intitule || '' });
    ecrireTable_('Corrections', rows);
    return true;
  });
}

/** Recopie le budget d'une saison vers une autre (postes existants de la cible conservés si `remplacer` est faux). */
function copierBudget(source, cible, remplacer) {
  return verrou_(function () {
    var rows = lireTable_('Budget');
    if (remplacer) rows = rows.filter(function (p) { return p.saison !== cible; });
    else if (rows.some(function (p) { return p.saison === cible; })) throw new Error('La saison ' + cible + ' a déjà un budget.');
    var copie = rows.filter(function (p) { return p.saison === source; }).map(function (p) {
      var c = JSON.parse(JSON.stringify(p)); c.id = nouvelId_(); c.saison = cible; return c;
    });
    if (!copie.length) throw new Error('Aucun poste de budget en ' + source + '.');
    ecrireTable_('Budget', rows.concat(copie));
    return copie.length;
  });
}

/* --------------------------------------------------------- import CSV */
/** Découpe un CSV (séparateur ; ou ,) en tableau de lignes. */
function decouperCsv_(texte) {
  texte = String(texte || '').replace(/^﻿/, '');
  var premiere = texte.split('\n')[0];
  var sep = (premiere.split(';').length >= premiere.split(',').length) ? ';' : ',';
  var lignes = [], ligne = [], champ = '', q = false;
  for (var i = 0; i < texte.length; i++) {
    var c = texte[i];
    if (q) {
      if (c === '"') { if (texte[i + 1] === '"') { champ += '"'; i++; } else q = false; } else champ += c;
    } else if (c === '"') q = true;
    else if (c === sep) { ligne.push(champ); champ = ''; }
    else if (c === '\n') { ligne.push(champ); lignes.push(ligne); ligne = []; champ = ''; }
    else if (c !== '\r') champ += c;
  }
  if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  return lignes.filter(function (l) { return l.some(function (x) { return x !== ''; }); });
}

/**
 * Importe un export Comptaweb (texte CSV) dans l'onglet de la saison.
 * Les montants sont convertis en nombres, les dates laissées en jj/mm/aaaa.
 */
function importerCsv(saison, texte) {
  var lignes = decouperCsv_(texte);
  if (lignes.length < 2) throw new Error('Fichier vide.');
  var lu = Engine.lireExport(lignes); // valide les en-têtes
  return verrou_(function () {
    var saisons = lireTable_('Saisons');
    var s = saisons.filter(function (x) { return x.code === saison; })[0];
    if (!s) {
      s = { code: saison, onglet: 'Ecritures ' + saison, debut: '', courante: false, exercice: '' };
      saisons.push(s);
      saisons.sort(function (a, b) { return a.code < b.code ? -1 : 1; });
      ecrireTable_('Saisons', saisons);
    }
    var entetes = lignes[0], numeriques = {};
    ['Dépense', 'Recette', 'Dépense ventilation', 'Recette ventilation'].forEach(function (h) {
      var i = entetes.map(Engine.cle).indexOf(Engine.cle(h)); if (i >= 0) numeriques[i] = true;
    });
    var largeur = entetes.length;
    var vals = lignes.map(function (l, n) {
      var r = [];
      for (var i = 0; i < largeur; i++) {
        var v = l[i] === undefined ? '' : l[i];
        r.push(n > 0 && numeriques[i] ? (v === '' ? 0 : Engine.num(v)) : v);
      }
      return r;
    });
    var sh = onglet_(s.onglet, true);
    sh.clearContents();
    // Texte brut partout sauf les montants : dates et n° de pièce restent tels quels.
    for (var c = 0; c < largeur; c++) {
      sh.getRange(1, c + 1, vals.length, 1).setNumberFormat(numeriques[c] ? '#,##0.00' : '@');
    }
    sh.getRange(1, 1, vals.length, largeur).setValues(vals);
    sh.setFrozenRows(1);
    return { ecritures: lu.ecritures.length, ventilations: lu.ventilations.length, onglet: s.onglet };
  });
}

/* --------------------------------------------------------- robot GitHub */
/** Enregistre (ou retire) le jeton et le vérifie aussitôt ; renvoie {configure, expiration}. */
function enregistrerJetonGithub(jeton) {
  var p = PropertiesService.getScriptProperties();
  p.deleteProperty('GITHUB_TOKEN_EXPIRATION');
  if (!jeton) { p.deleteProperty('GITHUB_TOKEN'); return { configure: false, expiration: '' }; }
  p.setProperty('GITHUB_TOKEN', String(jeton).trim());
  appelGithub_('get', '');   // vérifie l'accès au dépôt et note la date d'expiration
  return { configure: true, expiration: p.getProperty('GITHUB_TOKEN_EXPIRATION') || '' };
}

/** GitHub renvoie la date d'expiration des jetons dans l'en-tête « github-authentication-token-expiration ». */
function noterExpirationJeton_(rep) {
  try {
    var h = rep.getAllHeaders ? rep.getAllHeaders() : rep.getHeaders(), v = '';
    Object.keys(h || {}).forEach(function (k) { if (k.toLowerCase() === 'github-authentication-token-expiration') v = String(h[k]); });
    var m = v.match(/(\d{4}-\d{2}-\d{2})/);
    if (m) PropertiesService.getScriptProperties().setProperty('GITHUB_TOKEN_EXPIRATION', m[1]);
  } catch (e) { }
}

function appelGithub_(methode, chemin, corps) {
  var jeton = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!jeton) throw new Error('Jeton GitHub non configuré (Paramètres › Robot Comptaweb).');
  var opts = {
    method: methode, muteHttpExceptions: true, contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + jeton, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  };
  if (corps) opts.payload = JSON.stringify(corps);
  if (!depotRobot_()) throw new Error('Dépôt GitHub du robot non renseigné (Paramètres › Imports).');
  var rep = UrlFetchApp.fetch('https://api.github.com/repos/' + depotRobot_() + chemin, opts);
  var code = rep.getResponseCode();
  noterExpirationJeton_(rep);
  if (code >= 300) throw new Error('GitHub a répondu ' + code + ' : ' + rep.getContentText().slice(0, 200));
  var t = rep.getContentText();
  return t ? JSON.parse(t) : {};
}

/** Compare la version installée à la dernière version publiée (dépôt public GitHub). */
function verifierMiseAJour() {
  var r = { installee: APP.version, derniere: '', depot: APP.depotPublic, aJour: true };
  try {
    var rep = UrlFetchApp.fetch('https://raw.githubusercontent.com/' + APP.depotPublic + '/main/VERSION', { muteHttpExceptions: true });
    if (rep.getResponseCode() === 200) {
      var v = String(rep.getContentText()).trim();
      if (/^\d+\.\d+\.\d+$/.test(v)) { r.derniere = v; r.aJour = compVersion_(r.installee, v) >= 0; }
    }
  } catch (e) { /* hors ligne : on ne dit rien */ }
  return r;
}
function compVersion_(a, b) {
  var x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (var i = 0; i < 3; i++) { var d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}

/** Lance le robot d'export Comptaweb maintenant. */
function actualiserComptaweb() {
  appelGithub_('post', '/actions/workflows/' + APP.workflow + '/dispatches', { ref: APP.branche });
  return true;
}

/** État des dernières exécutions du robot. */
function etatRobot() {
  var r = appelGithub_('get', '/actions/workflows/' + APP.workflow + '/runs?per_page=5');
  return (r.workflow_runs || []).map(function (x) {
    return { debut: x.run_started_at || x.created_at, statut: x.status, resultat: x.conclusion, declencheur: x.event, url: x.html_url };
  });
}


/* ------------------------------------------------ attestations sur l'honneur */
/* Pour une dépense dont le justificatif a disparu : un modèle Google Docs est rempli,
 * converti en PDF et rangé dans le dossier Drive des justificatifs sous le nom
 * « <n° de pièce> - Attestation sur l'honneur - <intitulé>.pdf », ce qui le fait
 * reconnaître comme justificatif par les contrôles. */
var MOTIFS_ATTESTATION = ['Ticket ou facture perdu', 'Justificatif non remis par le fournisseur', 'Justificatif illisible ou détérioré', 'Autre'];

function configAttestation_() {
  var p = PropertiesService.getScriptProperties();
  var dossier = p.getProperty('DOSSIER_JUSTIFICATIFS'), modele = p.getProperty('MODELE_ATTESTATION');
  return {
    dossier: dossier || '', dossierNom: p.getProperty('DOSSIER_JUSTIFICATIFS_NOM') || '',
    dossierUrl: dossier ? 'https://drive.google.com/drive/folders/' + dossier : '',
    modeleUrl: modele ? 'https://docs.google.com/document/d/' + modele + '/edit' : '',
    tampon: !!p.getProperty('TAMPON_ATTESTATION'), tresorier: p.getProperty('TRESORIER_NOM') || '',
    motifs: MOTIFS_ATTESTATION
  };
}

/** À lancer une fois depuis l'éditeur pour accorder à l'application l'accès à Drive et Docs. */
function autoriserAttestations() { return autoriser(); }

/** À lancer depuis l'éditeur après une mise à jour : accorde Drive, Docs, e-mail et déclencheurs. */
function autoriser() {
  DriveApp.getRootFolder();
  DocumentApp.getActiveDocument();
  MailApp.getRemainingDailyQuota();
  ScriptApp.getProjectTriggers();
  return 'Autorisations accordées.';
}

function idDepuisLien_(v) {
  var t = String(v || '').trim(), m = t.match(/[-\w]{25,}/);
  return m ? m[0] : t;
}

/** Dossier Drive des justificatifs (lien ou identifiant), le même que celui du robot. */
function enregistrerDossierJustificatifs(lien) {
  var id = idDepuisLien_(lien), dossier = DriveApp.getFolderById(id);
  var p = PropertiesService.getScriptProperties();
  p.setProperty('DOSSIER_JUSTIFICATIFS', id);
  p.setProperty('DOSSIER_JUSTIFICATIFS_NOM', dossier.getName());
  return configAttestation_();
}

function enregistrerTresorier(nom) {
  PropertiesService.getScriptProperties().setProperty('TRESORIER_NOM', String(nom || '').trim());
  return configAttestation_();
}

/** Image du tampon du groupe (PNG ou JPEG en base64), rangée à côté du classeur. */
function enregistrerTampon(base64, type, nom) {
  var p = PropertiesService.getScriptProperties();
  var ancien = p.getProperty('TAMPON_ATTESTATION');
  if (ancien) { try { DriveApp.getFileById(ancien).setTrashed(true); } catch (e) { } }
  var blob = Utilities.newBlob(Utilities.base64Decode(base64), type || 'image/png', 'Tampon du groupe - ' + (nom || 'tampon.png'));
  var fichier = dossierApp_().createFile(blob);
  p.setProperty('TAMPON_ATTESTATION', fichier.getId());
  return configAttestation_();
}

function dossierApp_() {
  var parents = DriveApp.getFileById(classeur_().getId()).getParents();
  return parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
}

/** Crée (ou recrée) le modèle Google Docs de l'attestation, modifiable librement ensuite. */
function creerModeleAttestation() {
  var g = identite_();
  var doc = DocumentApp.create('Modèle - Attestation sur l’honneur (' + g.titre + ')');
  var b = doc.getBody();
  b.setMarginTop(50).setMarginBottom(50).setMarginLeft(60).setMarginRight(60);
  // Mise en forme via editAsText() : Paragraph.setText() ne renvoie rien et n'a pas toutes les méthodes de style
  function par(texte, o) {
    o = o || {};
    var p = b.appendParagraph(texte);
    if (o.titre) p.setHeading(DocumentApp.ParagraphHeading.TITLE);
    if (o.centre) p.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    if (texte) {
      var t = p.editAsText();
      if (o.taille) t.setFontSize(o.taille);
      if (o.couleur) t.setForegroundColor(o.couleur);
      t.setItalic(!!o.italique);
      t.setBold(!!o.gras);
    }
    return p;
  }
  var premier = b.getParagraphs()[0];
  premier.appendText('Scouts et Guides de France — ' + (g.nom || 'Groupe'));
  premier.editAsText().setFontSize(9).setForegroundColor('#555555');
  if (g.adresse) par(g.adresse, { taille: 9, couleur: '#555555' });
  par('');
  par('ATTESTATION SUR L’HONNEUR', { titre: true, centre: true });
  par('Absence de justificatif de dépense', { centre: true, italique: true, taille: 11 });
  par('');
  par('Je soussigné(e) {{PAYEUR}}, déclare sur l’honneur avoir réglé la dépense décrite ci-dessous pour le compte du ' + (g.nom || 'groupe') + ' ' +
    '(Scouts et Guides de France), et ne pas être en mesure d’en fournir le justificatif original.', { taille: 11 });
  var t = b.appendTable([
    ['Date de la dépense', '{{DATE_DEPENSE}}'], ['Objet', '{{INTITULE}}'], ['Montant', '{{MONTANT}}'], ['Mode de paiement', '{{MODE}}'],
    ['N° de pièce comptable', '{{PIECE}}'], ['Motif', '{{MOTIF}}'], ['Précisions', '{{COMMENTAIRE}}']]);
  t.setBorderColor('#bbbbbb');
  for (var i = 0; i < t.getNumRows(); i++) { t.getCell(i, 0).setBackgroundColor('#f2f2f2').setWidth(160); }
  par('');
  par('Je certifie que cette dépense a été engagée dans le cadre des activités du groupe et qu’elle n’a fait l’objet d’aucun autre remboursement.', { taille: 11 });
  par('');
  par('Fait à ' + (g.ville || '…') + ', le {{DATE}}.', { taille: 11 });
  par('');
  var s = b.appendTable([['La personne ayant réglé la dépense', 'Visa du trésorier'], ['{{PAYEUR}}', '{{TRESORIER}}'],
    ['Signé électroniquement le {{HORODATAGE}}', 'Signé électroniquement le {{HORODATAGE}}'], ['', '{{TAMPON}}']]);
  s.setBorderWidth(0);
  s.getCell(0, 0).editAsText().setBold(true); s.getCell(0, 1).editAsText().setBold(true);
  par('');
  par('Document généré par l’application ' + g.titre + ' à partir des écritures Comptaweb.', { taille: 8, couleur: '#888888' });
  doc.saveAndClose();
  var f = DriveApp.getFileById(doc.getId());
  try { f.moveTo(dossierApp_()); } catch (e) { }
  var p = PropertiesService.getScriptProperties(), ancien = p.getProperty('MODELE_ATTESTATION');
  if (ancien && ancien !== doc.getId()) { try { DriveApp.getFileById(ancien).setTrashed(true); } catch (e) { } }
  p.setProperty('MODELE_ATTESTATION', doc.getId());
  return configAttestation_();
}

function montantFr_(v) {
  var n = Math.round((Number(v) || 0) * 100) / 100, e = Math.floor(Math.abs(n)), c = Math.round((Math.abs(n) - e) * 100);
  return (n < 0 ? '-' : '') + String(e).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + ',' + (c < 10 ? '0' : '') + c + ' €';
}

function nomFichierAttestation_(piece, intitule) {
  var propre = String(intitule || '').replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return piece + ' - Attestation sur l’honneur - ' + propre + '.pdf';
}

/**
 * Génère l'attestation d'une dépense : {piece, date (aaaa-mm-jj), intitule, montant, mode, motif, commentaire, payeur}.
 * Renvoie {nom, url, id, attestation}.
 */
function genererAttestation(d) {
  var p = PropertiesService.getScriptProperties();
  var dossierId = p.getProperty('DOSSIER_JUSTIFICATIFS');
  if (!dossierId) throw new Error('Indique d’abord le dossier Drive des justificatifs (Paramètres › Attestations).');
  if (!d || !String(d.piece || '').trim()) throw new Error('Pas de n° de pièce : saisis-le d’abord dans Comptaweb.');
  if (!String(d.payeur || '').trim()) throw new Error('Indique qui a réglé la dépense.');
  if (!p.getProperty('MODELE_ATTESTATION')) creerModeleAttestation();
  var modeleId = p.getProperty('MODELE_ATTESTATION');
  var dossier = DriveApp.getFolderById(dossierId);
  var maintenant = new Date(), tz = 'Europe/Paris';
  var aujourdhui = Utilities.formatDate(maintenant, tz, 'dd/MM/yyyy'), heure = Utilities.formatDate(maintenant, tz, 'dd/MM/yyyy à HH:mm');
  var tresorier = p.getProperty('TRESORIER_NOM') || 'le trésorier';
  var m = String(d.date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  var valeurs = {
    PAYEUR: String(d.payeur).trim(), DATE_DEPENSE: m ? m[3] + '/' + m[2] + '/' + m[1] : String(d.date || ''), INTITULE: String(d.intitule || ''),
    MONTANT: montantFr_(d.montant), MODE: String(d.mode || ''), PIECE: String(d.piece).trim(),
    MOTIF: String(d.motif || ''), COMMENTAIRE: String(d.commentaire || '').trim() || '—', DATE: aujourdhui, TRESORIER: tresorier, HORODATAGE: heure
  };
  var copie = DriveApp.getFileById(modeleId).makeCopy('Attestation ' + valeurs.PIECE + ' (temporaire)', dossierApp_());
  try {
    var doc = DocumentApp.openById(copie.getId()), corps = doc.getBody();
    Object.keys(valeurs).forEach(function (k) {
      corps.replaceText('\\{\\{' + k + '\\}\\}', String(valeurs[k]).replace(/[\r\n]+/g, ' '));
    });
    placerTampon_(corps, p.getProperty('TAMPON_ATTESTATION'));
    doc.saveAndClose();
    var pdf = copie.getAs('application/pdf').setName(nomFichierAttestation_(valeurs.PIECE, valeurs.INTITULE));
    var fichier = dossier.createFile(pdf);
  } finally {
    copie.setTrashed(true);
  }
  var a = {
    genere: Utilities.formatDate(maintenant, tz, 'yyyy-MM-dd HH:mm'), piece: valeurs.PIECE, date: String(d.date || ''), intitule: valeurs.INTITULE,
    montant: Number(d.montant) || 0, motif: valeurs.MOTIF, commentaire: String(d.commentaire || ''), payeur: valeurs.PAYEUR, lien: fichier.getUrl(), fichier: fichier.getId()
  };
  verrou_(function () {
    var reg = lireTable_('Attestations'); reg.push(a); ecrireTable_('Attestations', reg);
    // Visible tout de suite dans les contrôles, sans attendre le prochain passage du robot
    var sh = onglet_(ONGLET_FICHIERS, true);
    if (sh.getLastRow() < 1) sh.getRange(1, 1, 1, 3).setValues([['File Name', 'Id', 'Lien']]);
    sh.getRange(sh.getLastRow() + 1, 1, 1, 3).setValues([[fichier.getName(), fichier.getId(), fichier.getUrl()]]);
  });
  return { nom: fichier.getName(), url: fichier.getUrl(), id: fichier.getId(), attestation: a };
}

/** Remplace {{TAMPON}} par l'image du tampon (ou le retire s'il n'y en a pas). */
function placerTampon_(corps, tamponId) {
  var r;
  while ((r = corps.findText('\\{\\{TAMPON\\}\\}'))) {
    var texte = r.getElement().asText();
    texte.deleteText(r.getStartOffset(), r.getEndOffsetInclusive());
    if (tamponId) {
      try {
        var blob = DriveApp.getFileById(tamponId).getBlob();
        var para = texte.getParent().asParagraph();
        var img = para.appendInlineImage(blob), l = img.getWidth(), h = img.getHeight(), cible = 150;
        if (l > 0) { img.setWidth(cible); img.setHeight(Math.round(h * cible / l)); }
      } catch (e) { /* image illisible : l'attestation reste valable sans le tampon */ }
      tamponId = null;   // une seule fois
    }
  }
}


/* ------------------------------------------------------- versions du budget */
/* « Figer » copie le budget de travail d'une saison dans BudgetFige sous un nom
 * (ex. « Voté en conseil de groupe du 15/11 »). Le budget de travail reste modifiable :
 * c'est la version en cours. Une version peut être la référence (le budget voté). */

/** Montant figé d'un poste : les postes « par jeune » gardent leur montant au moment du gel. */
function montantFige_(p, eff) { return Engine.montantPoste(p, eff); }

function figerBudget(saison, nom, commentaire, reference) {
  if (!String(nom || '').trim()) throw new Error('Donne un nom à la version.');
  return verrou_(function () {
    var postes = lireTable_('Budget').filter(function (p) { return String(p.saison) === saison; });
    if (!postes.length) throw new Error('Pas de budget à figer pour ' + saison + '.');
    var eff = Engine.compilerEffectifs(lireTable_('Effectifs'));
    var versions = lireTable_('Versions');
    var v = { id: nouvelId_(), saison: saison, nom: String(nom).trim(), date: Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM-dd HH:mm'),
      commentaire: String(commentaire || ''), reference: !!reference };
    if (v.reference) versions.forEach(function (x) { if (x.saison === saison) x.reference = false; });
    versions.push(v);
    var fige = lireTable_('BudgetFige');
    postes.forEach(function (p) {
      var c = {}; TABLES.BudgetFige.forEach(function (col) { c[col[0]] = p[col[0]] === undefined ? '' : p[col[0]]; });
      c.version = v.id;
      // Montant figé : les postes calculés (par jeune, qté × prix) sont gelés en montant
      c.montant = montantFige_(p, eff);
      c.effectif = Engine.quantitePoste(p, eff) || '';
      fige.push(c);
    });
    ecrireTable_('Versions', versions);
    ecrireTable_('BudgetFige', fige);
    return { versions: versions, budgetFige: fige };
  });
}

function definirReference(id, actif) {
  return verrou_(function () {
    var versions = lireTable_('Versions'), v = versions.filter(function (x) { return x.id === id; })[0];
    if (!v) throw new Error('Version introuvable.');
    versions.forEach(function (x) { if (x.saison === v.saison) x.reference = actif ? x.id === id : (x.id === id ? false : x.reference); });
    ecrireTable_('Versions', versions);
    return versions;
  });
}

function supprimerVersion(id) {
  return verrou_(function () {
    ecrireTable_('Versions', lireTable_('Versions').filter(function (x) { return x.id !== id; }));
    ecrireTable_('BudgetFige', lireTable_('BudgetFige').filter(function (x) { return x.version !== id; }));
    return true;
  });
}

/** Remplace le budget de travail de la saison par une version figée (postes d'origine, méthodes comprises). */
function restaurerVersion(id) {
  return verrou_(function () {
    var v = lireTable_('Versions').filter(function (x) { return x.id === id; })[0];
    if (!v) throw new Error('Version introuvable.');
    var fige = lireTable_('BudgetFige').filter(function (x) { return x.version === id; });
    var autres = lireTable_('Budget').filter(function (p) { return String(p.saison) !== v.saison; });
    var nouveaux = fige.map(function (c) {
      var p = nettoyer_('Budget', c); p.id = nouvelId_(); p.saison = v.saison;
      // Les postes calculés retrouvent leur méthode : leur montant figé n'est qu'un rappel
      if (p.methode && p.methode !== 'montant') p.montant = '';
      return p;
    });
    ecrireTable_('Budget', autres.concat(nouveaux));
    return nouveaux;
  });
}


/* ------------------------------------------------------ e-mail hebdomadaire */
/* Chaque lundi matin : ce qui reste à faire (à classer, justificatifs, rapprochement,
 * engagements, routine du mois, jeton GitHub). Déclencheur Apps Script géré depuis Paramètres. */
function configNotifications_() {
  var p = PropertiesService.getScriptProperties(), c = { actif: false, destinataire: p.getProperty('EMAIL_HEBDO') || '', parDefaut: '' };
  try {
    c.actif = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'envoyerResumeHebdo'; });
    c.parDefaut = Session.getEffectiveUser().getEmail() || '';
  } catch (e) { c.aAutoriser = true; }   // autorisations pas encore accordées : lancer « autoriser » dans l'éditeur
  return c;
}

function configurerEmailHebdo(actif, destinataire) {
  var p = PropertiesService.getScriptProperties();
  if (destinataire !== undefined) p.setProperty('EMAIL_HEBDO', String(destinataire || '').trim());
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'envoyerResumeHebdo') ScriptApp.deleteTrigger(t); });
  if (actif) ScriptApp.newTrigger('envoyerResumeHebdo').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).inTimezone('Europe/Paris').create();
  return configNotifications_();
}

/** Points à traiter pour la saison courante (utilisé par l'e-mail). */
function pointsATraiter_() {
  var d = getDonnees(), saison = (d.saisons.filter(function (x) { return x.courante; })[0] || {}).code;
  var C = {};
  d.saisons.forEach(function (x) { C[x.code] = Engine.classer(d.ventilations[x.code] || [], d.regles, d.unites, d.corrections); });
  var v = C[saison] || [], ecr = d.ecritures[saison] || [];
  var aClasser = v.filter(function (x) { return !x.ligne; });
  var j = Engine.controleJustificatifs(ecr, d.fichiers);
  var nr = Engine.nonRapprochees(ecr, new Date(), 15);
  var corr = Engine.correspondancesEngagements(d.engagements, v, saison);
  var dernier = d.journal.length ? d.journal[d.journal.length - 1] : null;
  var exp = d.github.expiration, joursExp = exp ? Math.round((new Date(exp + 'T12:00:00') - new Date()) / 86400000) : null;
  return { saison: saison, aClasser: aClasser, manquants: j.manquants, nonRapprochees: nr, engagements: corr, dernier: dernier, expiration: exp, joursExpiration: joursExp };
}

function envoyerResumeHebdo(test) {
  var cfg = configNotifications_(), a = cfg.destinataire || cfg.parDefaut;
  if (!a) throw new Error('Aucun destinataire.');
  var P = pointsATraiter_(), url = urlApp_();
  function euros(n) { return montantFr_(n); }
  function dfr(iso) { var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; }
  function bloc(titre, n, lignes) {
    if (!n) return '<p style="margin:6px 0">✅ ' + titre + ' : rien à signaler.</p>';
    return '<p style="margin:14px 0 4px"><b>⚠️ ' + titre + ' : ' + n + '</b></p><ul style="margin:0;padding-left:18px;color:#333">' +
      lignes.slice(0, 15).map(function (l) { return '<li>' + l + '</li>'; }).join('') + (n > 15 ? '<li>… et ' + (n - 15) + ' autre(s)</li>' : '') + '</ul>';
  }
  function e(t) { return String(t || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var n = P.aClasser.length + P.manquants.length + P.nonRapprochees.length + P.engagements.length;
  var h = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1d2433;max-width:640px">' +
    '<h2 style="margin:0 0 4px;color:#1f4e79">' + e(identite_().titre) + ' — point de la semaine</h2>' +
    '<p style="margin:0 0 12px;color:#666">Saison ' + e(P.saison) + (P.dernier ? ' · données Comptaweb du ' + e(String(P.dernier.date).slice(0, 16).replace('T', ' ')) : '') + '</p>' +
    bloc('Écritures à classer', P.aClasser.length, P.aClasser.map(function (x) { return dfr(x.date) + ' — ' + e(x.intitule) + ' (' + e(x.activite) + ' / ' + e(x.nature) + ')'; })) +
    bloc('Justificatifs manquants', P.manquants.length, P.manquants.map(function (m) { return dfr(m.ecriture.date) + ' — ' + e(m.ecriture.intitule) + ' — ' + euros(m.ecriture.depense) + ' (' + e(m.probleme) + ')'; })) +
    bloc('Écritures non rapprochées depuis plus de 15 jours', P.nonRapprochees.length, P.nonRapprochees.map(function (x) { return dfr(x.date) + ' — ' + e(x.intitule) + ' — ' + euros(x.depense || x.recette); })) +
    bloc('Engagements dont l’écriture est arrivée', P.engagements.length, P.engagements.map(function (c) { return e(c.engagement.libelle || c.engagement.ligne) + ' — ' + euros(c.engagement.montant); })) +
    (P.joursExpiration !== null && P.joursExpiration <= 30 ? '<p style="margin:14px 0;color:#b42318"><b>⏳ Le jeton GitHub du robot expire le ' + dfr(P.expiration) + '</b> : crée-en un nouveau et colle-le dans Paramètres › Imports.</p>' : '') +
    (url ? '<p style="margin:18px 0"><a href="' + url + '" style="background:#1f4e79;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Ouvrir ' + e(identite_().titre) + '</a></p>' : '') +
    '<p style="color:#999;font-size:12px">E-mail envoyé chaque lundi par ' + e(identite_().titre) + '. Pour l’arrêter : Paramètres › Imports › E-mail hebdomadaire.</p></div>';
  MailApp.sendEmail({ to: a, subject: (test ? '[Test] ' : '') + identite_().titre + ' — ' + (n ? n + ' point(s) à traiter' : 'tout est à jour'), htmlBody: h, name: identite_().titre });
  return a;
}

/** Envoi d'essai depuis Paramètres. */
function envoyerResumeTest() { return envoyerResumeHebdo(true); }

/* ------------------------------------------------------------ routine du mois */
function cocherRoutine(mois, etape, fait) {
  return verrou_(function () {
    var rows = lireTable_('Routine').filter(function (r) { return !(String(r.mois) === mois && r.etape === etape); });
    if (fait) rows.push({ mois: mois, etape: etape, faitLe: Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM-dd HH:mm'), par: Session.getEffectiveUser().getEmail() || '' });
    ecrireTable_('Routine', rows);
    return rows;
  });
}


/* ------------------------------------------------- dépôt de justificatifs */
/**
 * Range un ou plusieurs fichiers (photos, PDF) dans le dossier des justificatifs sous le nom
 * « <n° de pièce> - <description>.<ext> » (puis « (2) », « (3) »…), ce qui les fait reconnaître
 * par les contrôles. fichiers : [{nom, type, base64}]. Renvoie [{nom, url, id}].
 */
function deposerJustificatif(piece, description, fichiers) {
  var dossierId = PropertiesService.getScriptProperties().getProperty('DOSSIER_JUSTIFICATIFS');
  if (!dossierId) throw new Error('Indique d’abord le dossier Drive des justificatifs (Paramètres › Attestations).');
  piece = String(piece || '').trim();
  if (!/^\d{7,8}_\d+$/.test(piece)) throw new Error('N° de pièce invalide : ' + piece);
  if (!fichiers || !fichiers.length) throw new Error('Aucun fichier.');
  var dossier = DriveApp.getFolderById(dossierId);
  var desc = String(description || '').replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Justificatif';
  var out = fichiers.map(function (f, i) {
    var ext = (String(f.nom || '').match(/\.[A-Za-z0-9]{2,5}$/) || [''])[0].toLowerCase() || (/pdf/.test(f.type) ? '.pdf' : '.jpg');
    var nom = piece + ' - ' + desc + (fichiers.length > 1 ? ' (' + (i + 1) + ')' : '') + ext;
    var fichier = dossier.createFile(Utilities.newBlob(Utilities.base64Decode(f.base64), f.type || 'application/octet-stream', nom));
    return { nom: fichier.getName(), url: fichier.getUrl(), id: fichier.getId() };
  });
  verrou_(function () {
    var sh = onglet_(ONGLET_FICHIERS, true);
    if (sh.getLastRow() < 1) sh.getRange(1, 1, 1, 3).setValues([['File Name', 'Id', 'Lien']]);
    sh.getRange(sh.getLastRow() + 1, 1, out.length, 3).setValues(out.map(function (o) { return [o.nom, o.id, o.url]; }));
  });
  return out;
}


/* ------------------------------------------------- adresse de l'application */
/* ScriptApp.getService().getUrl() renvoie souvent l'adresse d'un ancien déploiement :
 * l'adresse réelle (celle du déploiement Application Web) est enregistrée dans Paramètres. */
function urlApp_() {
  var u = PropertiesService.getScriptProperties().getProperty('APP_URL');
  if (u) return u;
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}
function enregistrerUrlApp(url) {
  url = String(url || '').trim();
  if (url && !/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) throw new Error('Adresse attendue : https://script.google.com/macros/s/…/exec');
  var p = PropertiesService.getScriptProperties();
  if (url) p.setProperty('APP_URL', url); else p.deleteProperty('APP_URL');
  return urlApp_();
}


/** Supprime une attestation : PDF à la corbeille, ligne du registre et de la liste des fichiers retirées. */
function supprimerAttestation(fichierId) {
  try { DriveApp.getFileById(fichierId).setTrashed(true); } catch (e) { /* déjà supprimé à la main */ }
  return verrou_(function () {
    ecrireTable_('Attestations', lireTable_('Attestations').filter(function (a) { return a.fichier !== fichierId; }));
    var sh = onglet_(ONGLET_FICHIERS);
    if (sh && sh.getLastRow() > 1) {
      var vals = sh.getDataRange().getValues(), garde = vals.filter(function (r, i) { return i === 0 || String(r[1]) !== fichierId; });
      if (garde.length !== vals.length) {
        sh.clearContents();
        sh.getRange(1, 1, garde.length, garde[0].length).setValues(garde);
      }
    }
    return lireTable_('Attestations');
  });
}


/* ------------------------------------------------------- identité du groupe */
/* Nom, nom court, adresse, ville et logo : valeurs par défaut du build (Seed.groupe),
 * remplacées par celles saisies dans Paramètres › Groupe (propriétés du script). */
function identite_() {
  var p = PropertiesService.getScriptProperties(), d = Seed.groupe || {};
  function v(cle, defaut) { var x = p.getProperty(cle); return x === null ? (defaut || '') : x; }
  var g = { nom: v('GROUPE_NOM', d.nom), court: v('GROUPE_COURT', d.court), adresse: v('GROUPE_ADRESSE', d.adresse), ville: v('GROUPE_VILLE', d.ville) };
  g.titre = g.court ? 'Budget ' + g.court : 'Budget du groupe';
  var n = Number(p.getProperty('GROUPE_LOGO_N') || 0), logo = '';
  for (var i = 0; i < n; i++) logo += p.getProperty('GROUPE_LOGO_' + i) || '';
  g.logo = logo;
  g.configure = !!g.nom;
  return g;
}

function enregistrerGroupe(g) {
  var p = PropertiesService.getScriptProperties();
  ['nom', 'court', 'adresse', 'ville'].forEach(function (k) { p.setProperty('GROUPE_' + k.toUpperCase(), String((g || {})[k] || '').trim()); });
  return identite_();
}

/** Logo (data URL d'une image déjà réduite par le navigateur), découpé en morceaux de 8 000 caractères. */
function enregistrerLogo(dataUrl) {
  var p = PropertiesService.getScriptProperties(), t = String(dataUrl || '');
  if (t && !/^data:image\/(png|jpeg|webp);base64,/.test(t)) throw new Error('Image PNG ou JPEG attendue.');
  if (t.length > 200000) throw new Error('Logo trop lourd : réduis-le (200 × 200 px suffit).');
  var n = Number(p.getProperty('GROUPE_LOGO_N') || 0);
  for (var i = 0; i < n; i++) p.deleteProperty('GROUPE_LOGO_' + i);
  var morceaux = t ? t.match(/[\s\S]{1,8000}/g) : [];
  morceaux.forEach(function (m, k) { p.setProperty('GROUPE_LOGO_' + k, m); });
  p.setProperty('GROUPE_LOGO_N', String(morceaux.length));
  return identite_();
}

/** Dépôt GitHub du robot (« propriétaire/nom ») : propriété du script, sinon valeur du build. */
function depotRobot_() {
  var v = PropertiesService.getScriptProperties().getProperty('GITHUB_DEPOT');
  return v === null ? (Seed.depot || '') : v;
}
function enregistrerDepotRobot(depot) {
  depot = String(depot || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  if (depot && !/^[\w.-]+\/[\w.-]+$/.test(depot)) throw new Error('Format attendu : propriétaire/nom-du-dépôt');
  PropertiesService.getScriptProperties().setProperty('GITHUB_DEPOT', depot);
  return depot;
}

/** Saison en cours (septembre → août) pour une installation neuve. */
function saisonDuJour_() {
  var d = new Date(), a = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  var code = a + '-' + String(a + 1).slice(2);
  var mois = ['Sept', 'Août'];
  return { code: code, onglet: 'Ecritures ' + code, debut: a + '-09-01', courante: true, exercice: mois[0] + ' ' + a + ' - ' + mois[1] + ' ' + (a + 1) };
}
