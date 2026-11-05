// Tests du moteur de pronostics : node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { window: {}, Math, Number, String, Object, Array, Set, Map, Date, Intl };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8'), ctx);
const E = ctx.window.Engine;
const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

const team = (name, extra = {}) => ({ id: name, name, short: name, record: '6-3-3', form: 'WDWLW', ...extra });
const match = (extra = {}) => ({
  id: 'x', sport: 'soccer', src: { path: 'soccer/fra.1' }, state: 'pre', date: '2026-11-05T20:00:00Z',
  home: team('A'), away: team('B'), ...extra,
});

test('devig « power » : somme 1 et favori moins chargé que l’outsider', () => {
  const p = E.devig([1.5, 4.2, 6.5]);
  near(p.reduce((a, b) => a + b, 0), 1);
  // division proportionnelle pour comparaison
  const inv = [1 / 1.5, 1 / 4.2, 1 / 6.5], s = inv.reduce((a, b) => a + b, 0);
  assert.ok(p[0] > inv[0] / s, 'le favori gagne en probabilité');
  assert.ok(p[2] < inv[2] / s, 'l’outsider perd en probabilité');
  assert.equal(E.devig([1.9, null]), null);
});

test('grille de buts (Dixon-Coles) : probabilités cohérentes', () => {
  const g = E.goals(1.4, 1.1);
  near(g.home + g.draw + g.away, 1);
  near(g.over(-1), 1);
  assert.ok(g.draw > 0.24 && g.draw < 0.32);
});

test('tennis : 3 sets gagnants plus favorable au meilleur joueur', () => {
  near(E.matchWin(0.6, 2), 0.6 * 0.6 * (3 - 2 * 0.6));
  assert.ok(E.matchWin(0.6, 3) > E.matchWin(0.6, 2));
  near(E.matchWin(E.setProbFrom(0.7, 3), 3), 0.7);
});

test('settle : sets avec ligne, ancien format, 90 minutes', () => {
  assert.equal(E.settle({ type: 'sets', side: 'Y' }, { sets: 3 }), true);
  assert.equal(E.settle({ type: 'sets', side: 'Y', line: 3.5 }, { sets: 3 }), false);
  assert.equal(E.settle({ type: 'sets', side: 'N', line: 4.5 }, { sets: 4 }), true);
  assert.equal(E.settle({ type: 'ml', side: 'D' }, { h: 1, a: 1 }), true);
  assert.equal(E.settle({ type: 'dnb', side: 'H' }, { h: 1, a: 1 }), null);
  assert.equal(E.settle({ type: 'ou', side: 'O', line: 2.5 }, { h: 2, a: 1 }), true);
});

test('sans cote Pinnacle : jamais de pari value', () => {
  const m = match({ books: { betclic: { ml: { H: 2.6, D: 3.3, A: 2.9 }, ou: {}, hcp: {} } } });
  const a = E.analyze(m);
  assert.equal(a.value, false);
  assert.ok(a.bets.every(b => !E.isValue(b)));
});

test('avec Pinnacle : value détectée quand Betclic paie plus que la cote juste', () => {
  const m = match({
    books: {
      pinnacle: { ml: { H: 2.0, D: 3.6, A: 4.0 }, ou: { 2.5: { O: 1.95, U: 1.95 } }, hcp: {} },
      betclic: { ml: { H: 2.25, D: 3.3, A: 3.4 }, ou: { 2.5: { O: 1.8, U: 1.95 } }, hcp: {} },
      winamax: { ml: { H: 2.1, D: 3.4, A: 3.5 }, ou: {}, hcp: {} },
    },
  });
  const a = E.analyze(m);
  const home = a.bets.find(b => b.type === 'ml' && b.side === 'H');
  near(home.p, E.devig([2.0, 3.6, 4.0])[0], 1e-6); // Pinnacle seul, pas de mélange avec le modèle
  assert.equal(home.bestOdd.v, 2.25);
  assert.equal(home.bestBook, 'betclic');
  assert.equal(home.evSrc, 'sharp');
  assert.ok(E.isValue(home));
  assert.equal(a.value, true);
  assert.equal(a.best.label, home.label);
  // « Les deux marquent » est extrapolé : jamais value prouvée
  assert.ok(a.bets.filter(b => b.type === 'btts').every(b => !E.isValue(b)));
  // Kelly : 1/4 de Kelly, plafonné à 3 %
  const stake = E.stakeFor(home, 1000);
  assert.ok(stake > 0 && stake <= 30, `mise ${stake}`);
});

test('rugby : 1N2 avec un vrai match nul', () => {
  const m = match({ sport: 'rugby', src: { path: 'rugby/270559' } });
  const a = E.analyze(m);
  const ml = a.bets.filter(b => b.type === 'ml');
  assert.equal(ml.length, 3);
  near(ml.reduce((s, b) => s + b.p, 0), 1, 0.02);
  const d = ml.find(b => b.side === 'D').p;
  assert.ok(d > 0.01 && d < 0.06, `nul ${d}`);
});

test('tennis Grand Chelem : paris en 3,5 / 4,5 sets', () => {
  const p = (n, pts) => ({ name: n, short: n, rank: 10, rankPts: pts });
  const a = E.analyze({ id: 't', sport: 'tennis', src: { path: 'tennis/atp' }, state: 'pre', bo: 5, home: p('X', 5000), away: p('Y', 2000) });
  const lines = a.bets.filter(b => b.type === 'sets').map(b => b.line);
  assert.deepEqual([...new Set(lines)], [3.5, 4.5]);
  const b3 = E.analyze({ id: 't', sport: 'tennis', src: { path: 'tennis/atp' }, state: 'pre', home: p('X', 5000), away: p('Y', 2000) });
  assert.deepEqual([...new Set(b3.bets.filter(b => b.type === 'sets').map(b => b.line))], [2.5]);
});

test('en direct : estimation sans erreur pour le foot et le tennis', () => {
  const m = match({ state: 'in', clock: 60 * 60, detail: "60'", home: team('A', { score: '1' }), away: team('B', { score: '0' }) });
  const l = E.live(m);
  assert.ok(l && l.bets.length > 0);
  const g = (v, w) => ({ v, w });
  const t = E.live({ id: 't', sport: 'tennis', src: { path: 'tennis/atp' }, state: 'in', bo: 5,
    home: { name: 'X', short: 'X', rankPts: 3000, games: [g(6, true), g(2, false)] },
    away: { name: 'Y', short: 'Y', rankPts: 3000, games: [g(3, false), g(4, false)] } });
  assert.ok(t.bets.some(b => b.type === 'sets' && b.line === 3.5));
});
