(() => {
'use strict';
// Moteur de pronostics : transforme les données d'un match en probabilités par type de pari.
// Principe : une note de force par équipe (bilan + forme + domicile/extérieur),
// mélangée avec les probabilités implicites des cotes quand elles existent (le marché est
// le meilleur estimateur disponible), corrigée par les compositions d'équipe au football,
// puis déclinée uniquement en paris proposés par Betclic et Winamax.

// homePts : avantage du terrain en points pour le modèle attaque/défense
const SPORT_CFG = {
  soccer:     { label: 'Football',        home: 0.32, k: 6 },
  basketball: { label: 'Basket',          home: 0.25, k: 8,  sd: 12,   total: 226, tsd: 18, homePts: 2.5 },
  football:   { label: 'Football US',     home: 0.18, k: 6,  sd: 13.5, total: 45,  tsd: 13, homePts: 1.5 },
  hockey:     { label: 'Hockey',          home: 0.15, k: 10, sd: 2.4,  total: 6,   tsd: 2.3, homePts: 0.2 },
  baseball:   { label: 'Baseball',        home: 0.12, k: 20, sd: 4.2,  total: 8.5, tsd: 4.3, homePts: 0.2 },
  rugby:      { label: 'Rugby',           home: 0.45, k: 6,  sd: 14,   total: 47,  tsd: 15, homePts: 4 },
  afl:        { label: 'Foot australien', home: 0.30, k: 6,  sd: 30,   total: 165, tsd: 28, homePts: 6 },
  tennis:     { label: 'Tennis',          home: 0 },
  mma:        { label: 'MMA',             home: 0 },
};

const BOOKS = { betclic: 'Betclic', winamax: 'Winamax' };

// Taux de retour joueur habituels (part de la mise reversée) par type de pari, grands championnats.
// Sert à estimer la cote Betclic / Winamax quand la vraie cote n'est pas disponible.
const PAYOUT = {
  betclic: { ml: 0.915, win: 0.915, dc: 0.895, dnb: 0.905, ou: 0.915, btts: 0.905, hcp: 0.91, sets: 0.89 },
  winamax: { ml: 0.93, win: 0.93, dc: 0.905, dnb: 0.915, ou: 0.925, btts: 0.915, hcp: 0.92, sets: 0.90 },
};
const MINOR_LEAGUE_MALUS = 0.03;

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

// Statistiques d'une grille de scores exacts (domicile x extérieur), lois de Poisson indépendantes.
function goals(lh, la) {
  const ph = poissonPmf(lh), pa = poissonPmf(la);
  let home = 0, draw = 0, away = 0, btts = 0;
  const totals = {};
  let best = { p: 0, h: 0, a: 0 };
  ph.forEach((x, h) => pa.forEach((y, a) => {
    const p = x * y;
    if (h > a) home += p; else if (h === a) draw += p; else away += p;
    if (h > 0 && a > 0) btts += p;
    totals[h + a] = (totals[h + a] || 0) + p;
    if (p > best.p) best = { p, h, a };
  }));
  const over = line => Object.entries(totals).reduce((s, [t, p]) => s + (Number(t) > line ? p : 0), 0);
  return { lh, la, home, draw, away, btts, over, best };
}

// Trouve les buts attendus (domicile, extérieur) qui reproduisent un total et un écart P(dom) - P(ext).
function fitGoals(total, diff) {
  let lo = -3, hi = 3;
  for (let i = 0; i < 40; i++) {
    const s = (lo + hi) / 2;
    const g = goals(Math.max(0.05, (total + s) / 2), Math.max(0.05, (total - s) / 2));
    if (g.home - g.away < diff) lo = s; else hi = s;
  }
  const s = (lo + hi) / 2;
  return goals(Math.max(0.05, (total + s) / 2), Math.max(0.05, (total - s) / 2));
}

// Nombre total de buts attendu pour qu'une ligne over/under ait la probabilité pOver.
function totalFromLine(line, pOver) {
  let lo = 0.8, hi = 5.5;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (goals(mid / 2, mid / 2).over(line) < pOver) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
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

// Moyenne des probabilités sans marge de plusieurs sources (Betclic, Winamax...).
function avgProbs(list) {
  const ok = list.filter(Boolean);
  if (!ok.length) return null;
  return ok[0].map((_, i) => ok.reduce((s, p) => s + p[i], 0) / ok.length);
}

// Probabilités du marché : cotes Betclic/Winamax réelles d'abord, sinon cotes ESPN (DraftKings).
function marketMoneyline(m, withDraw) {
  const fromBooks = avgProbs(Object.values(m.books || {}).map(b => {
    const ml = b.ml || {};
    return withDraw ? (ml.D ? devig([ml.H, ml.D, ml.A]) : null) : devig([ml.H, ml.A]);
  }));
  if (fromBooks) return { p: fromBooks, src: 'books' };
  const o = m.odds || {};
  const dk = withDraw ? (o.draw ? devig([o.home, o.draw, o.away]) : null) : devig([o.home, o.away]);
  return dk ? { p: dk, src: 'espn' } : null;
}

// Ligne principale over/under : celle des bookmakers français si connue, sinon celle d'ESPN.
function marketTotal(m) {
  for (const b of Object.values(m.books || {})) {
    const lines = Object.entries(b.ou || {}).filter(([, v]) => v.O && v.U);
    if (!lines.length) continue;
    // ligne la plus équilibrée = ligne principale
    const [line, v] = lines.sort((x, y) => Math.abs(x[1].O - x[1].U) - Math.abs(y[1].O - y[1].U))[0];
    return { line: Number(line), pOver: devig([v.O, v.U])[0] };
  }
  const o = m.odds || {};
  if (o.total && o.over && o.under) return { line: o.total, pOver: devig([o.over, o.under])[0] };
  return null;
}

function marketSpread(m) {
  for (const b of Object.values(m.books || {})) {
    const lines = Object.entries(b.hcp || {}).filter(([, v]) => v.H && v.A);
    if (!lines.length) continue;
    const [line, v] = lines.sort((x, y) => Math.abs(x[1].H - x[1].A) - Math.abs(y[1].H - y[1].A))[0];
    return { line: Number(line), pHome: devig([v.H, v.A])[0] };
  }
  const o = m.odds || {};
  if (o.spread != null && o.spreadHome && o.spreadAway) return { line: o.spread, pHome: devig([o.spreadHome, o.spreadAway])[0] };
  return null;
}

// Vraie cote d'un pari chez un bookmaker, si l'API l'a fournie.
function realOdd(b, book) {
  if (!book) return null;
  switch (b.type) {
    case 'ml': case 'win': return book.ml?.[b.side] || null;
    case 'ou': return book.ou?.[b.line]?.[b.side] || null;
    case 'hcp': return b.side === 'H' ? book.hcp?.[b.line]?.H || null : book.hcp?.[-b.line]?.A || null;
    default: return null;
  }
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
// p : notre estimation ; pm : probabilité du marché (sert à estimer la cote des bookmakers)
function bet(type, side, line, label, p, pm) {
  return { type, side, line, label, p: clamp(p, 0.005, 0.995), pm: pm == null ? null : clamp(pm, 0.005, 0.995) };
}

// Ajoute à chaque pari : cote juste, cotes Betclic/Winamax (réelles ou estimées), value.
function priceBets(bets, m, extraMargin = 0) {
  const malus = (m.src?.minor ? MINOR_LEAGUE_MALUS : 0) + extraMargin;
  for (const b of bets) {
    b.fair = 1 / b.p;
    b.odds = {};
    for (const key of Object.keys(BOOKS)) {
      const real = realOdd(b, m.books?.[key]);
      if (real) b.odds[key] = { v: real, real: true };
      else {
        const payout = PAYOUT[key][b.type] - malus;
        b.odds[key] = { v: Math.max(1.01, payout / (b.pm ?? b.p)), real: false };
      }
    }
    const best = Object.entries(b.odds).sort((x, y) => y[1].v - x[1].v)[0];
    b.bestBook = best[0];
    b.bestOdd = best[1];
    // La value n'a de sens qu'avec une vraie cote
    b.ev = best[1].real ? b.p * best[1].v - 1 : null;
  }
  return bets;
}

const num = x => String(x).replace('.', ',');
const fmtLine = l => (l > 0 ? '+' : '') + num(l);

function blend(model, market) {
  return market ? model.map((p, i) => MARKET_WEIGHT * market[i] + (1 - MARKET_WEIGHT) * p) : model;
}

// Effet des compositions : buts attendus corrigés selon les absents de chaque équipe.
// Une compo probable est moins sûre qu'une compo officielle : son effet est réduit.
function lineupFactors(m) {
  const l = m.lineup;
  if (!l?.home || !l?.away) return null;
  const w = l.status === 'official' ? 1 : 0.6;
  return {
    h: (1 - w * l.home.att) * (1 + w * l.away.def),
    a: (1 - w * l.away.att) * (1 + w * l.home.def),
  };
}

// ---------- Données avancées ----------
// Football : force d'attaque et de défense (buts marqués / encaissés par match, comparés à la
// moyenne du championnat), mêlée aux 5 derniers matchs. Méthode classique des modèles de Poisson.
// Le poids w grandit avec le nombre de matchs joués : rien sous 5 matchs, plein poids à 10.
function soccerStats(m) {
  const s = m.adv;
  const gpMin = Math.min(s?.home?.gp || 0, s?.away?.gp || 0);
  if (!s?.avg || gpMin < 5) return null;
  const w = Math.min(1, gpMin / 10);
  const avg = w * s.avg + (1 - w) * 1.35; // moyenne du championnat ramenée vers ~1,35 but/équipe
  const k = 4; // lissage vers la moyenne en début de saison
  const ratio = (goalsN, gp) => ((goalsN / gp / avg) * gp + k) / (gp + k);
  const side = (t, l5) => {
    let att = ratio(t.gf, t.gp), def = ratio(t.ga, t.gp);
    if (l5?.n >= 3) {
      att = 0.75 * att + 0.25 * ratio(l5.gf, l5.n);
      def = 0.75 * def + 0.25 * ratio(l5.ga, l5.n);
    }
    return { att, def };
  };
  const h = side(s.home, m.deep?.last5?.home), a = side(s.away, m.deep?.last5?.away);
  const hf = m.neutral ? 1 : 1.12; // les équipes marquent ~12 % de plus à domicile
  return { h, a, w, avg, lh: avg * hf * h.att * a.def, la: (avg / hf) * a.att * h.def };
}

// Confrontations directes : part des points pris par l'équipe à domicile (victoire 1, nul 0,5).
function h2hShift(m) {
  const h = m.deep?.h2h;
  if (!h || h.n < 3) return 0;
  return clamp((h.homeShare - 0.5) * 0.08, -0.04, 0.04);
}

// Blessés (basket, NFL, hockey…) : chaque absent fait baisser les chances de son équipe.
function injuryShift(m) {
  const inj = m.deep?.injuries;
  if (!inj) return 0;
  const weight = list => (list || []).reduce((s, p) => s + (/out|reserve/i.test(p.status) ? 1 : /doubt/i.test(p.status) ? 0.5 : 0), 0);
  return clamp(-0.06 * weight(inj.home), -0.3, 0) - clamp(-0.06 * weight(inj.away), -0.3, 0);
}

function soccerMarkets(m, pModel2, data) {
  const H = m.home.short, A = m.away.short;
  // 1N2 du modèle : nul plus probable quand les équipes sont proches
  const pDraw = 0.27 * (1 - Math.abs(pModel2 - 0.5) * 1.3);
  let model = [pModel2 * (1 - pDraw), pDraw, (1 - pModel2) * (1 - pDraw)];
  // Modèle attaque/défense (Poisson) : jusqu'à 60 % du modèle statistique, selon le nombre de matchs joués
  const st = soccerStats(m);
  if (st) {
    const gs = goals(st.lh, st.la);
    const w = 0.6 * st.w;
    model = model.map((p, i) => (1 - w) * p + w * [gs.home, gs.draw, gs.away][i]);
    data.stats = st;
  }
  const hs = h2hShift(m);
  model = [model[0] + hs, model[1], model[2] - hs].map(x => Math.max(0.02, x));
  const mk = marketMoneyline(m, true);
  let [pH, pD, pA] = blend(model, mk?.p);

  const mt = marketTotal(m);
  const modelTotal = st ? st.w * (st.lh + st.la) + (1 - st.w) * 2.65 : 2.65;
  const total = mt ? 0.7 * totalFromLine(mt.line, mt.pOver) + 0.3 * modelTotal : modelTotal;
  let g = fitGoals(total, pH - pA);
  // Grille « marché seul » pour estimer les cotes des bookmakers sur les autres lignes
  const gm = mk ? fitGoals(total, mk.p[0] - mk.p[2]) : null;

  const f = lineupFactors(m);
  if (f) {
    const adj = goals(g.lh * f.h, g.la * f.a);
    // On décale le 1N2 de l'effet des absents, puis on renormalise
    const shifted = [pH + adj.home - g.home, pD + adj.draw - g.draw, pA + adj.away - g.away].map(x => Math.max(0.01, x));
    const s = shifted.reduce((a, b) => a + b, 0);
    [pH, pD, pA] = shifted.map(x => x / s);
    g = adj;
  }
  data.xg = [g.lh, g.la];
  data.likelyScore = `${g.best.h}-${g.best.a}`;
  data.marketSrc = mk?.src;

  const [mH, mD, mA] = mk ? mk.p : [null, null, null];
  const bets = [
    bet('ml', 'H', null, `Victoire ${H}`, pH, mH),
    bet('ml', 'D', null, 'Match nul', pD, mD),
    bet('ml', 'A', null, `Victoire ${A}`, pA, mA),
    bet('dc', '1X', null, `${H} ou nul (1N)`, pH + pD, mk && mH + mD),
    bet('dc', 'X2', null, `${A} ou nul (N2)`, pA + pD, mk && mA + mD),
    bet('dc', '12', null, `${H} ou ${A} (12)`, pH + pA, mk && mH + mA),
    bet('dnb', 'H', null, `${H} (remboursé si nul)`, pH / (pH + pA), mk && mH / (mH + mA)),
    bet('dnb', 'A', null, `${A} (remboursé si nul)`, pA / (pH + pA), mk && mA / (mH + mA)),
    bet('btts', 'Y', null, 'Les deux équipes marquent : oui', g.btts, gm?.btts),
    bet('btts', 'N', null, 'Les deux équipes marquent : non', 1 - g.btts, gm && 1 - gm.btts),
  ];
  for (const line of [1.5, 2.5, 3.5]) {
    const pmOver = mt && mt.line === line ? mt.pOver : gm ? gm.over(line) : null;
    bets.push(bet('ou', 'O', line, `Plus de ${num(line)} buts`, g.over(line), pmOver));
    bets.push(bet('ou', 'U', line, `Moins de ${num(line)} buts`, 1 - g.over(line), pmOver == null ? null : 1 - pmOver));
  }
  return bets;
}

function pointsMarkets(m, pModel2, cfg, data) {
  const H = m.home.short, A = m.away.short;
  const mk = marketMoneyline(m, false);
  const sd = m.src.sd ?? cfg.sd;
  // Total attendu : moyennes des équipes ou du championnat, recalé sur la ligne du marché
  let total = m.src.total ?? cfg.total;
  if (m.home.avgPts && m.away.avgPts) total = m.home.avgPts + m.away.avgPts;
  // Attaque/défense : points marqués par l'un et encaissés par l'autre (classement)
  const s = m.adv;
  const gpMin = Math.min(s?.home?.gp || 0, s?.away?.gp || 0);
  if (gpMin >= 5) {
    const w = Math.min(1, gpMin / 10); // plein poids à partir de 10 matchs
    const hp = m.neutral ? 0 : (cfg.homePts || 0) / 2;
    const expH = (s.home.gf / s.home.gp + s.away.ga / s.away.gp) / 2 + hp;
    const expA = (s.away.gf / s.away.gp + s.home.ga / s.home.gp) / 2 - hp;
    pModel2 = (1 - 0.5 * w) * pModel2 + 0.5 * w * normCdf((expH - expA) / sd);
    total = w * (expH + expA) + (1 - w) * total;
    data.stats = { expH, expA };
  }
  const inj = injuryShift(m);
  const pH = clamp(sigmoid(logit(clamp(blend([pModel2], mk && [mk.p[0]])[0], 0.02, 0.98)) + inj), 0.02, 0.98);
  data.injury = inj;
  const mu = sd * normInv(pH); // écart de points attendu en faveur du domicile
  const mt = marketTotal(m);
  if (mt) total = 0.6 * (mt.line + cfg.tsd * normInv(mt.pOver)) + 0.4 * total;
  const tsd = m.src.tsd ?? cfg.tsd;
  data.margin = mu;
  data.total = total;
  data.sd = sd;
  data.tsd = tsd;
  data.marketSrc = mk?.src;

  const bets = [
    bet('ml', 'H', null, `Victoire ${H}`, pH, mk?.p[0]),
    bet('ml', 'A', null, `Victoire ${A}`, 1 - pH, mk?.p[1]),
  ];
  // Handicap : ligne du marché, sinon écart attendu arrondi au demi-point
  const ms = marketSpread(m);
  const line = ms ? ms.line : Math.round(-mu) + (mu >= 0 ? 0.5 : -0.5);
  const pCover = clamp(normCdf((mu + line) / sd), 0.01, 0.99);
  bets.push(bet('hcp', 'H', line, `${H} ${fmtLine(line)} (handicap)`, pCover, ms?.pHome));
  bets.push(bet('hcp', 'A', -line, `${A} ${fmtLine(-line)} (handicap)`, 1 - pCover, ms && 1 - ms.pHome));
  const tLine = mt ? mt.line : Math.round(total) + 0.5;
  const pOver = clamp(1 - normCdf((tLine - total) / tsd), 0.02, 0.98);
  const unit = m.sport === 'hockey' ? 'buts' : m.sport === 'baseball' ? 'points (runs)' : 'points';
  bets.push(bet('ou', 'O', tLine, `Plus de ${num(tLine)} ${unit}`, pOver, mt?.pOver));
  bets.push(bet('ou', 'U', tLine, `Moins de ${num(tLine)} ${unit}`, 1 - pOver, mt && 1 - mt.pOver));
  return bets;
}

function tennisMarkets(m, data) {
  const H = m.home.short, A = m.away.short;
  const mk = marketMoneyline(m, false);
  const model = sigmoid(0.95 * Math.log(m.home.rankPts / m.away.rankPts));
  const pH = clamp(blend([model], mk && [mk.p[0]])[0], 0.03, 0.97);
  // Probabilité de gagner un set q, telle que P(match) = q²(3-2q) au meilleur des 3 sets
  const setProb = p => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) {
      const q = (lo + hi) / 2;
      if (q * q * (3 - 2 * q) < p) lo = q; else hi = q;
    }
    return (lo + hi) / 2;
  };
  const q = setProb(pH);
  const qm = mk ? setProb(mk.p[0]) : null;
  data.setProb = q;
  data.marketSrc = mk?.src;
  const p3 = 2 * q * (1 - q);
  const pm3 = qm == null ? null : 2 * qm * (1 - qm);
  return [
    bet('win', 'H', null, `Victoire ${H}`, pH, mk?.p[0]),
    bet('win', 'A', null, `Victoire ${A}`, 1 - pH, mk?.p[1]),
    bet('sets', 'Y', null, 'Nombre de sets : 3', p3, pm3),
    bet('sets', 'N', null, 'Nombre de sets : 2', 1 - p3, pm3 == null ? null : 1 - pm3),
  ];
}

// Choix du « meilleur pari » : une cote Betclic/Winamax d'au moins 1,30, une bonne probabilité,
// et surtout la meilleure espérance de gain à la cote réellement proposée (réelle ou estimée).
const MIN_BOOK_ODD = 1.3;
function pickBest(bets) {
  const score = b => {
    const ev = b.p * b.bestOdd.v - 1;
    return 0.6 * b.p + 1.5 * clamp(ev, -0.2, 0.2) - (b.bestOdd.v > 2.8 ? 0.1 : 0);
  };
  return [...bets].filter(b => b.p >= 0.45 && b.bestOdd.v >= MIN_BOOK_ODD).sort((a, b) => score(b) - score(a))[0]
    || [...bets].sort((a, b) => b.p - a.p)[0];
}

// Fiabilité 1 à 3 : quantité de données disponibles
function reliability(m, gp, marketSrc) {
  let r = 0;
  if (marketSrc) r += 2;
  if (gp >= 5) r += 1;
  if (m.home.form || m.home.rank) r += 0.5;
  if (m.lineup?.status === 'official') r += 0.5;
  if (m.adv?.home?.gp >= 3) r += 0.5;
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
      const mk = marketMoneyline(m, false);
      const pH = clamp(blend([pModel2], mk && [mk.p[0]])[0], 0.02, 0.98);
      data.marketSrc = mk?.src;
      bets = [
        bet('win', 'H', null, `Victoire ${m.home.short}`, pH, mk?.p[0]),
        bet('win', 'A', null, `Victoire ${m.away.short}`, 1 - pH, mk?.p[1]),
      ];
    } else bets = pointsMarkets(m, pModel2, cfg, data);
  }
  priceBets(bets, m);
  const best = pickBest(bets);
  return { bets, best, reliability: reliability(m, gp, data.marketSrc), text: explain(m, best, data), model: data };
}

// ---------- Estimation en direct (gratuite, d'après le score) ----------
// On part du modèle d'avant-match (buts / points attendus, chance de gagner un set) et on ne garde
// que ce qui reste à jouer, en ajoutant le score actuel. Les cotes sont estimées avec la marge
// habituelle du bookmaker, un peu plus forte en direct : aucune vraie cote, aucun crédit utilisé.
const LIVE_MARGIN = 0.02;
const PERIODS = { basketball: 4, football: 4, hockey: 3, afl: 4, baseball: 9 };

// Part du match déjà jouée (0 à 1)
function playedShare(m) {
  const per = Number(m.period) || 1;
  const d = String(m.detail || '');
  if (m.sport === 'soccer' || m.sport === 'rugby') {
    const full = m.sport === 'soccer' ? 90 : 80;
    if (/^(HT|MT)$|half/i.test(d)) return 0.5;
    const min = m.clock != null ? Number(m.clock) / 60 : parseInt(d, 10);
    return Number.isFinite(min) ? clamp(min / full, 0, 0.985) : 0.5;
  }
  if (m.sport === 'baseball') {
    const half = /bot|mid|middle/i.test(d) ? 0.5 : /end/i.test(d) ? 1 : 0;
    return clamp((per - 1 + half) / 9, 0, 0.97);
  }
  const n = PERIODS[m.sport] || 4;
  if (per > n) return 0.985; // prolongation
  const len = m.sport === 'basketball' ? (/nba/.test(m.src?.path || '') ? 12 : 10) : m.sport === 'football' ? 15 : 20;
  const left = m.clock != null ? Number(m.clock) / 60 : len / 2;
  return clamp((per - 1 + 1 - clamp(left / len, 0, 1)) / n, 0, 0.985);
}

// Probabilité de gagner un set depuis le score en jeux (i-j), avec g = chance de gagner un jeu.
function setFrom(i, j, g) {
  if ((i >= 6 && i - j >= 2) || i === 7) return 1;
  if ((j >= 6 && j - i >= 2) || j === 7) return 0;
  if (i === 6 && j === 6) return g;
  return g * setFrom(i + 1, j, g) + (1 - g) * setFrom(i, j + 1, g);
}

function liveTennis(m, model) {
  const q = model.setProb ?? 0.5;
  let lo = 0.01, hi = 0.99;
  for (let k = 0; k < 30; k++) { const g = (lo + hi) / 2; if (setFrom(0, 0, g) < q) lo = g; else hi = g; }
  const g = (lo + hi) / 2;
  const hs = m.home.games || [], as = m.away.games || [];
  let sh = 0, sa = 0, gh = 0, ga = 0;
  hs.forEach((x, i) => {
    if (x.w) sh++; else if (as[i]?.w) sa++; else { gh = x.v || 0; ga = as[i]?.v || 0; }
  });
  const bo = sh >= 2 || sa >= 2 ? 5 : 3;
  const need = Math.ceil(bo / 2);
  const s = setFrom(gh, ga, g); // set en cours
  // W : victoire du joueur 1 ; T : match en 3 sets (au meilleur des 3)
  const W = (a, b) => (a >= need ? 1 : b >= need ? 0 : q * W(a + 1, b) + (1 - q) * W(a, b + 1));
  const T = (a, b) => (a >= 2 || b >= 2 ? (a + b === 3 ? 1 : 0) : q * T(a + 1, b) + (1 - q) * T(a, b + 1));
  const pH = s * W(sh + 1, sa) + (1 - s) * W(sh, sa + 1);
  const bets = [
    bet('win', 'H', null, `Victoire ${m.home.short}`, pH),
    bet('win', 'A', null, `Victoire ${m.away.short}`, 1 - pH),
  ];
  if (bo === 3) {
    const p3 = s * T(sh + 1, sa) + (1 - s) * T(sh, sa + 1);
    bets.push(bet('sets', 'Y', null, 'Nombre de sets : 3', p3), bet('sets', 'N', null, 'Nombre de sets : 2', 1 - p3));
  }
  const score = hs.map((x, i) => `${x.v ?? 0}-${as[i]?.v ?? 0}`).join(' ') || '0-0';
  return { bets, share: null, desc: `score ${score} (sets ${sh}-${sa})`, note: `chance estimée de ${m.home.short} sur un set : ${pct(q)}` };
}

function liveSoccer(m, model, f) {
  const H = m.home.short, A = m.away.short;
  const h0 = Number(m.home.score) || 0, a0 = Number(m.away.score) || 0;
  const [xh, xa] = model.xg || [1.35, 1.15];
  const r = 1 - f;
  const ph = poissonPmf(xh * r), pa = poissonPmf(xa * r);
  let pH = 0, pD = 0, pA = 0, btts = 0;
  const tot = {};
  ph.forEach((x, i) => pa.forEach((y, j) => {
    const p = x * y, h = h0 + i, a = a0 + j;
    if (h > a) pH += p; else if (h === a) pD += p; else pA += p;
    if (h > 0 && a > 0) btts += p;
    tot[h + a] = (tot[h + a] || 0) + p;
  }));
  const over = line => Object.entries(tot).reduce((s, [t, p]) => s + (Number(t) > line ? p : 0), 0);
  const bets = [
    bet('ml', 'H', null, `Victoire ${H}`, pH), bet('ml', 'D', null, 'Match nul', pD), bet('ml', 'A', null, `Victoire ${A}`, pA),
    bet('dc', '1X', null, `${H} ou nul (1N)`, pH + pD), bet('dc', 'X2', null, `${A} ou nul (N2)`, pA + pD), bet('dc', '12', null, `${H} ou ${A} (12)`, pH + pA),
    bet('dnb', 'H', null, `${H} (remboursé si nul)`, pH / (pH + pA)), bet('dnb', 'A', null, `${A} (remboursé si nul)`, pA / (pH + pA)),
    bet('btts', 'Y', null, 'Les deux équipes marquent : oui', btts), bet('btts', 'N', null, 'Les deux équipes marquent : non', 1 - btts),
  ];
  const cur = h0 + a0;
  for (const line of [cur + 0.5, cur + 1.5, cur + 2.5]) {
    bets.push(bet('ou', 'O', line, `Plus de ${num(line)} buts`, over(line)), bet('ou', 'U', line, `Moins de ${num(line)} buts`, 1 - over(line)));
  }
  return { bets, desc: `${h0}-${a0} à la ${Math.round(f * 90)}e minute`, note: `buts encore attendus : ${(xh * r).toFixed(2).replace('.', ',')} pour ${H}, ${(xa * r).toFixed(2).replace('.', ',')} pour ${A}` };
}

function livePoints(m, model, f, cfg) {
  const H = m.home.short, A = m.away.short;
  const h0 = Number(m.home.score) || 0, a0 = Number(m.away.score) || 0;
  const r = Math.max(0.015, 1 - f);
  const sd = (model.sd ?? cfg.sd ?? 12) * Math.sqrt(r), tsd = (model.tsd ?? cfg.tsd ?? 15) * Math.sqrt(r);
  const mean = h0 - a0 + (model.margin ?? 0) * r;
  const total = h0 + a0 + (model.total ?? cfg.total ?? 0) * r;
  const pH = clamp(normCdf(mean / sd), 0.005, 0.995);
  const unit = m.sport === 'hockey' ? 'buts' : m.sport === 'baseball' ? 'points (runs)' : 'points';
  const bets = [bet('ml', 'H', null, `Victoire ${H}`, pH), bet('ml', 'A', null, `Victoire ${A}`, 1 - pH)];
  const line = Math.round(-mean) + (mean >= 0 ? 0.5 : -0.5);
  const pc = clamp(normCdf((mean + line) / sd), 0.01, 0.99);
  bets.push(bet('hcp', 'H', line, `${H} ${fmtLine(line)} (handicap)`, pc), bet('hcp', 'A', -line, `${A} ${fmtLine(-line)} (handicap)`, 1 - pc));
  const step = Math.max(1, Math.round(tsd / 2));
  const base = Math.round(total) + 0.5;
  for (const k of [-2, -1, 0, 1, 2]) {
    const tl = base + k * step;
    if (tl <= h0 + a0) continue;
    const po = clamp(1 - normCdf((tl - total) / tsd), 0.005, 0.995);
    bets.push(bet('ou', 'O', tl, `Plus de ${num(tl)} ${unit}`, po), bet('ou', 'U', tl, `Moins de ${num(tl)} ${unit}`, 1 - po));
  }
  return { bets, desc: `${h0}-${a0}, ${Math.round(f * 100)} % du match joué`, note: `écart final attendu : ${Math.abs(mean).toFixed(1).replace('.', ',')} pour ${mean >= 0 ? H : A}, total ≈ ${total.toFixed(0)}` };
}

// Analyse d'un match en cours. null si le sport ne s'y prête pas (MMA) ou si le score manque.
function live(m) {
  if (m.state !== 'in' || m.sport === 'mma') return null;
  const cfg = SPORT_CFG[m.sport] || SPORT_CFG.basketball;
  const model = analyze({ ...m, state: 'pre' }).model;
  const f = m.sport === 'tennis' ? null : playedShare(m);
  const res = m.sport === 'tennis' ? liveTennis(m, model) : m.sport === 'soccer' ? liveSoccer(m, model, f) : livePoints(m, model, f, cfg);
  // Paris quasi joués (cote sous 1,02) : les bookmakers les ferment
  const bets = priceBets(res.bets.filter(b => b.p < 0.97 && b.p > 0.02), { ...m, books: null }, LIVE_MARGIN)
    .filter(b => b.bestOdd.v >= 1.03);
  if (!bets.length) return null;
  const best = pickBest(bets);
  const text = [
    `En direct : ${res.desc}. Probabilités recalculées d’après le score et le temps restant, à partir de notre modèle d’avant-match (${res.note}).`,
    'Cotes live estimées (marge du bookmaker un peu plus forte en direct) : elles bougent à chaque action, vérifiez-les dans l’appli avant de jouer. Aucun crédit utilisé.',
  ];
  return { bets, best, reliability: 1, text, live: true, share: f };
}

// ---------- Analyse rédigée ----------
const pct = p => `${Math.round(p * 100)} %`;
const odd = x => x.toFixed(2).replace('.', ',');
const formFr = f => [...(f || '')].map(c => ({ W: 'V', L: 'D', D: 'N', T: 'N' }[c.toUpperCase()] || c)).join('');

function lineupText(m) {
  const l = m.lineup;
  if (!l?.home) return [];
  const out = [];
  const kind = l.status === 'official' ? 'Compo officielle' : 'Compo probable';
  for (const [side, t] of [['home', m.home], ['away', m.away]]) {
    const x = l[side];
    if (!x.absent.length) out.push(`${kind} ${t.short} : aucun titulaire habituel absent.`);
    else {
      const names = x.absent.slice(0, 4).map(p => p.g || p.a ? `${p.name} (${p.g} but${p.g > 1 ? 's' : ''}, ${p.a} passe${p.a > 1 ? 's' : ''})` : p.name);
      out.push(`${kind} ${t.short} : ${x.absent.length} titulaire${x.absent.length > 1 ? 's' : ''} habituel${x.absent.length > 1 ? 's' : ''} absent${x.absent.length > 1 ? 's' : ''} (${names.join(', ')}${x.absent.length > 4 ? '…' : ''}).`);
    }
  }
  const f = lineupFactors(m);
  const eff = side => Math.round((f[side] - 1) * 100);
  if (f && (eff('h') || eff('a'))) out.push(`Effet des compos sur les buts attendus : ${m.home.short} ${eff('h') > 0 ? '+' : ''}${eff('h')} %, ${m.away.short} ${eff('a') > 0 ? '+' : ''}${eff('a')} %.`);
  return out;
}

function advancedText(m, data) {
  const out = [];
  const s = m.adv;
  const per = (x, gp) => (x / gp).toFixed(m.sport === 'soccer' || m.sport === 'hockey' ? 2 : 1).replace('.', ',');
  if (s?.home?.gp && s?.away?.gp) {
    const unit = m.sport === 'soccer' || m.sport === 'hockey' ? 'buts' : 'pts';
    for (const [t, x] of [[m.home, s.home], [m.away, s.away]]) {
      out.push(`${t.short} : ${per(x.gf, x.gp)} ${unit} marqués et ${per(x.ga, x.gp)} encaissés par match (${x.gp} matchs${x.rank ? `, ${x.rank}e du classement` : ''}).`);
    }
    if (data.stats?.h) {
      const f = v => `${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)} %`;
      out.push(`Par rapport à la moyenne du championnat (${s.avg.toFixed(2).replace('.', ',')} but par équipe et par match${data.stats.w < 1 ? `, stats comptées à ${Math.round(data.stats.w * 100)} % : saison encore courte` : ''}) : ${m.home.short} marque ${f(data.stats.h.att)} et encaisse ${f(data.stats.h.def)} ; ${m.away.short} marque ${f(data.stats.a.att)} et encaisse ${f(data.stats.a.def)}.`);
    }
  }
  const l5 = m.deep?.last5;
  for (const [t, x] of [[m.home, l5?.home], [m.away, l5?.away]]) {
    if (x?.n) out.push(`${x.n} derniers matchs ${t.short} : ${formFr(x.form)}, ${x.gf} buts marqués, ${x.ga} encaissés.`);
  }
  const h = m.deep?.h2h;
  if (h?.n) out.push(`Confrontations directes (${h.n === 1 ? 'la dernière' : `les ${h.n} dernières`}) : ${m.home.short} a pris ${Math.round(h.homeShare * 100)} % des points${h.n >= 3 ? ' (pris en compte)' : ' (trop peu pour compter)'}.`);
  const inj = m.deep?.injuries;
  if (inj && m.sport !== 'soccer') {
    for (const [t, list] of [[m.home, inj.home], [m.away, inj.away]]) {
      if (list?.length) out.push(`Blessés ${t.short} : ${list.slice(0, 5).map(p => `${p.name} (${p.status})`).join(', ')}${list.length > 5 ? '…' : ''}.`);
    }
  }
  return out;
}

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
    out.push(...advancedText(m, data));
    out.push(...lineupText(m));
    if (data.xg) out.push(`Buts attendus : ${data.xg[0].toFixed(2)} pour ${m.home.short}, ${data.xg[1].toFixed(2)} pour ${m.away.short}. Score le plus probable : ${data.likelyScore}.`);
    if (data.margin != null) out.push(`Écart attendu : ${Math.abs(data.margin).toFixed(1)} en faveur de ${data.margin >= 0 ? m.home.short : m.away.short}, total attendu ≈ ${data.total.toFixed(1)}.`);
  }
  if (data.marketSrc === 'books') out.push(`Les vraies cotes Betclic/Winamax comptent pour ${Math.round(MARKET_WEIGHT * 100)} % de l’estimation.`);
  else if (data.marketSrc === 'espn') out.push(`Les cotes du marché international comptent pour ${Math.round(MARKET_WEIGHT * 100)} % de l’estimation. Les cotes Betclic/Winamax affichées sont estimées à partir de leurs marges habituelles.`);
  else out.push('Aucune cote disponible : estimation purement statistique, à prendre avec plus de prudence.');
  if (best) {
    const o = best.bestOdd;
    out.push(`Notre choix : « ${best.label} » (${pct(best.p)}). ${o.real
      ? `Meilleure cote : ${odd(o.v)} chez ${BOOKS[best.bestBook]}${best.ev > 0 ? ', supérieure à notre cote juste : pari « value »' : ''}.`
      : `Cote attendue ≈ ${odd(o.v)} chez ${BOOKS[best.bestBook]}.`} À jouer seulement si la cote proposée dépasse ${odd(best.fair)}.`);
  }
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
    default: return null;
  }
}

window.Engine = { analyze, live, settle, americanToDecimal, SPORT_CFG, BOOKS };
})();
