'use strict';
// Récupération des matchs du jour (API publique ESPN) + affichage des pronostics.

const API = 'https://site.api.espn.com/apis/site/v2/sports/';

// Toutes les compétitions interrogées à chaque actualisation.
const SOURCES = [
  { path: 'soccer/all', sport: 'soccer', league: 'Football' },
  { path: 'basketball/nba', sport: 'basketball', league: 'NBA' },
  { path: 'basketball/wnba', sport: 'basketball', league: 'WNBA', total: 164, sd: 11 },
  { path: 'basketball/mens-college-basketball', sport: 'basketball', league: 'NCAA Basket (H)', total: 145, sd: 11, home: 0.35 },
  { path: 'basketball/womens-college-basketball', sport: 'basketball', league: 'NCAA Basket (F)', total: 135, sd: 12, home: 0.35 },
  { path: 'tennis/atp', sport: 'tennis', league: 'ATP', tour: 'atp' },
  { path: 'tennis/wta', sport: 'tennis', league: 'WTA', tour: 'wta' },
  { path: 'hockey/nhl', sport: 'hockey', league: 'NHL' },
  { path: 'hockey/mens-college-hockey', sport: 'hockey', league: 'NCAA Hockey', home: 0.25 },
  { path: 'football/nfl', sport: 'football', league: 'NFL' },
  { path: 'football/college-football', sport: 'football', league: 'NCAA Football', total: 54, sd: 16, home: 0.3 },
  { path: 'baseball/mlb', sport: 'baseball', league: 'MLB' },
  { path: 'mma/ufc', sport: 'mma', league: 'UFC' },
  { path: 'rugby/270559', sport: 'rugby', league: 'Top 14' },
  { path: 'rugby/267979', sport: 'rugby', league: 'Premiership' },
  { path: 'rugby/270557', sport: 'rugby', league: 'United Rugby Championship' },
  { path: 'rugby/271937', sport: 'rugby', league: 'Champions Cup' },
  { path: 'rugby/180659', sport: 'rugby', league: 'Six Nations' },
  { path: 'rugby/242041', sport: 'rugby', league: 'Super Rugby' },
  { path: 'rugby/244293', sport: 'rugby', league: 'Rugby Championship' },
  { path: 'rugby/164205', sport: 'rugby', league: 'Coupe du monde de rugby' },
  { path: 'australian-football/afl', sport: 'afl', league: 'AFL' },
];

const SPORT_ORDER = ['soccer', 'tennis', 'basketball', 'rugby', 'hockey', 'football', 'baseball', 'mma', 'afl'];

// ---------- Stockage local ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage plein ou bloqué */ } },
};

// ---------- Dates ----------
const pad = n => String(n).padStart(2, '0');
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// ESPN range les matchs par journée de New York : on interroge les journées qui couvrent la nôtre.
const etDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(d).replace(/-/g, '');
function espnDatesFor(day) {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0);
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59);
  return [...new Set([etDay(start), etDay(end)])];
}
const sameLocalDay = (iso, day) => dayKey(new Date(iso)) === dayKey(day);

// ---------- Lecture des données ESPN ----------
const dec = v => (String(v).toUpperCase() === 'EVEN' ? 2 : Engine.americanToDecimal(v));

function parseOdds(o) {
  if (!o) return null;
  const odds = {
    provider: o.provider?.displayName || o.provider?.name,
    home: dec(o.moneyline?.home?.close?.odds ?? o.homeTeamOdds?.moneyLine),
    away: dec(o.moneyline?.away?.close?.odds ?? o.awayTeamOdds?.moneyLine),
    draw: dec(o.moneyline?.draw?.close?.odds ?? o.drawOdds?.moneyLine),
    total: Number.isFinite(o.overUnder) ? o.overUnder : null,
    over: dec(o.total?.over?.close?.odds),
    under: dec(o.total?.under?.close?.odds),
  };
  const sl = parseFloat(o.pointSpread?.home?.close?.line);
  if (Number.isFinite(sl)) {
    odds.spread = sl;
    odds.spreadHome = dec(o.pointSpread.home.close.odds);
    odds.spreadAway = dec(o.pointSpread?.away?.close?.odds);
  }
  return odds.home || odds.total ? odds : null;
}

function parseTeam(c, ranks) {
  const rec = type => c.records?.find(r => r.type === type)?.summary;
  const stat = name => {
    const s = c.statistics?.find(x => x.name === name);
    return s ? parseFloat(s.displayValue) : null;
  };
  if (c.athlete) {
    const r = ranks?.get(String(c.athlete.id || c.id));
    return {
      name: c.athlete.displayName, short: c.athlete.shortName || c.athlete.displayName,
      logo: c.athlete.flag?.href, country: c.athlete.flag?.alt,
      rank: r?.rank, rankPts: r?.points ?? ranks?.floor ?? 400,
      winner: c.winner, sets: c.linescores?.filter(l => l.winner).length,
    };
  }
  const t = c.team || {};
  return {
    name: t.displayName, short: t.shortDisplayName || t.displayName, logo: t.logo,
    record: rec('total'), homeRecord: rec('home'), awayRecord: rec('road') || rec('away'),
    form: c.form, avgPts: stat('avgPoints'), score: c.score, winner: c.winner,
  };
}

function toMatch(src, ev, comp, ranks, extra = {}) {
  const cs = comp.competitors || [];
  const home = cs.find(c => c.homeAway === 'home') || cs[0];
  const away = cs.find(c => c.homeAway === 'away') || cs[1];
  if (!home || !away) return null;
  const st = (comp.status || ev.status || {}).type || {};
  return {
    id: `${src.path}:${comp.id || ev.id}`,
    sport: src.sport,
    src: { path: src.path, home: src.home, total: src.total, sd: src.sd, tsd: src.tsd },
    league: extra.league || comp.altGameNote || src.league,
    round: extra.round,
    date: comp.date || ev.date,
    state: st.state || 'pre',
    canceled: /POSTPONED|CANCELED|CANCELLED|SUSPENDED/.test(st.name || ''),
    detail: st.shortDetail || st.detail || '',
    neutral: !!comp.neutralSite,
    home: parseTeam(home, ranks),
    away: parseTeam(away, ranks),
    odds: parseOdds(comp.odds?.[0]),
  };
}

async function getJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function getRanks(tour) {
  try {
    const j = await getJson(`${API}tennis/${tour}/rankings`);
    const map = new Map();
    let min = Infinity;
    for (const r of j.rankings?.[0]?.ranks || []) {
      map.set(String(r.athlete?.id), { rank: r.current, points: r.points });
      min = Math.min(min, r.points);
    }
    // Joueurs hors classement fourni : un peu sous le dernier classé
    map.floor = Number.isFinite(min) ? Math.round(min * 0.6) : 400;
    return map;
  } catch { return null; }
}

async function fetchSource(src, dates, day, ranks) {
  const out = [];
  for (const d of dates) {
    const j = await getJson(`${API}${src.path}/scoreboard?dates=${d}&limit=1000`);
    for (const ev of j.events || []) {
      if (src.sport === 'tennis') {
        for (const g of ev.groupings || []) {
          if (!/singles|simple/i.test(g.grouping?.displayName || '')) continue;
          for (const c of g.competitions || []) {
            if (!sameLocalDay(c.date, day)) continue;
            const m = toMatch(src, ev, c, ranks, { league: `${src.league} · ${ev.name}`, round: c.round?.displayName });
            if (m) out.push(m);
          }
        }
      } else {
        for (const c of ev.competitions || []) {
          if (!sameLocalDay(c.date || ev.date, day)) continue;
          const m = toMatch(src, ev, c, ranks);
          if (m) out.push(m);
        }
      }
    }
  }
  return out;
}

// Interroge toutes les sources (6 en parallèle) ; une source en échec n'arrête pas les autres.
async function fetchDay(day, onProgress) {
  const dates = espnDatesFor(day);
  const ranks = { atp: await getRanks('atp'), wta: await getRanks('wta') };
  const queue = [...SOURCES];
  const matches = [];
  const failed = [];
  let done = 0;
  async function worker() {
    while (queue.length) {
      const src = queue.shift();
      try { matches.push(...await fetchSource(src, dates, day, ranks[src.tour])); }
      catch { failed.push(src.league); }
      onProgress(++done, SOURCES.length);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  const seen = new Set();
  return {
    matches: matches.filter(m => !seen.has(m.id) && seen.add(m.id)).sort((a, b) => a.date.localeCompare(b.date)),
    failed,
  };
}

// ---------- Historique des pronostics ----------
// Le pronostic est mémorisé avant le match pour pouvoir le vérifier honnêtement ensuite.
function rememberPicks(matches) {
  const preds = store.get('pdj-preds', {});
  const hist = store.get('pdj-history', {});
  for (const m of matches) {
    if (m.canceled) continue;
    if (m.state === 'pre') {
      const { best } = m.analysis;
      preds[m.id] = { type: best.type, side: best.side, line: best.line, label: best.label, p: best.p, day: dayKey(new Date(m.date)) };
    } else if (m.state === 'post' && preds[m.id] && !(m.id in hist)) {
      const won = Engine.settle(preds[m.id], resultOf(m));
      hist[m.id] = { won, p: preds[m.id].p, day: preds[m.id].day };
    }
  }
  // On ne garde que 60 jours
  const limit = dayKey(new Date(Date.now() - 60 * 864e5));
  for (const o of [preds, hist]) for (const k in o) if (o[k].day < limit) delete o[k];
  store.set('pdj-preds', preds);
  store.set('pdj-history', hist);
}

function resultOf(m) {
  const sets = m.sport === 'tennis' ? (m.home.sets || 0) + (m.away.sets || 0) : null;
  return {
    h: Number(m.home.score), a: Number(m.away.score),
    winner: m.home.winner ? 'H' : m.away.winner ? 'A' : null,
    sets, setsWon: m.sport === 'tennis' ? { H: m.home.sets || 0, A: m.away.sets || 0 } : null,
  };
}

// ---------- Interface ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = p => `${Math.round(p * 100)} %`;
const odd = x => (x ? x.toFixed(2).replace('.', ',') : '–');
const timeOf = iso => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

const ui = {
  dayOffset: store.get('pdj-ui', {}).dayOffset || 0,
  sport: 'all',
  status: store.get('pdj-ui', {}).status || 'upcoming',
  query: '',
  open: new Set(),
  data: null,
};

function selectedDay() {
  const d = new Date();
  d.setDate(d.getDate() + ui.dayOffset);
  return d;
}

function cacheKey(day) { return `pdj-day-${dayKey(day)}`; }

function loadCached() {
  const c = store.get(cacheKey(selectedDay()), null);
  ui.data = c ? { ...c, matches: c.matches.map(m => ({ ...m, analysis: Engine.analyze(m) })) } : null;
}

async function refresh() {
  const btn = $('#refresh');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('busy');
  const label = $('#refresh-label');
  const day = selectedDay();
  try {
    const { matches, failed } = await fetchDay(day, (d, n) => { label.textContent = `Recherche… ${d}/${n}`; });
    const payload = { day: dayKey(day), fetchedAt: Date.now(), matches, failed };
    // Garde les 3 dernières journées en cache
    try {
      Object.keys(localStorage).filter(k => k.startsWith('pdj-day-')).sort().slice(0, -2).forEach(k => localStorage.removeItem(k));
    } catch { /* ignore */ }
    store.set(cacheKey(day), payload);
    ui.data = { ...payload, matches: matches.map(m => ({ ...m, analysis: Engine.analyze(m) })) };
    rememberPicks(ui.data.matches);
    toast(matches.length ? `${matches.length} matchs trouvés` : 'Aucun match trouvé pour cette journée');
  } catch (e) {
    toast('Impossible de joindre les sources. Vérifiez votre connexion internet puis réessayez.');
  } finally {
    btn.disabled = false;
    btn.classList.remove('busy');
    label.textContent = 'Actualiser';
    render();
  }
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 3500);
}

function filtered() {
  if (!ui.data) return [];
  const q = ui.query.trim().toLowerCase();
  return ui.data.matches.filter(m => {
    if (ui.sport !== 'all' && m.sport !== ui.sport) return false;
    if (ui.status === 'upcoming' && m.state !== 'pre') return false;
    if (ui.status === 'live' && m.state !== 'in') return false;
    if (ui.status === 'done' && m.state !== 'post') return false;
    if (q && !`${m.home.name} ${m.away.name} ${m.league}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

// Les meilleurs paris : matchs à venir, classés par probabilité x fiabilité
function topPicks(matches) {
  return matches
    .filter(m => m.state === 'pre' && !m.canceled && m.analysis.best.fair >= 1.2)
    .map(m => ({ m, score: m.analysis.best.p * (0.75 + 0.1 * m.analysis.reliability) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(x => x.m);
}

function renderHeader() {
  const day = selectedDay();
  $('#date').textContent = day.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  document.querySelectorAll('[data-day]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.day) === ui.dayOffset)));
  const meta = $('#meta');
  if (ui.data) {
    const at = new Date(ui.data.fetchedAt);
    const stale = dayKey(at) !== dayKey(new Date());
    meta.innerHTML = `${ui.data.matches.length} matchs · mis à jour ${stale ? 'le ' + at.toLocaleDateString('fr-FR') + ' à ' : 'à '}${timeOf(at)}`
      + (ui.data.failed?.length ? ` · <span class="warn">${ui.data.failed.length} source(s) indisponible(s)</span>` : '');
    $('#stale').hidden = !stale;
  } else {
    meta.textContent = 'Pas encore de données pour cette journée';
    $('#stale').hidden = true;
  }
}

function renderRecord() {
  const hist = Object.values(store.get('pdj-history', {})).filter(h => h.won !== null);
  const el = $('#record');
  if (!hist.length) { el.hidden = true; return; }
  const won = hist.filter(h => h.won).length;
  const expected = hist.reduce((s, h) => s + h.p, 0);
  el.hidden = false;
  el.innerHTML = `<span class="rec-label">Bilan de nos pronos (60 j)</span>
    <span class="rec-num">${won}/${hist.length}</span>
    <span class="rec-sub">soit ${pct(won / hist.length)} réussis · attendu ${pct(expected / hist.length)}</span>`;
}

function renderChips() {
  const all = ui.data?.matches || [];
  const counts = {};
  all.forEach(m => { counts[m.sport] = (counts[m.sport] || 0) + 1; });
  const chips = [['all', 'Tous', all.length], ...SPORT_ORDER.filter(s => counts[s]).map(s => [s, Engine.SPORT_CFG[s].label, counts[s]])];
  if (ui.sport !== 'all' && !counts[ui.sport]) ui.sport = 'all';
  $('#sports').innerHTML = chips.map(([k, l, n]) =>
    `<button class="chip" data-sport="${k}" aria-pressed="${ui.sport === k}">${esc(l)} <span>${n}</span></button>`).join('');
  document.querySelectorAll('[data-status]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.status === ui.status)));
}

function teamLine(t, m, isHome) {
  let side = '';
  if (m.sport === 'tennis') side = t.rank ? `<span class="tag">n°${t.rank}</span>` : '<span class="tag dim">NC</span>';
  else if (t.form) side = `<span class="form" aria-label="Forme récente">${[...t.form].slice(-5).map(c => `<i class="f-${c.toUpperCase()}"></i>`).join('')}</span>`;
  const score = m.state === 'pre' ? '' : m.sport === 'tennis' ? (t.sets ?? '') : (t.score ?? '');
  return `<div class="team${t.winner ? ' won' : ''}">
    ${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy" width="22" height="22">` : '<span class="nologo"></span>'}
    <span class="tname">${esc(t.name)}</span>${side}
    ${score !== '' ? `<b class="score">${esc(score)}</b>` : ''}
  </div>`;
}

function verdict(m) {
  if (m.state !== 'post' || m.canceled) return '';
  const h = store.get('pdj-history', {})[m.id];
  const pred = store.get('pdj-preds', {})[m.id];
  if (!pred) return '<span class="verdict dim">Pas de prono enregistré avant le match</span>';
  if (!h || h.won === null) return `<span class="verdict dim">${esc(pred.label)} · remboursé</span>`;
  return `<span class="verdict ${h.won ? 'ok' : 'ko'}">${h.won ? 'Gagné' : 'Perdu'} · ${esc(pred.label)}</span>`;
}

function bars(n) {
  return `<span class="rel" title="Fiabilité des données" aria-label="Fiabilité ${n} sur 3">${[1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
}

function matchCard(m) {
  const { best, bets, reliability, text } = m.analysis;
  const open = ui.open.has(m.id);
  const when = m.canceled ? 'Reporté' : m.state === 'pre' ? timeOf(m.date) : m.state === 'in' ? 'En cours' : 'Terminé';
  const pick = m.state === 'pre' && !m.canceled
    ? `<div class="pick"><span class="pick-label">${esc(best.label)}</span><span class="pick-p">${pct(best.p)}</span><span class="pick-odd">cote mini ${odd(best.fair)}</span></div>`
    : verdict(m) || `<div class="pick muted"><span class="pick-label">${esc(best.label)}</span><span class="pick-p">${pct(best.p)}</span></div>`;
  const rows = [...bets].sort((a, b) => b.p - a.p).map(b => `<tr${b === best ? ' class="is-best"' : ''}>
      <td>${esc(b.label)}</td><td class="n">${pct(b.p)}</td><td class="n">${odd(b.fair)}</td>
      <td class="n">${b.book ? odd(b.book) : '–'}</td>
      <td class="n">${b.ev == null ? '' : `<span class="ev ${b.ev > 0 ? 'pos' : 'neg'}">${b.ev > 0 ? '+' : ''}${Math.round(b.ev * 100)} %</span>`}</td></tr>`).join('');
  return `<article class="match${open ? ' open' : ''}" data-id="${esc(m.id)}">
    <button class="match-head" aria-expanded="${open}">
      <span class="when ${m.state}">${when}${m.round ? `<small>${esc(m.round)}</small>` : ''}</span>
      <span class="teams">${teamLine(m.home, m, true)}${teamLine(m.away, m, false)}</span>
      ${bars(reliability)}
    </button>
    ${pick}
    ${open ? `<div class="details">
      <ul class="analysis">${text.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      <div class="table-wrap"><table>
        <thead><tr><th>Pari</th><th class="n">Proba</th><th class="n">Cote juste</th><th class="n" title="${esc(m.odds?.provider || 'Bookmaker')}">Cote bookm.</th><th class="n">Value</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="hint">« Cote juste » = cote à partir de laquelle le pari devient rentable sur le long terme selon notre estimation. Ne jouez que si votre bookmaker propose plus.</p>
    </div>` : ''}
  </article>`;
}

function renderTop(all) {
  const picks = topPicks(all);
  const el = $('#top');
  if (!picks.length) { el.hidden = true; return; }
  el.hidden = false;
  const combo = picks.filter(m => m.analysis.best.p >= 0.6).slice(0, 3);
  const comboP = combo.reduce((s, m) => s * m.analysis.best.p, 1);
  $('#top-list').innerHTML = picks.map((m, i) => `<li>
      <button class="ticket" data-goto="${esc(m.id)}">
        <span class="t-rank">${i + 1}</span>
        <span class="t-body">
          <span class="t-match">${esc(m.home.short)} – ${esc(m.away.short)}</span>
          <span class="t-meta">${timeOf(m.date)} · ${esc(Engine.SPORT_CFG[m.sport].label)} · ${esc(m.league)}</span>
          <span class="t-bet">${esc(m.analysis.best.label)}</span>
        </span>
        <span class="t-num"><b>${pct(m.analysis.best.p)}</b><small>cote mini ${odd(m.analysis.best.fair)}</small></span>
      </button></li>`).join('');
  const c = $('#combo');
  if (combo.length >= 2) {
    c.hidden = false;
    c.innerHTML = `<div class="combo-head"><span>Combiné du jour</span><span class="combo-num">${pct(comboP)} · cote mini ${odd(1 / comboP)}</span></div>
      <ul>${combo.map(m => `<li><span>${esc(m.home.short)} – ${esc(m.away.short)}</span><b>${esc(m.analysis.best.label)}</b></li>`).join('')}</ul>
      <p class="hint">Un combiné multiplie les cotes mais aussi les risques : tous les paris doivent passer.</p>`;
  } else c.hidden = true;
}

function render() {
  renderHeader();
  renderRecord();
  renderChips();
  const list = $('#list');
  const empty = $('#empty');
  if (!ui.data) {
    $('#top').hidden = true;
    list.innerHTML = '';
    empty.hidden = false;
    empty.innerHTML = `<p class="empty-title">Aucun match chargé pour ${ui.dayOffset ? 'demain' : "aujourd'hui"}</p>
      <p>Appuyez sur <b>Actualiser</b> pour rechercher tous les matchs de la journée (football, tennis, basket, rugby, hockey…) et calculer les pronostics.</p>`;
    return;
  }
  renderTop(ui.data.matches);
  const ms = filtered();
  empty.hidden = ms.length > 0;
  if (!ms.length) {
    empty.innerHTML = `<p class="empty-title">Aucun match pour ces filtres</p><p>Essayez « Tout » ou un autre sport.</p>`;
  }
  const groups = new Map();
  for (const m of ms) {
    const k = `${Engine.SPORT_CFG[m.sport].label} · ${m.league}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  list.innerHTML = [...groups].map(([k, arr]) => `<section class="league">
      <h3>${esc(k)} <span>${arr.length}</span></h3>${arr.map(matchCard).join('')}</section>`).join('');
}

function saveUi() { store.set('pdj-ui', { dayOffset: ui.dayOffset, status: ui.status }); }

function bind() {
  $('#refresh').addEventListener('click', refresh);
  $('#stale-refresh').addEventListener('click', refresh);
  document.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => {
    ui.dayOffset = Number(b.dataset.day);
    ui.open.clear();
    saveUi();
    loadCached();
    render();
  }));
  document.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', () => {
    ui.status = b.dataset.status;
    saveUi();
    render();
  }));
  $('#sports').addEventListener('click', e => {
    const b = e.target.closest('[data-sport]');
    if (!b) return;
    ui.sport = b.dataset.sport;
    render();
  });
  $('#search').addEventListener('input', e => { ui.query = e.target.value; render(); });
  $('#list').addEventListener('click', e => {
    const head = e.target.closest('.match-head');
    if (!head) return;
    const id = head.closest('.match').dataset.id;
    if (ui.open.has(id)) ui.open.delete(id); else ui.open.add(id);
    render();
  });
  $('#top-list').addEventListener('click', e => {
    const b = e.target.closest('[data-goto]');
    if (!b) return;
    ui.sport = 'all';
    ui.status = 'all';
    ui.query = '';
    $('#search').value = '';
    ui.open.add(b.dataset.goto);
    render();
    document.querySelector(`.match[data-id="${CSS.escape(b.dataset.goto)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

bind();
loadCached();
render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
