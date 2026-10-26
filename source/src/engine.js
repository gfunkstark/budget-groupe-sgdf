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
