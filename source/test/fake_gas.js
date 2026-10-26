/* Faux environnement Apps Script (classeur en mémoire) pour tester Code.gs
 * dans node ou dans un navigateur. */
(function (G) {
  function Feuille(nom) { this.nom = nom; this.cases = []; }
  Feuille.prototype = {
    getName: function () { return this.nom; },
    getLastRow: function () {
      for (var i = this.cases.length; i > 0; i--) if (this.cases[i - 1].some(function (c) { return c !== '' && c !== undefined; })) return i;
      return 0;
    },
    getLastColumn: function () { return this.cases.reduce(function (m, r) { return Math.max(m, r.length); }, 0); },
    getRange: function (r, c, nr, nc) { return new Plage(this, r, c, nr || 1, nc || 1); },
    getDataRange: function () { return new Plage(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); },
    clearContents: function () { this.cases = []; return this; },
    clear: function () { this.cases = []; return this; },
    setFrozenRows: function () { return this; }
  };
  function Plage(f, r, c, nr, nc) { this.f = f; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  Plage.prototype = {
    getValues: function () {
      var out = [];
      for (var i = 0; i < this.nr; i++) {
        var row = this.f.cases[this.r - 1 + i] || [], o = [];
        for (var j = 0; j < this.nc; j++) { var v = row[this.c - 1 + j]; o.push(v === undefined ? '' : v); }
        out.push(o);
      }
      return out;
    },
    setValues: function (v) {
      if (v.length !== this.nr || v.some(function (r) { return r.length !== this.nc; }, this)) throw new Error('Dimensions incohérentes');
      for (var i = 0; i < this.nr; i++) {
        var k = this.r - 1 + i;
        while (this.f.cases.length <= k) this.f.cases.push([]);
        for (var j = 0; j < this.nc; j++) this.f.cases[k][this.c - 1 + j] = v[i][j];
      }
      return this;
    },
    setNumberFormat: function () { return this; },
    setFontWeight: function () { return this; }
  };
  var classeur = {
    feuilles: [new Feuille('Feuille 1')],
    getId: function () { return 'faux-id'; },
    getUrl: function () { return 'https://docs.google.com/spreadsheets/d/faux-id/edit'; },
    getSheetByName: function (n) { return this.feuilles.filter(function (f) { return f.nom === n; })[0] || null; },
    insertSheet: function (n) { var f = new Feuille(n); this.feuilles.push(f); return f; },
    getSheets: function () { return this.feuilles.slice(); },
    deleteSheet: function (f) { this.feuilles = this.feuilles.filter(function (x) { return x !== f; }); }
  };
  var props = {};
  G.FAUX = { classeur: classeur, props: props, fetchs: [] };
  G.SpreadsheetApp = { getActiveSpreadsheet: function () { return classeur; }, openById: function () { return classeur; } };
  G.PropertiesService = { getScriptProperties: function () {
    return { getProperty: function (k) { return props[k] || null; }, setProperty: function (k, v) { props[k] = v; }, deleteProperty: function (k) { delete props[k]; } };
  } };
  G.LockService = { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } };
  var n = Math.floor(Math.random() * 1e7) * 16;  // ids uniques même entre deux chargements du faux classeur
  G.Utilities = { getUuid: function () { n++; return ('0000000' + n.toString(16)).slice(-8) + '-xxxx'; } };
  G.UrlFetchApp = { fetch: function (url, o) {
    G.FAUX.fetchs.push({ url: url, o: o });
    if (/raw\.githubusercontent/.test(url)) return { getResponseCode: function () { return 200; }, getContentText: function () { return G.FAUX.derniereVersion || '1.0.0'; } };
    var runs = { workflow_runs: [{ run_started_at: new Date().toISOString(), status: 'completed', conclusion: 'success', event: 'workflow_dispatch', html_url: 'https://github.com/x' }] };
    return { getResponseCode: function () { return /dispatches/.test(url) ? 204 : 200; }, getContentText: function () { return /dispatches/.test(url) ? '' : JSON.stringify(runs); },
      getAllHeaders: function () { return { 'GitHub-Authentication-Token-Expiration': '2026-11-10 12:00:00 UTC' }; } };
  } };
  /* --- Drive et Docs factices (attestations) : tout appel de méthode inconnu renvoie l'objet lui-même --- */
  function chaine(extra) {
    var p = new Proxy(function () {}, { get: function (t, k) {
      if (extra && k in extra) return extra[k];
      if (k === 'then') return undefined;
      return function () { return p; };
    } });
    return p;
  }
  var drive = { fichiers: {}, n: 0, textes: {} };
  function nouveauFichier(nom, contenu, type) {
    var id = 'f' + (++drive.n) + 'xxxxxxxxxxxxxxxxxxxxxxxxxxx';
    var f = { id: id, nom: nom, contenu: contenu, type: type, corbeille: false };
    drive.fichiers[id] = f;
    return objetFichier(f);
  }
  function objetFichier(f) {
    var o = {
      getId: function () { return f.id; }, getName: function () { return f.nom; }, getUrl: function () { return 'https://drive.google.com/file/d/' + f.id + '/view'; },
      setTrashed: function (v) { f.corbeille = v; return o; }, moveTo: function () { return o; },
      getParents: function () { var fait = false; return { hasNext: function () { return !fait; }, next: function () { fait = true; return dossierFactice('racine', 'Dossier du classeur'); } }; },
      makeCopy: function (nom) { var c = nouveauFichier(nom, f.contenu, f.type); drive.textes[c.getId()] = (drive.textes[f.id] || '').slice(); return c; },
      getAs: function (type) { var b = { nom: '', type: type, source: f.id, setName: function (n) { b.nom = n; return b; }, getName: function () { return b.nom; } }; return b; },
      getBlob: function () { return { type: f.type, bytes: f.contenu }; }
    };
    return o;
  }
  function dossierFactice(id, nom) {
    return { getId: function () { return id; }, getName: function () { return nom; },
      createFile: function (blob) { var fi = nouveauFichier(blob.getName ? blob.getName() : blob.nom, blob, blob.type); drive.fichiers[fi.getId()].dossier = id; drive.fichiers[fi.getId()].texte = drive.textes[blob.source]; return fi; } };
  }
  G.DriveApp = {
    getFolderById: function (id) { if (!/^dossier/.test(id)) throw new Error('Dossier introuvable'); return dossierFactice(id, 'Justificatifs du groupe'); },
    getFileById: function (id) { if (id === 'faux-id') return objetFichier({ id: id, nom: 'classeur' }); var f = drive.fichiers[id]; if (!f) throw new Error('Fichier introuvable ' + id); return objetFichier(f); },
    getRootFolder: function () { return dossierFactice('racine', 'Mon Drive'); }
  };
  /* Objets Docs stricts : une méthode qui n'existe pas dans Apps Script lève une erreur, comme en vrai. */
  function strict(nom, methodes) {
    return new Proxy(methodes, { get: function (t, k) {
      if (k in t) return t[k];
      if (typeof k === 'symbol' || k === 'then' || k === 'toJSON') return undefined;
      throw new TypeError(nom + '.' + String(k) + ' n\'existe pas dans Apps Script');
    } });
  }
  function texteDocs() { var t = strict('Text', {}); ['setFontSize', 'setForegroundColor', 'setItalic', 'setBold'].forEach(function (m) { t[m] = function () { return t; }; }); return t; }
  function paragrapheFactice(id) {
    var p = strict('Paragraph', {
      appendText: function (x) { drive.textes[id] = (drive.textes[id] || '') + x; return texteDocs(); },
      setText: function (x) { drive.textes[id] = (drive.textes[id] || '') + x; },   // void, comme en vrai
      setHeading: function () { return p; }, setAlignment: function () { return p; }, editAsText: function () { return texteDocs(); }
    });
    return p;
  }
  function corpsFactice(id) {
    var corps = strict('Body', {
      replaceText: function (motif, remplacement) { var re = new RegExp(motif, 'g'); drive.textes[id] = (drive.textes[id] || '').replace(re, remplacement); return corps; },
      findText: function () { return null; },
      appendParagraph: function (t) { drive.textes[id] = (drive.textes[id] || '') + '\n' + t; return paragrapheFactice(id); },
      appendTable: function (rows) {
        drive.textes[id] = (drive.textes[id] || '') + '\n' + rows.map(function (r) { return r.join(' | '); }).join('\n');
        var cellule = strict('TableCell', {}); cellule.setBackgroundColor = function () { return cellule; }; cellule.setWidth = function () { return cellule; }; cellule.editAsText = function () { return texteDocs(); };
        var table = strict('Table', { getNumRows: function () { return rows.length; }, getCell: function () { return cellule; } });
        table.setBorderColor = function () { return table; }; table.setBorderWidth = function () { return table; };
        return table;
      },
      getParagraphs: function () { return [paragrapheFactice(id)]; }
    });
    ['setMarginTop', 'setMarginBottom', 'setMarginLeft', 'setMarginRight'].forEach(function (m) { corps[m] = function () { return corps; }; });
    return corps;
  }
  G.DocumentApp = {
    ParagraphHeading: { TITLE: 'TITLE' }, HorizontalAlignment: { CENTER: 'CENTER' },
    create: function (nom) { var f = nouveauFichier(nom, '', 'doc'); var id = f.getId(); return chaine({ getId: function () { return id; }, getBody: function () { return corpsFactice(id); }, saveAndClose: function () {} }); },
    openById: function (id) { return chaine({ getBody: function () { return corpsFactice(id); }, saveAndClose: function () {} }); },
    getActiveDocument: function () { return null; }
  };
  G.Utilities.formatDate = function (d, tz, f) { var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return f.replace('yyyy', d.getFullYear()).replace('MM', p(d.getMonth() + 1)).replace('dd', p(d.getDate())).replace('HH', p(d.getHours())).replace('mm', p(d.getMinutes())); };
  G.Utilities.base64Decode = function (b) { return 'octets:' + b; };
  G.Utilities.newBlob = function (octets, type, nom) { return { nom: nom, type: type, octets: octets, getName: function () { return nom; } }; };
  G.FAUX.drive = drive;
  var declencheurs = [], mails = [];
  G.FAUX.declencheurs = declencheurs; G.FAUX.mails = mails;
  G.ScriptApp = {
    WeekDay: { MONDAY: 'MONDAY' },
    getProjectTriggers: function () { return declencheurs.slice(); },
    deleteTrigger: function (t) { var i = declencheurs.indexOf(t); if (i >= 0) declencheurs.splice(i, 1); },
    newTrigger: function (f) { var b = { timeBased: function () { return b; }, onWeekDay: function () { return b; }, atHour: function () { return b; }, inTimezone: function () { return b; },
      create: function () { var t = { getHandlerFunction: function () { return f; } }; declencheurs.push(t); return t; } }; return b; },
    getService: function () { return { getUrl: function () { return 'https://script.google.com/macros/s/faux/exec'; } }; }
  };
  G.Session = { getEffectiveUser: function () { return { getEmail: function () { return 'tresoriers.slv@gmail.com'; } }; } };
  G.MailApp = { sendEmail: function (o) { mails.push(o); }, getRemainingDailyQuota: function () { return 100; } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
