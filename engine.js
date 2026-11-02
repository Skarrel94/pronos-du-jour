(() => {
'use strict';
// Moteur de pronostics : transforme les données d'un match en probabilités par type de pari.
// Principe : une note de force par équipe (bilan + forme + domicile/extérieur),
// mélangée avec les probabilités implicites des cotes quand elles existent (le marché est
// le meilleur estimateur disponible), puis déclinée en marchés (1N2, over/under, handicap...).

const SPORT_CFG = {
  soccer:     { label: 'Football',        home: 0.32, k: 6 },
  basketball: { label: 'Basket',          home: 0.25, k: 8,  sd: 12,   total: 226, tsd: 18 },
  football:   { label: 'Football US',     home: 0.18, k: 6,  sd: 13.5, total: 45,  tsd: 13 },
  hockey:     { label: 'Hockey',          home: 0.15, k: 10, sd: 2.4,  total: 6,   tsd: 2.3 },
  baseball:   { label: 'Baseball',        home: 0.12, k: 20, sd: 4.2,  total: 8.5, tsd: 4.3 },
  rugby:      { label: 'Rugby',           home: 0.45, k: 6,  sd: 14,   total: 47,  tsd: 15 },
  afl:        { label: 'Foot australien', home: 0.30, k: 6,  sd: 30,   total: 165, tsd: 28 },
  tennis:     { label: 'Tennis',          home: 0 },
  mma:        { label: 'MMA',             home: 0 },
};

// Poids accordé au marché (cotes) face au modèle statistique.
const MARKET_WEIGHT = 0.7;

// ---------- Outils mathématiques ----------
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const logit = p => Math.log(p / (1 - p));
const sigmoid = x => 1 / (1 + Math.exp(-x));

function normCdf(x) {
  // Approximation d'Abramowitz-Stegun (erreur < 1e-7)
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function normInv(p) {
  let lo = -8, hi = 8;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (normCdf(mid) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function poissonPmf(lambda, max = 10) {
  const out = [];
  let p = Math.exp(-lambda);
  for (let k = 0; k <= max; k++) {
    out.push(p);
    p = p * lambda / (k + 1);
  }
  return out;
}

// Grille des scores exacts (domicile x extérieur) pour deux lois de Poisson indépendantes.
function scoreGrid(lh, la) {
  const ph = poissonPmf(lh), pa = poissonPmf(la);
  return ph.map(x => pa.map(y => x * y));
}

function gridStats(grid) {
  let home = 0, draw = 0, away = 0, btts = 0;
  const totals = {};
  let best = { p: 0, h: 0, a: 0 };
  grid.forEach((row, h) => row.forEach((p, a) => {
    if (h > a) home += p; else if (h === a) draw += p; else away += p;
    if (h > 0 && a > 0) btts += p;
    totals[h + a] = (totals[h + a] || 0) + p;
    if (p > best.p) best = { p, h, a };
  }));
  const over = line => Object.entries(totals).reduce((s, [t, p]) => s + (Number(t) > line ? p : 0), 0);
  return { home, draw, away, btts, over, best };
}

// ---------- Cotes ----------
// Cote américaine (+115 / -150) -> cote décimale (2.15 / 1.67)
function americanToDecimal(v) {
  const n = Number(String(v ?? '').replace('+', ''));
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

// Probabilités implicites sans la marge du bookmaker.
function devig(odds) {
  const inv = odds.map(o => (o ? 1 / o : 0));
  const sum = inv.reduce((a, b) => a + b, 0);
  if (!sum || inv.some(x => !x)) return null;
  return inv.map(x => x / sum);
}

// ---------- Lecture des bilans ----------
// "3-2-3" (football : V-N-D), "10-4-1" (V-D-prolongation), "4-3" (V-D) ou "WLLWD" (forme)
function parseRecord(summary, sport) {
  if (!summary) return null;
  if (/^[WDLTN]+$/i.test(summary)) {
    const f = formScore(summary);
    return f == null ? null : { pct: f, gp: summary.length };
  }
  const n = summary.split('-').map(Number);
  if (n.some(x => !Number.isFinite(x))) return null;
  let pts, gp;
  if (sport === 'soccer' && n.length === 3) { pts = n[0] + 0.5 * n[1]; gp = n[0] + n[1] + n[2]; }
  else if (n.length === 3 && sport !== 'hockey') { pts = n[0] + 0.5 * n[2]; gp = n[0] + n[1] + n[2]; } // V-D-N
  else { pts = n[0]; gp = n.reduce((a, b) => a + b, 0); }
  return gp ? { pct: pts / gp, gp } : null;
}

function formScore(form) {
  if (!form) return null;
  const vals = [...form.toUpperCase()].map(c => (c === 'W' ? 1 : c === 'L' ? 0 : 0.5));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

// Force d'une équipe (entre 0 et 1) + nombre de matchs disputés (pour la fiabilité).
function teamStrength(team, sport, side) {
  const k = SPORT_CFG[sport]?.k ?? 8;
  const parts = [];
  let gp = 0;
  if (team.record) {
    const r = parseRecord(team.record, sport);
    if (r) {
      gp = r.gp;
      parts.push([(r.pct * r.gp + 0.5 * k) / (r.gp + k), 0.6]);
    }
  }
  const f = formScore(team.form);
  if (f != null) parts.push([0.5 + (f - 0.5) * 0.7, 0.25]);
  const split = side === 'home' ? team.homeRecord : team.awayRecord;
  if (split) {
    const r = parseRecord(split, sport);
    if (r) parts.push([(r.pct * r.gp + 0.5 * k) / (r.gp + k), 0.15]);
  }
  if (!parts.length) return { s: 0.5, gp: 0 };
  const w = parts.reduce((a, [, b]) => a + b, 0);
  return { s: parts.reduce((a, [v, b]) => a + v * b, 0) / w, gp };
}

// ---------- Construction des paris ----------
function bet(type, side, line, label, p, book) {
  const fair = p > 0 ? 1 / p : null;
  const ev = book ? p * book - 1 : null;
  return { type, side, line, label, p, fair, book: book || null, ev };
}

const num = x => String(x).replace('.', ',');
const fmtLine = l => (l > 0 ? '+' : '') + num(l);

function blendTwoWay(pModel, odds) {
  const mk = odds.home && odds.away ? devig([odds.home, odds.away]) : null;
  return clamp(mk ? MARKET_WEIGHT * mk[0] + (1 - MARKET_WEIGHT) * pModel : pModel, 0.02, 0.98);
}

function soccerMarkets(m, pModel2, data) {
  const H = m.home.short, A = m.away.short;
  const odds = m.odds || {};
  // 1N2 du modèle : nul plus probable quand les équipes sont proches
  const pDraw = 0.27 * (1 - Math.abs(pModel2 - 0.5) * 1.3);
  let p1x2 = [pModel2 * (1 - pDraw), pDraw, (1 - pModel2) * (1 - pDraw)];
  const mk = odds.home && odds.draw && odds.away ? devig([odds.home, odds.draw, odds.away]) : null;
  if (mk) p1x2 = p1x2.map((p, i) => MARKET_WEIGHT * mk[i] + (1 - MARKET_WEIGHT) * p);
  const [pH, pD, pA] = p1x2;

  // Nombre de buts attendu : déduit de la ligne over/under du bookmaker, sinon ~2,65
  const ou = odds.total && odds.over && odds.under ? devig([odds.over, odds.under]) : null;
  let total = 2.65;
  if (ou) {
    let lo = 0.8, hi = 5.5;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (gridStats(scoreGrid(mid / 2, mid / 2)).over(odds.total) < ou[0]) lo = mid; else hi = mid;
    }
    total = (lo + hi) / 2;
  }
  // Écart de buts (supériorité) calé pour retrouver P(dom) - P(ext)
  let lo = -3, hi = 3;
  for (let i = 0; i < 40; i++) {
    const s = (lo + hi) / 2;
    const g = gridStats(scoreGrid(Math.max(0.05, (total + s) / 2), Math.max(0.05, (total - s) / 2)));
    if (g.home - g.away < pH - pA) lo = s; else hi = s;
  }
  const sup = (lo + hi) / 2;
  const lh = Math.max(0.05, (total + sup) / 2), la = Math.max(0.05, (total - sup) / 2);
  const g = gridStats(scoreGrid(lh, la));
  data.xg = [lh, la];
  data.likelyScore = `${g.best.h}-${g.best.a}`;

  const bets = [
    bet('ml', 'H', null, `Victoire ${H}`, pH, odds.home),
    bet('ml', 'D', null, 'Match nul', pD, odds.draw),
    bet('ml', 'A', null, `Victoire ${A}`, pA, odds.away),
    bet('dc', '1X', null, `${H} ou nul (1X)`, pH + pD),
    bet('dc', 'X2', null, `${A} ou nul (X2)`, pA + pD),
    bet('dc', '12', null, 'Pas de match nul (12)', pH + pA),
    bet('dnb', 'H', null, `${H} remboursé si nul`, pH / (pH + pA)),
    bet('dnb', 'A', null, `${A} remboursé si nul`, pA / (pH + pA)),
    bet('btts', 'Y', null, 'Les deux équipes marquent', g.btts),
    bet('btts', 'N', null, 'Au moins une équipe ne marque pas', 1 - g.btts),
  ];
  for (const line of [1.5, 2.5, 3.5]) {
    const book = odds.total === line && ou ? [odds.over, odds.under] : [null, null];
    bets.push(bet('ou', 'O', line, `Plus de ${num(line)} buts`, g.over(line), book[0]));
    bets.push(bet('ou', 'U', line, `Moins de ${num(line)} buts`, 1 - g.over(line), book[1]));
  }
  return bets;
}

function pointsMarkets(m, pModel2, cfg, data) {
  const H = m.home.short, A = m.away.short;
  const odds = m.odds || {};
  const pH = blendTwoWay(pModel2, odds);
  const sd = m.src.sd ?? cfg.sd;
  const mu = sd * normInv(pH); // écart de points attendu en faveur du domicile
  // Total attendu : moyennes des équipes ou du championnat, recalé sur la ligne du bookmaker
  let total = m.src.total ?? cfg.total;
  if (m.home.avgPts && m.away.avgPts) total = m.home.avgPts + m.away.avgPts;
  if (odds.total) total = 0.6 * odds.total + 0.4 * total;
  const tsd = m.src.tsd ?? cfg.tsd;
  data.margin = mu;
  data.total = total;

  const bets = [
    bet('ml', 'H', null, `Victoire ${H}`, pH, odds.home),
    bet('ml', 'A', null, `Victoire ${A}`, 1 - pH, odds.away),
  ];
  // Handicap : ligne du bookmaker, sinon écart attendu arrondi au demi-point
  const line = odds.spread ?? (Math.round(-mu) + (mu >= 0 ? 0.5 : -0.5));
  const pCover = clamp(normCdf((mu + line) / sd), 0.01, 0.99);
  const hasSpread = odds.spread != null;
  bets.push(bet('hcp', 'H', line, `${H} ${fmtLine(line)} (handicap)`, pCover, hasSpread ? odds.spreadHome : null));
  bets.push(bet('hcp', 'A', -line, `${A} ${fmtLine(-line)} (handicap)`, 1 - pCover, hasSpread ? odds.spreadAway : null));
  const tLine = odds.total ?? Math.round(total) + 0.5;
  const pOver = clamp(1 - normCdf((tLine - total) / tsd), 0.02, 0.98);
  const unit = m.sport === 'hockey' ? 'buts' : m.sport === 'baseball' ? 'points (runs)' : 'points';
  bets.push(bet('ou', 'O', tLine, `Plus de ${num(tLine)} ${unit}`, pOver, odds.total ? odds.over : null));
  bets.push(bet('ou', 'U', tLine, `Moins de ${num(tLine)} ${unit}`, 1 - pOver, odds.total ? odds.under : null));
  return bets;
}

function tennisMarkets(m, data) {
  const H = m.home.short, A = m.away.short;
  const odds = m.odds || {};
  const pH = clamp(blendTwoWay(sigmoid(0.95 * Math.log(m.home.rankPts / m.away.rankPts)), odds), 0.03, 0.97);
  // Probabilité de gagner un set q, telle que P(match) = q²(3-2q) au meilleur des 3 sets
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const q = (lo + hi) / 2;
    if (q * q * (3 - 2 * q) < pH) lo = q; else hi = q;
  }
  const q = (lo + hi) / 2;
  const p3 = 2 * q * (1 - q);
  data.setProb = q;
  return [
    bet('win', 'H', null, `Victoire ${H}`, pH, odds.home),
    bet('win', 'A', null, `Victoire ${A}`, 1 - pH, odds.away),
    bet('sets', 'Y', null, 'Match en 3 sets', p3),
    bet('sets', 'N', null, 'Match en 2 sets', 1 - p3),
    bet('set1', 'H', null, `${H} gagne au moins un set`, 1 - (1 - q) * (1 - q)),
    bet('set1', 'A', null, `${A} gagne au moins un set`, 1 - q * q),
  ];
}

// Choix du « meilleur pari » : forte probabilité, mais une cote qui vaut le coup (≥ 1,25)
function pickBest(bets) {
  const score = b => {
    let s = b.p;
    if (b.fair < 1.25) s -= (1.25 - b.fair) * 1.5;
    if (b.fair > 2.6) s -= 0.15;
    if (b.ev != null) s += clamp(b.ev, -0.1, 0.15);
    if (b.type === 'dnb') s -= 0.04; // moins répandu chez les bookmakers
    return s;
  };
  return [...bets].filter(b => b.p >= 0.5).sort((a, b) => score(b) - score(a))[0]
    || [...bets].sort((a, b) => b.p - a.p)[0];
}

// Fiabilité 1 à 3 : quantité de données disponibles
function reliability(m, gp) {
  let r = 0;
  if (m.odds && (m.odds.home || m.odds.total)) r += 2;
  if (gp >= 5) r += 1;
  if (m.home.form || m.home.rank) r += 0.5;
  return r >= 3 ? 3 : r >= 1.5 ? 2 : 1;
}

function analyze(m) {
  const cfg = SPORT_CFG[m.sport] || SPORT_CFG.basketball;
  const data = {};
  let bets;
  let gp = 0;
  if (m.sport === 'tennis') {
    bets = tennisMarkets(m, data);
    gp = m.home.rank && m.away.rank ? 5 : 0;
  } else {
    const h = teamStrength(m.home, m.sport, 'home');
    const a = teamStrength(m.away, m.sport, 'away');
    gp = Math.min(h.gp, a.gp);
    const adv = m.neutral ? 0 : (m.src.home ?? cfg.home);
    const pModel2 = sigmoid(logit(clamp(h.s, 0.05, 0.95)) - logit(clamp(a.s, 0.05, 0.95)) + adv);
    if (m.sport === 'soccer') bets = soccerMarkets(m, pModel2, data);
    else if (m.sport === 'mma') {
      const pH = blendTwoWay(pModel2, m.odds || {});
      bets = [
        bet('win', 'H', null, `Victoire ${m.home.short}`, pH, m.odds?.home),
        bet('win', 'A', null, `Victoire ${m.away.short}`, 1 - pH, m.odds?.away),
      ];
    } else bets = pointsMarkets(m, pModel2, cfg, data);
  }
  const best = pickBest(bets);
  return { bets, best, reliability: reliability(m, gp), text: explain(m, best, data) };
}

// ---------- Analyse rédigée ----------
const pct = p => `${Math.round(p * 100)} %`;
const formFr = f => [...(f || '')].map(c => ({ W: 'V', L: 'D', D: 'N', T: 'N' }[c.toUpperCase()] || c)).join('');

function explain(m, best, data) {
  const out = [];
  const H = m.home.name, A = m.away.name;
  if (m.sport === 'tennis') {
    const rk = t => (t.rank ? `n°${t.rank} mondial (${t.rankPts} pts)` : 'hors top 150');
    out.push(`${H} est ${rk(m.home)}, ${A} est ${rk(m.away)}.`);
    out.push(`Probabilité estimée que ${m.home.short} remporte un set donné : ${pct(data.setProb)}.`);
  } else {
    const desc = (t, where) => {
      const bits = [];
      if (t.record && !/^[WDLTN]+$/i.test(t.record)) bits.push(`bilan ${t.record}`);
      const split = where === 'home' ? t.homeRecord : t.awayRecord;
      if (split) bits.push(`${split} ${where === 'home' ? 'à domicile' : "à l'extérieur"}`);
      if (t.form) bits.push(`forme récente ${formFr(t.form)}`);
      if (t.avgPts) bits.push(`${t.avgPts.toFixed(1)} pts marqués par match`);
      return bits.length ? `${t.name} : ${bits.join(', ')}.` : null;
    };
    [desc(m.home, 'home'), desc(m.away, 'away')].filter(Boolean).forEach(s => out.push(s));
    if (m.neutral) out.push('Terrain neutre : pas d’avantage du terrain.');
    if (data.xg) out.push(`Buts attendus : ${data.xg[0].toFixed(2)} pour ${m.home.short}, ${data.xg[1].toFixed(2)} pour ${m.away.short}. Score le plus probable : ${data.likelyScore}.`);
    if (data.margin != null) out.push(`Écart attendu : ${Math.abs(data.margin).toFixed(1)} en faveur de ${data.margin >= 0 ? m.home.short : m.away.short}, total attendu ≈ ${data.total.toFixed(1)}.`);
  }
  if (m.odds && m.odds.home) out.push(`Les cotes ${m.odds.provider || 'du marché'} comptent pour ${Math.round(MARKET_WEIGHT * 100)} % de l’estimation.`);
  else out.push('Aucune cote disponible : estimation purement statistique, à prendre avec plus de prudence.');
  if (best) out.push(`Notre choix : « ${best.label} » (${pct(best.p)}). À jouer seulement si votre bookmaker propose une cote supérieure à ${best.fair.toFixed(2).replace('.', ',')}.`);
  return out;
}

// ---------- Vérification des pronostics après le match ----------
// Renvoie true (gagné), false (perdu) ou null (remboursé / indéterminable)
function settle(b, res) {
  const { h, a, winner, sets } = res;
  switch (b.type) {
    case 'ml': return b.side === 'H' ? h > a : b.side === 'A' ? a > h : h === a;
    case 'win': return winner ? winner === b.side : null;
    case 'dc': return b.side === '1X' ? h >= a : b.side === 'X2' ? a >= h : h !== a;
    case 'dnb': return h === a ? null : b.side === 'H' ? h > a : a > h;
    case 'btts': return (h > 0 && a > 0) === (b.side === 'Y');
    case 'ou': return h + a === b.line ? null : (h + a > b.line) === (b.side === 'O');
    case 'hcp': {
      const d = b.side === 'H' ? h + b.line - a : a + b.line - h;
      return d === 0 ? null : d > 0;
    }
    case 'sets': return sets ? (sets === 3) === (b.side === 'Y') : null;
    case 'set1': return res.setsWon ? res.setsWon[b.side] > 0 : null;
    default: return null;
  }
}

window.Engine = { analyze, settle, americanToDecimal, SPORT_CFG };
})();
