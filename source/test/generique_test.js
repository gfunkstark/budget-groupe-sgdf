/* Version générique : installation d'un nouveau groupe dans un faux Apps Script.
 *   python3 build/build.py --generique && node test/generique_test.js */
var fs = require('fs'), path = require('path'), vm = require('vm');
var ctx = { console: console, Date: Date, JSON: JSON, Math: Math };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'fake_gas.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'dist-generique', 'Code.gs'), 'utf8'), ctx);
var ok = 0, ko = 0;
function eq(nom, a, b) { var bon = JSON.stringify(a) === JSON.stringify(b); if (bon) ok++; else { ko++; console.log('ÉCHEC ' + nom + ' : attendu ' + JSON.stringify(a) + ', obtenu ' + JSON.stringify(b)); } }
function appel(nom) { ctx.ARGS = Array.prototype.slice.call(arguments, 1); return vm.runInContext('JSON.parse(JSON.stringify(' + nom + '.apply(null, ARGS)))', ctx); }

appel('installer');
var d = appel('getDonnees');
var a = new Date().getMonth() >= 8 ? new Date().getFullYear() : new Date().getFullYear() - 1;
eq('saison du jour créée', [a + '-' + String(a + 1).slice(2)], d.saisons.map(function (s) { return s.code; }));
eq('saison courante', true, d.saisons[0].courante);
eq('exercice Comptaweb proposé', 'Sept ' + a + ' - Août ' + (a + 1), d.saisons[0].exercice);
eq('lignes standard', true, d.lignes.length > 15 && d.lignes.some(function (l) { return l.ligne === 'Participation au Mouvement' && l.budget === 'par_jeune'; }));
eq('budget vide', 0, d.budget.length);
eq('groupe à renseigner', false, d.groupe.configure);
eq('titre par défaut', 'Budget du groupe', d.groupe.titre);
eq('pas de dépôt robot', '', d.github.depot);
var g = appel('enregistrerGroupe', { nom: 'Groupe Exemple', court: 'Exemple', adresse: '1, rue de la Paix — 75002 Paris', ville: 'Paris' });
eq('groupe enregistré', ['Budget Exemple', true], [g.titre, g.configure]);
var logo = 'data:image/png;base64,' + new Array(20001).join('A');
eq('logo en plusieurs morceaux', logo, appel('enregistrerLogo', logo).logo);
eq('logo retiré', '', appel('enregistrerLogo', '').logo);
eq('dépôt robot', 'tresorier-exemple/budget-robot', appel('enregistrerDepotRobot', 'https://github.com/tresorier-exemple/budget-robot.git'));
appel('enregistrerDossierJustificatifs', 'dossierABCDEFGHIJKLMNOPQRSTUVWXYZ');
appel('creerModeleAttestation');
var txt = vm.runInContext('Object.keys(FAUX.drive.textes).map(function(k){return FAUX.drive.textes[k]}).join("\\n")', ctx);
eq('modèle au nom du groupe', true, /Groupe Exemple/.test(txt) && /1, rue de la Paix/.test(txt) && /Fait à Paris/.test(txt) && !/Vaugirard/.test(txt));
ctx.FAUX.derniereVersion = '1.0.0';
eq('à jour', true, appel('verifierMiseAJour').aJour);
ctx.FAUX.derniereVersion = '9.1.0';
eq('mise à jour disponible', ['9.1.0', false], [appel('verifierMiseAJour').derniere, appel('verifierMiseAJour').aJour]);
console.log(ok + ' tests réussis, ' + ko + ' échecs');
process.exit(ko ? 1 : 0);
