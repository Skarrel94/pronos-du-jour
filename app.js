'use strict';
// Récupération des matchs du jour (API publique ESPN), des cotes Betclic/Winamax (The Odds API,
// clé optionnelle), des compositions d'équipe, et affichage des pronostics.

const API = 'https://site.api.espn.com/apis/site/v2/sports/';
const ODDS_API = 'https://api.the-odds-api.com/v4/';
const ODDS_BOOKS = { betclic_fr: 'betclic', winamax_fr: 'winamax' };

// Compétitions proposées par Betclic et Winamax. `odds` = clé The Odds API, `minor` = marge plus forte.
const soccer = (slug, league, odds, minor) => ({ path: `soccer/${slug}`, sport: 'soccer', league, odds, minor });
const SOURCES = [
  soccer('fra.1', 'Ligue 1', 'soccer_france_ligue_one'),
  soccer('fra.2', 'Ligue 2', 'soccer_france_ligue_two', true),
  soccer('fra.coupe_de_france', 'Coupe de France', 'soccer_france_coupe_de_france', true),
  soccer('eng.1', 'Premier League', 'soccer_epl'),
  soccer('eng.2', 'Championship', 'soccer_efl_champ', true),
  soccer('eng.fa', 'FA Cup', 'soccer_fa_cup', true),
  soccer('eng.league_cup', 'Carabao Cup', 'soccer_england_efl_cup', true),
  soccer('esp.1', 'Liga', 'soccer_spain_la_liga'),
  soccer('esp.2', 'Liga 2', 'soccer_spain_segunda_division', true),
  soccer('esp.copa_del_rey', 'Coupe du Roi', 'soccer_spain_copa_del_rey', true),
  soccer('ita.1', 'Serie A', 'soccer_italy_serie_a'),
  soccer('ita.2', 'Serie B', 'soccer_italy_serie_b', true),
  soccer('ita.coppa_italia', 'Coupe d’Italie', 'soccer_italy_coppa_italia', true),
  soccer('ger.1', 'Bundesliga', 'soccer_germany_bundesliga'),
  soccer('ger.2', '2. Bundesliga', 'soccer_germany_bundesliga2', true),
  soccer('ger.dfb_pokal', 'Coupe d’Allemagne', 'soccer_germany_dfb_pokal', true),
  soccer('uefa.champions', 'Ligue des champions', 'soccer_uefa_champs_league'),
  soccer('uefa.europa', 'Ligue Europa', 'soccer_uefa_europa_league'),
  soccer('uefa.europa.conf', 'Ligue Conférence', 'soccer_uefa_europa_conference_league'),
  soccer('por.1', 'Liga Portugal', 'soccer_portugal_primeira_liga'),
  soccer('ned.1', 'Eredivisie', 'soccer_netherlands_eredivisie'),
  soccer('ned.2', 'Eerste Divisie', null, true),
  soccer('bel.1', 'Pro League (Belgique)', 'soccer_belgium_first_div', true),
  soccer('tur.1', 'Süper Lig', 'soccer_turkey_super_league', true),
  soccer('gre.1', 'Super League (Grèce)', 'soccer_greece_super_league', true),
  soccer('sco.1', 'Premiership (Écosse)', 'soccer_spl', true),
  soccer('sui.1', 'Super League (Suisse)', 'soccer_switzerland_superleague', true),
  soccer('aut.1', 'Bundesliga (Autriche)', 'soccer_austria_bundesliga', true),
  soccer('den.1', 'Superliga (Danemark)', 'soccer_denmark_superliga', true),
  soccer('swe.1', 'Allsvenskan', 'soccer_sweden_allsvenskan', true),
  soccer('nor.1', 'Eliteserien', 'soccer_norway_eliteserien', true),
  soccer('bra.1', 'Brasileirão', 'soccer_brazil_campeonato', true),
  soccer('bra.2', 'Brasileirão Série B', 'soccer_brazil_serie_b', true),
  soccer('arg.1', 'Liga Profesional (Argentine)', 'soccer_argentina_primera_division', true),
  soccer('chi.1', 'Primera División (Chili)', 'soccer_chile_campeonato', true),
  soccer('col.1', 'Primera A (Colombie)', null, true),
  soccer('usa.1', 'MLS', 'soccer_usa_mls', true),
  soccer('mex.1', 'Liga MX', 'soccer_mexico_ligamx', true),
  soccer('ksa.1', 'Saudi Pro League', 'soccer_saudi_arabia_pro_league', true),
  soccer('jpn.1', 'J1 League', 'soccer_japan_j_league', true),
  soccer('conmebol.libertadores', 'Copa Libertadores', 'soccer_conmebol_copa_libertadores', true),
  soccer('conmebol.sudamericana', 'Copa Sudamericana', 'soccer_conmebol_copa_sudamericana', true),
  soccer('fifa.world', 'Coupe du monde', 'soccer_fifa_world_cup'),
  soccer('fifa.worldq.uefa', 'Qualifs Coupe du monde (Europe)', 'soccer_fifa_world_cup_qualifiers_europe'),
  soccer('fifa.worldq.caf', 'Qualifs Coupe du monde (Afrique)', null, true),
  soccer('uefa.nations', 'Ligue des nations', 'soccer_uefa_nations_league'),
  soccer('caf.nations', 'Coupe d’Afrique des nations', 'soccer_africa_cup_of_nations'),
  soccer('fifa.cwc', 'Coupe du monde des clubs', 'soccer_fifa_club_world_cup'),
  soccer('eng.w.1', 'WSL (féminin)', null, true),
  soccer('fra.w.1', 'Première Ligue (féminin)', null, true),
  soccer('esp.w.1', 'Liga F (féminin)', null, true),
  { path: 'basketball/nba', sport: 'basketball', league: 'NBA', odds: 'basketball_nba' },
  { path: 'basketball/wnba', sport: 'basketball', league: 'WNBA', odds: 'basketball_wnba', total: 164, sd: 11, minor: true },
  { path: 'tennis/atp', sport: 'tennis', league: 'ATP', tour: 'atp' },
  { path: 'tennis/wta', sport: 'tennis', league: 'WTA', tour: 'wta' },
  { path: 'hockey/nhl', sport: 'hockey', league: 'NHL', odds: 'icehockey_nhl' },
  { path: 'football/nfl', sport: 'football', league: 'NFL', odds: 'americanfootball_nfl' },
  { path: 'football/college-football', sport: 'football', league: 'NCAA Football', odds: 'americanfootball_ncaaf', total: 54, sd: 16, home: 0.3, minor: true },
  { path: 'baseball/mlb', sport: 'baseball', league: 'MLB', odds: 'baseball_mlb' },
  { path: 'mma/ufc', sport: 'mma', league: 'UFC', odds: 'mma_mixed_martial_arts' },
  { path: 'rugby/270559', sport: 'rugby', league: 'Top 14', oddsTitle: /top ?14/i },
  { path: 'rugby/267979', sport: 'rugby', league: 'Premiership Rugby', oddsTitle: /premiership/i },
  { path: 'rugby/270557', sport: 'rugby', league: 'United Rugby Championship', oddsTitle: /united rugby|\burc\b/i },
  { path: 'rugby/271937', sport: 'rugby', league: 'Champions Cup', oddsTitle: /champions cup/i },
  { path: 'rugby/180659', sport: 'rugby', league: 'Six Nations', oddsTitle: /six nations/i },
  { path: 'rugby/242041', sport: 'rugby', league: 'Super Rugby', oddsTitle: /super rugby/i },
  { path: 'rugby/244293', sport: 'rugby', league: 'Rugby Championship', oddsTitle: /rugby championship/i },
  { path: 'rugby/164205', sport: 'rugby', league: 'Coupe du monde de rugby', oddsTitle: /rugby.*world cup|world cup.*rugby/i },
  { path: 'australian-football/afl', sport: 'afl', league: 'AFL', odds: 'aussierules_afl', minor: true },
];
const SRC_BY_PATH = new Map(SOURCES.map(s => [s.path, s]));

const SPORT_ORDER = ['soccer', 'tennis', 'basketball', 'rugby', 'hockey', 'football', 'baseball', 'mma', 'afl'];

// ---------- Stockage local ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage plein ou bloqué */ } },
};
const settings = () => ({ key: '', maxCredits: 20, ...store.get('pdj-settings', {}) });

// ---------- Dates ----------
const pad = n => String(n).padStart(2, '0');
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// ESPN range les matchs par journée de New York : on interroge les journées qui couvrent la nôtre.
const etDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(d).replace(/-/g, '');
function dayBounds(day) {
  return [new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0), new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59)];
}
const espnDatesFor = day => [...new Set(dayBounds(day).map(etDay))];
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
      // Jeux de chaque set (+ points du tie-break), pour l'affichage façon site de scores
      games: c.linescores?.map(l => ({ v: l.value, tb: l.tiebreak, w: !!l.winner })),
    };
  }
  const t = c.team || {};
  return {
    id: t.id, name: t.displayName, short: t.shortDisplayName || t.displayName, logo: t.logo,
    record: rec('total'), homeRecord: rec('home'), awayRecord: rec('road') || rec('away'),
    form: c.form, avgPts: stat('avgPoints'), score: c.score, winner: c.winner,
  };
}

function toMatch(src, ev, comp, ranks, extra = {}) {
  const cs = comp.competitors || [];
  const home = cs.find(c => c.homeAway === 'home') || cs[0];
  const away = cs.find(c => c.homeAway === 'away') || cs[1];
  if (!home || !away) return null;
  const status = comp.status || ev.status || {};
  const st = status.type || {};
  return {
    id: `${src.path}:${comp.id || ev.id}`,
    eventId: ev.id,
    sport: src.sport,
    src: { path: src.path, home: src.home, total: src.total, sd: src.sd, tsd: src.tsd, minor: src.minor },
    league: extra.league || src.league,
    tournament: extra.tournament,
    round: extra.round,
    date: comp.date || ev.date,
    state: st.state || 'pre',
    canceled: /POSTPONED|CANCELED|CANCELLED|SUSPENDED/.test(st.name || ''),
    detail: st.shortDetail || st.detail || '',
    clock: status.clock, period: status.period, // temps de jeu, pour l'estimation en direct
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
            const m = toMatch(src, ev, c, ranks, { league: `${src.league} · ${ev.name}`, tournament: ev.name, round: c.round?.displayName });
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

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

// Interroge toutes les sources (8 en parallèle) ; une source en échec n'arrête pas les autres.
async function fetchDay(day, onProgress) {
  const dates = espnDatesFor(day);
  const ranks = { atp: await getRanks('atp'), wta: await getRanks('wta') };
  const matches = [];
  const failed = [];
  let done = 0;
  await pool(SOURCES, 8, async src => {
    try { matches.push(...await fetchSource(src, dates, day, ranks[src.tour])); }
    catch { failed.push(src.league); }
    onProgress(++done, SOURCES.length);
  });
  const seen = new Set();
  return {
    matches: matches.filter(m => !seen.has(m.id) && seen.add(m.id)).sort((a, b) => a.date.localeCompare(b.date)),
    failed,
  };
}

// ---------- Vraies cotes Betclic / Winamax (The Odds API) ----------
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
  .filter(w => w && !['fc', 'cf', 'sc', 'ac', 'as', 'afc', 'club', 'de', 'la', 'the', 'cd', 'sv', 'fk', 'sk', 'if', 'bk', 'calcio', 'ssc', 'us', 'rc', 'og', 'ogc', 'stade'].includes(w));

function nameSim(a, b) {
  const x = norm(a), y = norm(b);
  if (!x.length || !y.length) return 0;
  const hit = x.filter(w => y.some(v => v === w || (w.length >= 4 && v.length >= 4 && (v.startsWith(w) || w.startsWith(v))))).length;
  return hit / Math.min(x.length, y.length);
}

// Retrouve l'événement The Odds API correspondant à un match ESPN (noms proches + même horaire).
function findEvent(m, events) {
  let best = null;
  for (const ev of events) {
    if (Math.abs(new Date(ev.commence_time) - new Date(m.date)) > 3 * 3600e3) continue;
    const straight = Math.min(nameSim(m.home.name, ev.home_team), nameSim(m.away.name, ev.away_team));
    const swapped = Math.min(nameSim(m.home.name, ev.away_team), nameSim(m.away.name, ev.home_team));
    const s = Math.max(straight, swapped);
    if (s >= 0.5 && (!best || s > best.s)) best = { ev, s };
  }
  return best?.ev || null;
}

// Convertit les cotes d'un événement en { betclic: {ml, ou, hcp}, winamax: {...} } côté ESPN (H = domicile ESPN).
function booksFor(m, ev) {
  const side = name => {
    if (name === 'Draw') return 'D';
    return nameSim(m.home.name, name) >= nameSim(m.away.name, name) ? 'H' : 'A';
  };
  const books = {};
  for (const bk of ev.bookmakers || []) {
    const key = ODDS_BOOKS[bk.key];
    if (!key) continue;
    const b = { ml: {}, ou: {}, hcp: {} };
    for (const mk of bk.markets || []) {
      if (mk.key === 'h2h') for (const o of mk.outcomes) b.ml[side(o.name)] = o.price;
      if (mk.key === 'totals') for (const o of mk.outcomes) {
        b.ou[o.point] = b.ou[o.point] || {};
        b.ou[o.point][o.name === 'Over' ? 'O' : 'U'] = o.price;
      }
      if (mk.key === 'spreads') {
        const h = mk.outcomes.find(o => side(o.name) === 'H');
        const a = mk.outcomes.find(o => side(o.name) === 'A');
        if (h && a) b.hcp[h.point] = { H: h.price, A: a.price };
      }
    }
    books[key] = b;
  }
  return Object.keys(books).length ? books : null;
}

const TENNIS_GENERIC = new Set(['open', 'tennis', 'championships', 'championship', 'international', 'internationaux', 'rolex', 'presented', 'masters', 'cup', 'trophy', 'ladies', 'mens', 'womens', 'classic']);

function oddsKeyFor(group, sports) {
  const src = SRC_BY_PATH.get(group.path);
  if (src.sport === 'tennis') {
    const words = norm(group.tournament).filter(w => w.length >= 4 && !TENNIS_GENERIC.has(w));
    const tour = src.tour.toUpperCase();
    return sports.find(s => s.group === 'Tennis' && s.title.toUpperCase().includes(tour)
      && words.some(w => norm(s.title).includes(w)))?.key;
  }
  if (src.odds) return sports.find(s => s.key === src.odds)?.key;
  if (src.oddsTitle) return sports.find(s => /rugby/i.test(s.group) && src.oddsTitle.test(s.title))?.key;
  return null;
}

// Récupère les cotes pour les compétitions du jour, dans la limite de crédits choisie.
// Retourne { covered: Set de clés interrogées, credits } et remplit m.books.
async function fetchBooks(matches, day, onProgress) {
  const { key, maxCredits } = settings();
  if (!key) return null;
  const sports = await getJson(`${ODDS_API}sports?apiKey=${encodeURIComponent(key)}`); // gratuit
  // Regroupe les matchs à venir par compétition (et par tournoi au tennis)
  const groups = new Map();
  for (const m of matches) {
    if (m.state !== 'pre' || m.canceled) continue;
    const g = `${m.src.path}|${m.tournament || ''}`;
    if (!groups.has(g)) groups.set(g, { path: m.src.path, tournament: m.tournament, matches: [] });
    groups.get(g).matches.push(m);
  }
  const jobs = [...groups.values()]
    .map(g => ({ ...g, key: oddsKeyFor(g, sports) }))
    .filter(g => g.key)
    .sort((a, b) => b.matches.length - a.matches.length);
  const [from, to] = dayBounds(day).map(d => d.toISOString().replace(/\.\d{3}Z$/, 'Z'));
  const covered = new Set();
  let spent = 0;
  let credits = null;
  for (const job of jobs) {
    const sport = SRC_BY_PATH.get(job.path).sport;
    const markets = sport === 'soccer' ? 'h2h,totals' : sport === 'tennis' || sport === 'mma' ? 'h2h' : 'h2h,spreads,totals';
    const cost = markets.split(',').length;
    if (spent + cost > maxCredits) break;
    onProgress(`Cotes ${SRC_BY_PATH.get(job.path).league}…`);
    const url = `${ODDS_API}sports/${job.key}/odds?apiKey=${encodeURIComponent(key)}&bookmakers=${Object.keys(ODDS_BOOKS).join(',')}`
      + `&markets=${markets}&oddsFormat=decimal&commenceTimeFrom=${from}&commenceTimeTo=${to}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (r.status === 401 || r.status === 429) throw new Error(r.status === 401 ? 'Clé The Odds API invalide' : 'Crédits The Odds API épuisés');
    credits = { remaining: Number(r.headers.get('x-requests-remaining')), used: Number(r.headers.get('x-requests-used')), at: Date.now() };
    if (!r.ok) continue;
    spent += cost;
    const events = await r.json();
    covered.add(job.key);
    for (const m of job.matches) {
      const ev = findEvent(m, events);
      m.oddsChecked = true;
      m.books = ev ? booksFor(m, ev) : null;
    }
  }
  if (credits) store.set('pdj-credits', credits);
  return { covered, credits };
}

// ---------- Compositions d'équipe (football) ----------
const rosterCache = new Map();

async function teamRoster(path, teamId) {
  const k = `${path}|${teamId}`;
  if (!rosterCache.has(k)) {
    rosterCache.set(k, getJson(`${API}${path}/teams/${teamId}/roster?enable=stats`).then(j => (j.athletes || []).map(p => {
      const s = {};
      for (const c of p.statistics?.splits?.categories || []) for (const x of c.stats) s[x.name] = x.value;
      const app = s.appearances || 0;
      return {
        id: String(p.id), name: p.shortName || p.displayName, pos: p.position?.abbreviation || '',
        starts: Math.max(0, app - (s.subIns || 0)), g: s.totalGoals || 0, a: s.goalAssists || 0,
        out: !!(p.injuries?.length) || (p.status?.type && p.status.type !== 'active'),
      };
    })).catch(e => { rosterCache.delete(k); throw e; }));
  }
  return rosterCache.get(k);
}

// Les 11 joueurs les plus souvent titulaires = titulaires habituels.
// Compo officielle : absents = habituels hors du onze. Compo probable : habituels blessés
// ou non alignés lors du dernier match.
function lineupSide(players, starters, lastXI) {
  const ranked = [...players].filter(p => p.starts > 0).sort((a, b) => b.starts - a.starts);
  // Seuls les vrais piliers comptent (≥ 60 % des titularisations du joueur le plus utilisé) :
  // un remplaçant qui tourne n'est pas une absence.
  const maxStarts = ranked[0]?.starts || 0;
  const regulars = ranked.slice(0, 11).filter(p => p.starts >= 0.6 * maxStarts);
  const official = starters && starters.size >= 11;
  const absent = regulars.filter(p => (official ? !starters.has(p.id) : p.out || (lastXI && !lastXI.has(p.id))));
  const contrib = Math.max(1, players.reduce((s, p) => s + p.g + 0.7 * p.a, 0));
  const lost = absent.reduce((s, p) => s + p.g + 0.7 * p.a, 0);
  const attackers = absent.filter(p => p.pos === 'F' || p.pos === 'M').length;
  const defenders = absent.filter(p => p.pos === 'D').length;
  const keeper = absent.some(p => p.pos === 'G');
  // Le remplaçant compense une partie de la perte : effet modéré et plafonné
  return {
    absent: absent.map(({ name, pos, g, a }) => ({ name, pos, g, a })),
    att: Math.min(0.15, 0.35 * lost / contrib + 0.008 * attackers),
    def: Math.min(0.10, 0.02 * defenders + (keeper ? 0.04 : 0)),
    known: ranked.length >= 11,
  };
}

// Le onze aligné par l'équipe lors de son dernier match (base de la compo probable).
async function lastStarters(sum, teamId) {
  const games = (sum.lastFiveGames || []).find(t => String(t.team?.id) === String(teamId))?.events || [];
  const last = [...games].sort((a, b) => b.gameDate.localeCompare(a.gameDate))[0];
  if (!last) return null;
  const s = await getJson(`${API}soccer/all/summary?event=${last.id}`);
  const r = (s.rosters || []).find(x => String(x.team?.id) === String(teamId));
  const ids = new Set((r?.roster || []).filter(p => p.starter).map(p => String(p.athlete?.id)));
  return ids.size >= 11 ? ids : null;
}

async function loadLineup(m, sum) {
  const [rh, ra] = await Promise.all([teamRoster(m.src.path, m.home.id), teamRoster(m.src.path, m.away.id)]);
  const xi = side => {
    const r = (sum.rosters || []).find(x => x.homeAway === side);
    const ids = new Set((r?.roster || []).filter(p => p.starter).map(p => String(p.athlete?.id)));
    return { ids, formation: r?.formation };
  };
  const h = xi('home'), a = xi('away');
  const official = h.ids.size >= 11 && a.ids.size >= 11;
  const [lastH, lastA] = official ? [null, null] : await Promise.all([
    lastStarters(sum, m.home.id).catch(() => null),
    lastStarters(sum, m.away.id).catch(() => null),
  ]);
  const home = { ...lineupSide(rh, official ? h.ids : null, lastH), formation: h.formation };
  const away = { ...lineupSide(ra, official ? a.ids : null, lastA), formation: a.formation };
  m.lineup = (home.known && away.known) || official
    ? { status: official ? 'official' : 'probable', at: Date.now(), home, away, basedOnLast: !!(lastH || lastA) }
    : { status: 'unknown', at: Date.now() };
  return m.lineup;
}

// ---------- Données avancées ----------
// 5 derniers résultats, confrontations directes et blessés, tirés du résumé ESPN du match.
function parseDeep(m, sum) {
  const last5 = {};
  for (const [side, t] of [['home', m.home], ['away', m.away]]) {
    const ev = (sum.lastFiveGames || []).find(x => String(x.team?.id) === String(t.id))?.events || [];
    if (!ev.length) continue;
    const sorted = [...ev].sort((a, b) => a.gameDate.localeCompare(b.gameDate));
    let gf = 0, ga = 0;
    for (const e of sorted) {
      const home = String(e.homeTeamId) === String(t.id);
      const hs = Number(e.homeTeamScore) || 0, as = Number(e.awayTeamScore) || 0;
      gf += home ? hs : as;
      ga += home ? as : hs;
    }
    last5[side] = { n: sorted.length, gf, ga, form: sorted.map(e => e.gameResult || '').join('') };
  }
  const ser = (sum.seasonseries || []).find(s => s.type === 'head-to-head') || sum.seasonseries?.[0];
  let h2h = null, n = 0, pts = 0;
  for (const e of ser?.events || []) {
    if ((e.statusType?.state || e.status?.type?.state) !== 'post') continue;
    const c = (e.competitors || []).find(x => String(x.id || x.team?.id) === String(m.home.id));
    const o = (e.competitors || []).find(x => x !== c);
    if (!c || !o) continue;
    n++;
    pts += c.winner ? 1 : o.winner ? 0 : 0.5;
  }
  if (n) h2h = { n, homeShare: pts / n, summary: ser.summary };
  const injuries = {};
  for (const [side, t] of [['home', m.home], ['away', m.away]]) {
    const list = (sum.injuries || []).find(x => String(x.team?.id) === String(t.id))?.injuries || [];
    injuries[side] = list.map(p => ({ name: p.athlete?.shortName || p.athlete?.displayName, status: p.status || '' }));
  }
  return {
    at: Date.now(), last5, h2h,
    injuries: injuries.home.length || injuries.away.length ? injuries : null,
  };
}

// Analyse détaillée d'un match : un seul appel ESPN (gratuit), + effectifs au football.
async function loadDeep(m) {
  const sum = await getJson(`${API}${m.src.path}/summary?event=${m.eventId}`);
  m.deep = parseDeep(m, sum);
  if (m.sport === 'soccer') await loadLineup(m, sum);
  return m;
}

// Classements (1 appel par compétition, gratuit) : buts/points marqués et encaissés.
async function fetchStandings(matches) {
  const paths = [...new Set(matches.filter(m => m.home.id && !['tennis', 'mma'].includes(m.sport)).map(m => m.src.path))];
  const tables = new Map();
  await pool(paths, 6, async path => {
    try {
      const j = await getJson(`https://site.api.espn.com/apis/v2/sports/${path}/standings`);
      const entries = [];
      const walk = node => { if (node.standings?.entries) entries.push(...node.standings.entries); (node.children || []).forEach(walk); };
      walk(j);
      const teams = new Map();
      let gfSum = 0, gpSum = 0;
      for (const e of entries) {
        const s = {};
        for (const x of e.stats || []) s[x.name] = x.value;
        const gp = s.gamesPlayed || (s.wins || 0) + (s.losses || 0) + (s.ties || 0) + (s.otLosses || 0);
        if (!gp || s.pointsFor == null || s.pointsAgainst == null) continue;
        teams.set(String(e.team?.id), { gp, gf: s.pointsFor, ga: s.pointsAgainst, rank: s.rank || null });
        gfSum += s.pointsFor;
        gpSum += gp;
      }
      if (teams.size) tables.set(path, { teams, avg: gpSum ? gfSum / gpSum : null });
    } catch { /* pas de classement (coupe, tournoi) */ }
  });
  for (const m of matches) {
    const t = tables.get(m.src.path);
    const h = t?.teams.get(String(m.home.id)), a = t?.teams.get(String(m.away.id));
    m.adv = h && a ? { avg: t.avg, home: h, away: a } : null;
  }
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
      preds[m.id] = { type: best.type, side: best.side, line: best.line, label: best.label, p: best.p, day: dayKey(new Date(m.date)), path: m.src.path };
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

// Retire partout (journées gardées, pronos, bilan) les compétitions qui ne sont plus suivies,
// par exemple la NCAA Basket, absente de Betclic et Winamax.
function purgeRemovedLeagues() {
  const removed = new Set();
  const known = p => SRC_BY_PATH.has(p);
  try {
    for (const k of Object.keys(localStorage).filter(k => k.startsWith('pdj-v2-day-'))) {
      const c = store.get(k, null);
      if (!c?.matches) continue;
      const keep = c.matches.filter(m => known(m.src?.path));
      if (keep.length === c.matches.length) continue;
      c.matches.filter(m => !known(m.src?.path)).forEach(m => removed.add(m.id));
      store.set(k, { ...c, matches: keep });
    }
  } catch { /* stockage indisponible */ }
  const preds = store.get('pdj-preds', {});
  const hist = store.get('pdj-history', {});
  for (const id of Object.keys(preds)) {
    if (removed.has(id) || (preds[id].path && !known(preds[id].path))) { removed.add(id); delete preds[id]; }
  }
  for (const id of removed) delete hist[id];
  store.set('pdj-preds', preds);
  store.set('pdj-history', hist);
}

function resultOf(m) {
  const sets = m.sport === 'tennis' ? (m.home.sets || 0) + (m.away.sets || 0) : null;
  return {
    h: Number(m.home.score), a: Number(m.away.score),
    winner: m.home.winner ? 'H' : m.away.winner ? 'A' : null,
    sets,
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
  peek: new Set(), // détails ouverts directement dans un top (« top:id », « idDuDéfi:id »)
  loadingLineup: new Set(),
  data: null,
  tab: store.get('pdj-ui', {}).tab === 'defis' ? 'defis' : 'matchs',
};

function selectedDay() {
  const d = new Date();
  d.setDate(d.getDate() + ui.dayOffset);
  return d;
}

const cacheKey = day => `pdj-v2-day-${dayKey(day)}`;
const withAnalysis = m => ({ ...m, analysis: Engine.analyze(m) });

function loadCached() {
  const c = store.get(cacheKey(selectedDay()), null);
  ui.data = c ? { ...c, matches: c.matches.filter(m => SRC_BY_PATH.has(m.src?.path)).map(withAnalysis) } : null;
}

// Réenregistre la journée (sans les analyses, recalculées à l'ouverture).
function saveDay() {
  if (!ui.data) return;
  const { matches, ...rest } = ui.data;
  store.set(cacheKey(new Date(`${ui.data.day}T12:00:00`)), { ...rest, matches: matches.map(({ analysis, ...m }) => m) });
}

// Analyse détaillée automatique des matchs de foot qui commencent dans moins de 80 min
// (les compos officielles sont souvent publiées).
async function autoDeep(matches) {
  const soon = matches.filter(m => m.sport === 'soccer' && m.state === 'pre' && !m.canceled
    && new Date(m.date) - Date.now() < 80 * 60e3 && m.lineup?.status !== 'official').slice(0, 8);
  await pool(soon, 3, async m => { try { await loadDeep(m); } catch { /* compo indisponible */ } });
  return soon.length;
}

const strip = ({ analysis, ...m }) => m;

// Une mise à jour garde ce qui a déjà été chargé : vraies cotes, compos, analyse détaillée.
function mergeKnown(fresh) {
  const prev = new Map((ui.data?.day === dayKey(selectedDay()) ? ui.data.matches : []).map(m => [m.id, m]));
  return fresh.map(m => {
    const o = prev.get(m.id);
    return o ? { ...m, books: o.books, oddsChecked: o.oddsChecked, lineup: o.lineup, deep: o.deep, adv: m.adv || o.adv } : m;
  });
}

// Enregistre la journée, recalcule les pronostics et met à jour le bilan.
function setData(matches, extra = {}) {
  const same = ui.data?.day === dayKey(selectedDay()) ? ui.data : {};
  const hiddenIds = [...new Set([...(same.hiddenIds || []), ...(extra.hiddenIds || [])])];
  ui.data = {
    day: dayKey(selectedDay()), fetchedAt: same.fetchedAt || Date.now(), failed: same.failed || [], oddsAt: same.oddsAt,
    ...extra, hiddenIds,
    matches: matches.filter(m => !hiddenIds.includes(m.id)).map(withAnalysis),
  };
  saveDay();
  rememberPicks(ui.data.matches);
}

function setBusy(btn, on) {
  btn.disabled = on;
  btn.classList.toggle('busy', on);
}

// Mise à jour gratuite (ESPN) : matchs, scores, classements, compos. Aucun crédit utilisé.
async function update() {
  const btn = $('#refresh');
  if (btn.disabled) return;
  setBusy(btn, true);
  const label = $('#refresh-label');
  const day = selectedDay();
  try {
    const { matches, failed } = await fetchDay(day, (d, n) => { label.textContent = `Matchs ${d}/${n}`; });
    label.textContent = 'Stats…';
    await fetchStandings(matches);
    const merged = mergeKnown(matches);
    label.textContent = 'Compos…';
    await autoDeep(merged);
    try {
      Object.keys(localStorage).filter(k => k.startsWith('pdj-v2-day-')).sort().slice(0, -2).forEach(k => localStorage.removeItem(k));
    } catch { /* ignore */ }
    setData(merged, { fetchedAt: Date.now(), failed });
    toast(ui.data.matches.length ? `${ui.data.matches.length} matchs à jour (gratuit)` : 'Aucun match trouvé pour cette journée');
  } catch {
    toast('Impossible de joindre les sources. Vérifiez votre connexion internet puis réessayez.');
  } finally {
    setBusy(btn, false);
    label.textContent = 'Mettre à jour';
    render();
  }
}

// Coût estimé d'un chargement des vraies cotes (le réel dépend des compétitions reconnues).
function estimateCost() {
  if (!ui.data) return 0;
  const groups = new Map();
  for (const m of ui.data.matches) {
    if (m.state !== 'pre' || m.canceled) continue;
    const s = SRC_BY_PATH.get(m.src.path);
    if (!s || !(s.odds || s.oddsTitle || s.sport === 'tennis')) continue;
    groups.set(`${m.src.path}|${m.tournament || ''}`, s.sport === 'soccer' ? 2 : s.sport === 'tennis' || s.sport === 'mma' ? 1 : 3);
  }
  return Math.min(settings().maxCredits, [...groups.values()].reduce((a, b) => a + b, 0));
}

// Demande toujours une confirmation avant de dépenser des crédits The Odds API.
function confirmCredits(cost) {
  const d = $('#confirm-odds');
  const c = store.get('pdj-credits', null);
  const max = settings().maxCredits;
  $('#confirm-text').innerHTML = `Cette actualisation va utiliser <b>jusqu’à ${cost} crédit${cost > 1 ? 's' : ''}</b> The Odds API`
    + ` (limite réglée : ${max} par actualisation).<br>`
    + (c ? `Crédits restants ce mois-ci : <b>${c.remaining}</b> (relevé le ${new Date(c.at).toLocaleDateString('fr-FR')} à ${timeOf(new Date(c.at).toISOString())}).`
      : 'Crédits restants : inconnus pour l’instant, ils seront affichés après ce chargement.');
  return new Promise(resolve => {
    d.returnValue = 'cancel';
    d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
    d.showModal();
  });
}

// Vraies cotes Betclic / Winamax : seul bouton qui utilise des crédits The Odds API.
async function loadOdds() {
  const btn = $('#odds-btn');
  if (btn.disabled) return;
  if (!ui.data) { toast('Mettez d’abord les matchs à jour.'); return; }
  const cost = estimateCost();
  if (!cost) { toast('Aucun match à venir dont les cotes peuvent être chargées.'); return; }
  if (!(await confirmCredits(cost))) return;
  setBusy(btn, true);
  try {
    const res = await fetchBooks(ui.data.matches, selectedDay(), t => { btn.textContent = t; });
    const hiddenIds = ui.data.matches.filter(m => m.oddsChecked && !m.books).map(m => m.id);
    const withBooks = ui.data.matches.filter(m => m.books).length;
    setData(ui.data.matches.map(strip), { hiddenIds, oddsAt: Date.now() });
    toast(`Vraies cotes pour ${withBooks} matchs${hiddenIds.length ? ` · ${hiddenIds.length} non proposé(s) retiré(s)` : ''}${res?.credits ? ` · ${res.credits.remaining} crédits restants` : ''}`);
  } catch (e) {
    toast(e.message || 'Impossible de charger les cotes.');
  } finally {
    setBusy(btn, false);
    render();
  }
}

// Bouton « compos / stats » d'un match : recharge et recalcule le prono, puis montre ce qui a changé.
async function refreshDeep(id) {
  const i = ui.data.matches.findIndex(m => m.id === id);
  if (i < 0 || ui.loadingLineup.has(id)) return;
  ui.loadingLineup.add(id);
  render();
  try {
    const before = ui.data.matches[i].analysis.best;
    const m = strip(ui.data.matches[i]);
    await loadDeep(m);
    ui.data.matches[i] = withAnalysis(m);
    saveDay();
    if (m.state === 'pre') rememberPicks([ui.data.matches[i]]);
    const after = ui.data.matches[i].analysis.best;
    const l = m.lineup;
    const what = m.sport !== 'soccer' ? 'Blessés et stats pris en compte'
      : l?.status === 'official' ? 'Compos officielles prises en compte'
      : l?.status === 'probable' ? 'Compo probable prise en compte (officielle pas encore publiée)'
      : 'Compos indisponibles, stats prises en compte';
    toast(`${what} · prono : ${after.label === before.label ? `${after.label} ${pct(before.p)} → ${pct(after.p)}` : `${before.label} → ${after.label} (${pct(after.p)})`}`);
  } catch {
    toast('Impossible de charger les compos et stats. Réessayez plus tard.');
  } finally {
    ui.loadingLineup.delete(id);
    render();
  }
}

// ---------- Temps réel (gratuit) ----------
// Toutes les minutes, quand l'app est ouverte : scores et statuts des matchs en cours ou sur le
// point de commencer. Toutes les 5 minutes : compos des matchs de foot proches.
const LIVE_MS = 60e3;
let liveTicks = 0;
let liveBusy = false;

async function liveTick() {
  if (liveBusy || document.hidden || !ui.data || ui.dayOffset !== 0 || ui.data.day !== dayKey(new Date())) return;
  liveTicks++;
  const now = Date.now();
  const watch = ui.data.matches.filter(m => !m.canceled && (m.state === 'in' || (m.state === 'pre' && new Date(m.date) - now < 10 * 60e3)));
  const lineupsDue = liveTicks % 5 === 0 && ui.data.matches.some(m => m.sport === 'soccer' && m.state === 'pre'
    && new Date(m.date) - now < 80 * 60e3 && m.lineup?.status !== 'official');
  if (!watch.length && !lineupsDue) return;
  liveBusy = true;
  try {
    const day = selectedDay();
    const dates = espnDatesFor(day);
    const fresh = new Map();
    await pool([...new Set(watch.map(m => m.src.path))], 4, async p => {
      try { for (const f of await fetchSource(SRC_BY_PATH.get(p), dates, day, null)) fresh.set(f.id, f); } catch { /* réessai à la prochaine minute */ }
    });
    const matches = ui.data.matches.map(m => {
      const base = strip(m);
      const f = fresh.get(base.id);
      if (!f) return base;
      // On ne reprend que l'état du match : les données d'avant-match restent celles du jour
      return {
        ...base, state: f.state, detail: f.detail, canceled: f.canceled, date: f.date, clock: f.clock, period: f.period,
        home: { ...base.home, score: f.home.score, winner: f.home.winner, sets: f.home.sets, games: f.home.games },
        away: { ...base.away, score: f.away.score, winner: f.away.winner, sets: f.away.sets, games: f.away.games },
      };
    });
    if (lineupsDue) await autoDeep(matches);
    setData(matches);
    ui.liveAt = Date.now();
    render();
  } finally {
    liveBusy = false;
  }
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 4000);
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

// Les meilleurs paris : matchs à venir, classés par probabilité x fiabilité, bonus si vraie cote « value »
function topPicks(matches) {
  return matches
    .filter(m => m.state === 'pre' && !m.canceled && m.analysis.best.bestOdd.v >= 1.3)
    .map(m => {
      const b = m.analysis.best;
      const ev = b.p * b.bestOdd.v - 1;
      return { m, score: b.p * (0.75 + 0.1 * m.analysis.reliability) + 0.8 * Math.max(-0.15, Math.min(ev, 0.15)) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(x => x.m);
}

// « Winamax 1,85 » ou « ≈ 1,82 Winamax » (estimée)
function oddTag(b) {
  const o = b.bestOdd;
  return `<span class="bk ${o.real ? 'real' : 'est'}">${o.real ? '' : '≈ '}${odd(o.v)} <small>${Engine.BOOKS[b.bestBook]}</small></span>`;
}

function renderHeader() {
  const day = selectedDay();
  $('#date').textContent = day.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  document.querySelectorAll('[data-day]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.day) === ui.dayOffset)));
  const meta = $('#meta');
  if (ui.data) {
    const at = new Date(ui.data.fetchedAt);
    const stale = dayKey(at) !== dayKey(new Date());
    const real = ui.data.matches.filter(m => m.books).length;
    const live = ui.data.matches.filter(m => m.state === 'in').length;
    meta.innerHTML = `${ui.data.matches.length} matchs · mis à jour ${stale ? 'le ' + at.toLocaleDateString('fr-FR') + ' à ' : 'à '}${timeOf(at)}`
      + ` · ${real ? `vraies cotes sur ${real} matchs${ui.data.oddsAt ? ` (${timeOf(new Date(ui.data.oddsAt).toISOString())})` : ''}` : 'cotes estimées'}`
      + (live ? ` · <span class="live-dot">Direct : ${live} match${live > 1 ? 's' : ''}${ui.liveAt ? `, scores à ${timeOf(new Date(ui.liveAt).toISOString())}` : ''}</span>` : '')
      + (ui.data.failed?.length ? ` · <span class="warn">${ui.data.failed.length} source(s) indisponible(s)</span>` : '');
    $('#stale').hidden = !stale;
  } else {
    meta.textContent = 'Pas encore de données pour cette journée';
    $('#stale').hidden = true;
  }
  const hasKey = !!settings().key;
  $('#odds-hint').hidden = hasKey;
  const ob = $('#odds-btn');
  ob.hidden = !hasKey || !ui.data;
  if (!ob.disabled) ob.textContent = `Charger les vraies cotes (≈ ${estimateCost()} crédits)`;
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

function teamLine(t, m) {
  let side = '';
  if (m.sport === 'tennis') side = t.rank ? `<span class="tag">n°${t.rank}</span>` : '<span class="tag dim">NC</span>';
  else if (t.form) side = `<span class="form" aria-label="Forme récente">${[...t.form].slice(-5).map(c => `<i class="f-${c.toUpperCase()}"></i>`).join('')}</span>`;
  const score = m.state === 'pre' ? '' : m.sport === 'tennis' ? (t.sets ?? '') : (t.score ?? '');
  const games = m.sport === 'tennis' && m.state !== 'pre' && t.games?.length ? tennisGames(t, m) : '';
  return `<div class="team${t.winner ? ' won' : ''}">
    ${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy" width="22" height="22">` : '<span class="nologo"></span>'}
    <span class="tname">${esc(t.name)}</span>${side}
    ${games || (score !== '' ? `<b class="score">${esc(score)}</b>` : '')}
  </div>`;
}

// Tennis : sets gagnés puis jeux de chaque set (tie-break du perdant en exposant), set en cours surligné.
function tennisGames(t, m) {
  const other = t === m.home ? m.away : m.home;
  const cells = t.games.map((g, i) => {
    const o = other.games?.[i];
    const done = g.w || o?.w;
    const tb = done && !g.w && g.tb != null ? `<sup>${g.tb}</sup>` : '';
    const cls = !done && m.state === 'in' ? 'cur' : g.w ? 'won' : '';
    return `<span class="g ${cls}">${g.v ?? 0}${tb}</span>`;
  }).join('');
  return `<span class="tgames" aria-label="Sets ${t.sets ?? 0}, jeux ${t.games.map(g => g.v ?? 0).join(' ')}"><b class="score">${t.sets ?? 0}</b>${cells}</span>`;
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

// Effet des compos / blessés / stats détaillées sur le prono : avant → après.
function deepEffect(m) {
  if (!m.lineup?.home && !m.deep) return '';
  const base = Engine.analyze({ ...m, lineup: null, deep: null });
  const now = m.analysis;
  const rows = now.bets
    .filter(b => b.type === 'ml' || b.type === 'win' || b === now.best)
    .map(b => {
      const old = base.bets.find(x => x.type === b.type && x.side === b.side && x.line === b.line);
      if (!old) return '';
      const d = Math.round((b.p - old.p) * 100);
      return `<li>${esc(b.label)} : ${pct(old.p)} → <b>${pct(b.p)}</b> <span class="delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${d}</span></li>`;
    }).join('');
  const changed = base.best.label !== now.best.label ? `<p>Meilleur pari : « ${esc(base.best.label)} » → <b>« ${esc(now.best.label)} »</b></p>` : '';
  return `<div class="effect"><p class="effect-title">Effet des compos et stats détaillées sur le prono</p><ul>${rows}</ul>${changed}</div>`;
}

function deepBlock(m) {
  if (m.state !== 'pre' || m.sport === 'tennis' || !m.home.id) return '';
  const l = m.lineup;
  const loading = ui.loadingLineup.has(m.id);
  const at = x => timeOf(new Date(x).toISOString());
  let status;
  if (m.sport === 'soccer') {
    if (!l) status = 'Compos et stats détaillées (5 derniers matchs, confrontations) non chargées. Les compos officielles sortent environ 1 h avant le coup d’envoi.';
    else if (l.status === 'official') status = `Compos officielles chargées à ${at(l.at)} (${esc(l.home.formation || '?')} contre ${esc(l.away.formation || '?')}).`;
    else if (l.status === 'probable') status = `Compo probable (${l.basedOnLast ? 'onze du dernier match, moins les blessés connus' : 'titulaires habituels moins les blessés connus'}), vérifiée à ${at(l.at)}. Son effet compte à 60 % ; la compo officielle sort environ 1 h avant le match.`;
    else status = 'Pas assez de données pour estimer les compos de ce match.';
  } else {
    status = m.deep ? `Blessés, confrontations et forme chargés à ${at(m.deep.at)}.` : 'Blessés, confrontations directes et forme récente non chargés.';
  }
  const label = loading ? 'Chargement…' : m.sport === 'soccer' ? (l ? 'Revérifier les compos' : 'Charger compos et stats') : (m.deep ? 'Revérifier blessés et stats' : 'Charger blessés et stats');
  return `<div class="lineup">
    <p>${status} <small>Gratuit, ne consomme aucun crédit.</small></p>
    <button type="button" class="ghost" data-lineup="${esc(m.id)}" ${loading ? 'disabled' : ''}>${label}</button>
  </div>${deepEffect(m)}`;
}

function oddCell(o, fair) {
  if (!o) return '<td class="n">–</td>';
  const value = o.real && o.v > fair;
  return `<td class="n ${o.real ? '' : 'est'}${value ? ' value' : ''}">${o.real ? '' : '≈'}${odd(o.v)}</td>`;
}

// Détail d'un match : analyse, compos/stats, tableau des paris. Sert dans la liste et dans les tops
// (a : analyse à afficher, par exemple l'estimation en direct ; deep : bouton compos / stats).
function matchDetails(m, { a = m.analysis, deep = true, hl = null } = {}) {
  const { best, bets, text } = a;
  const lineupBadge = m.lineup?.status === 'official' ? '<span class="badge">Compos officielles</span>' : '';
  const mark = hl || best;
  const same = b => b === mark || (b.type === mark.type && b.side === mark.side && b.line === mark.line);
  const rows = [...bets].sort((x, y) => y.p - x.p).map(b => `<tr${same(b) ? ' class="is-best"' : ''}>
      <td>${esc(b.label)}</td><td class="n">${pct(b.p)}</td><td class="n">${odd(b.fair)}</td>
      ${oddCell(b.odds.betclic, b.fair)}${oddCell(b.odds.winamax, b.fair)}</tr>`).join('');
  return `<div class="details">
      ${a.live ? '<span class="badge live">Estimation en direct</span>' : lineupBadge}
      <ul class="analysis">${text.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      ${deep && !a.live ? deepBlock(m) : ''}
      <div class="table-wrap"><table>
        <thead><tr><th>Pari</th><th class="n">Proba</th><th class="n">Cote juste</th><th class="n">Betclic</th><th class="n">Winamax</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="hint">« Cote juste » : à partir de cette cote, le pari est rentable selon notre estimation. Une cote précédée de ≈ est estimée (marge habituelle du bookmaker) : vérifiez la cote réelle dans l’appli Betclic ou Winamax. En vert : vraie cote supérieure à la cote juste.</p>
    </div>`;
}

// Ligne des équipes et score, en petit, pour le détail ouvert depuis un top
function peekHead(m) {
  return `<div class="peek-head"><span class="teams">${teamLine(m.home, m)}${teamLine(m.away, m)}</span></div>`;
}

function matchCard(m) {
  const { best, reliability } = m.analysis;
  const open = ui.open.has(m.id);
  const when = m.canceled ? 'Reporté' : m.state === 'pre' ? timeOf(m.date)
    : m.state === 'in' ? (m.sport === 'tennis' && m.period ? `Set ${m.period}` : esc(m.detail || 'En cours')) : 'Terminé';
  const pick = m.state === 'pre' && !m.canceled
    ? `<div class="pick"><span class="pick-label">${esc(best.label)}</span><span class="pick-p">${pct(best.p)}</span>${oddTag(best)}</div>`
    : verdict(m) || `<div class="pick muted"><span class="pick-label">${esc(best.label)}</span><span class="pick-p">${pct(best.p)}</span></div>`;
  return `<article class="match${open ? ' open' : ''}" data-id="${esc(m.id)}">
    <button class="match-head" aria-expanded="${open}">
      <span class="when ${m.state}">${when}${m.round ? `<small>${esc(m.round)}</small>` : ''}</span>
      <span class="teams">${teamLine(m.home, m)}${teamLine(m.away, m)}</span>
      ${bars(reliability)}
    </button>
    ${pick}
    ${open ? matchDetails(m) : ''}
  </article>`;
}

function renderTop(all) {
  const picks = topPicks(all);
  const el = $('#top');
  if (!picks.length) { el.hidden = true; return; }
  el.hidden = false;
  const combo = picks.filter(m => m.analysis.best.p >= 0.6).slice(0, 3);
  const comboP = combo.reduce((s, m) => s * m.analysis.best.p, 1);
  const comboOdd = combo.reduce((s, m) => s * m.analysis.best.bestOdd.v, 1);
  const comboReal = combo.every(m => m.analysis.best.bestOdd.real);
  $('#top-list').innerHTML = picks.map((m, i) => {
    const key = `top:${m.id}`;
    const open = ui.peek.has(key);
    return `<li class="peek${open ? ' open' : ''}">
      <button class="ticket" data-peek="${esc(key)}" aria-expanded="${open}">
        <span class="t-rank">${i + 1}</span>
        <span class="t-body">
          <span class="t-match">${esc(m.home.short)} – ${esc(m.away.short)}</span>
          <span class="t-meta">${timeOf(m.date)} · ${esc(Engine.SPORT_CFG[m.sport].label)} · ${esc(m.league)}</span>
          <span class="t-bet">${esc(m.analysis.best.label)}</span>
          <span class="t-more">${open ? 'Masquer le détail' : 'Voir le détail et les stats'}</span>
        </span>
        <span class="t-num"><b>${pct(m.analysis.best.p)}</b>${oddTag(m.analysis.best)}</span>
      </button>${open ? `<div class="peek-body">${peekHead(m)}${matchDetails(m)}</div>` : ''}</li>`;
  }).join('');
  const c = $('#combo');
  if (combo.length >= 2) {
    c.hidden = false;
    c.innerHTML = `<div class="combo-head"><span>Combiné du jour</span><span class="combo-num">${pct(comboP)} · cote ${comboReal ? '' : '≈ '}${odd(comboOdd)}</span></div>
      <ul>${combo.map(m => `<li><span>${esc(m.home.short)} – ${esc(m.away.short)}</span><b>${esc(m.analysis.best.label)}</b></li>`).join('')}</ul>
      <p class="hint">Un combiné multiplie les cotes mais aussi les risques : tous les paris doivent passer.</p>`;
  } else c.hidden = true;
}

function render() {
  renderHeader();
  renderDefis();
  renderRecord();
  renderChips();
  const list = $('#list');
  const empty = $('#empty');
  if (!ui.data) {
    $('#top').hidden = true;
    list.innerHTML = '';
    empty.hidden = false;
    empty.innerHTML = `<p class="empty-title">Aucun match chargé pour ${ui.dayOffset ? 'demain' : "aujourd'hui"}</p>
      <p>Appuyez sur <b>Mettre à jour</b> (gratuit) pour rechercher les matchs de la journée proposés par Betclic et Winamax et calculer les pronostics.</p>`;
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

// ---------- Réglages (clé The Odds API) ----------
function openSettings() {
  const s = settings();
  $('#api-key').value = s.key;
  $('#max-credits').value = s.maxCredits;
  const c = store.get('pdj-credits', null);
  $('#credits').textContent = c ? `Crédits restants ce mois-ci : ${c.remaining} (relevé le ${new Date(c.at).toLocaleDateString('fr-FR')}).` : 'Crédits : inconnus tant qu’aucune actualisation n’a utilisé la clé.';
  $('#settings').showModal();
}

function saveSettings(e) {
  e.preventDefault();
  const key = $('#api-key').value.trim();
  const maxCredits = Math.max(1, Math.min(100, Number($('#max-credits').value) || 20));
  store.set('pdj-settings', { key, maxCredits });
  $('#settings').close();
  toast(key ? 'Clé enregistrée : appuyez sur « Charger les vraies cotes »' : 'Clé supprimée : les cotes seront estimées');
  render();
}

function saveUi() { store.set('pdj-ui', { dayOffset: ui.dayOffset, status: ui.status, tab: ui.tab }); }

// Onglets « Matchs » et « Défis freebets »
function setTab(tab) {
  ui.tab = tab;
  saveUi();
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $('#view-matchs').hidden = tab !== 'matchs';
  $('#view-defis').hidden = tab !== 'defis';
  render();
}

function bind() {
  $('#refresh').addEventListener('click', update);
  $('#stale-refresh').addEventListener('click', update);
  $('#odds-btn').addEventListener('click', loadOdds);
  $('#open-settings').addEventListener('click', openSettings);
  $('#odds-hint-open').addEventListener('click', openSettings);
  $('#settings-form').addEventListener('submit', saveSettings);
  $('#settings-cancel').addEventListener('click', () => $('#settings').close());
  $('#confirm-cancel').addEventListener('click', () => $('#confirm-odds').close('cancel'));
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  // Bouton « revenir en haut », visible dès qu'on a fait défiler la page
  const toTop = $('#to-top');
  const onScroll = () => { toTop.hidden = window.scrollY < 500; };
  window.addEventListener('scroll', onScroll, { passive: true });
  toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  onScroll();
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
    const lu = e.target.closest('[data-lineup]');
    if (lu) { refreshDeep(lu.dataset.lineup); return; }
    const head = e.target.closest('.match-head');
    if (!head) return;
    const id = head.closest('.match').dataset.id;
    if (ui.open.has(id)) ui.open.delete(id); else ui.open.add(id);
    render();
  });
  $('#top-list').addEventListener('click', onPeekClick);
}

// Top 5 (Matchs et Défis) : un appui ouvre le détail du match sur place, sans quitter le top.
function onPeekClick(e) {
  const lu = e.target.closest('[data-lineup]');
  if (lu) { refreshDeep(lu.dataset.lineup); return; }
  const b = e.target.closest('[data-peek]');
  if (!b) return;
  const k = b.dataset.peek;
  if (ui.peek.has(k)) ui.peek.delete(k); else ui.peek.add(k);
  render();
}

// Démarrage une fois tous les scripts chargés (defis.js est chargé après ce fichier).
document.addEventListener('DOMContentLoaded', () => {
  purgeRemovedLeagues();
  bind();
  bindDefis();
  loadCached();
  setTab(ui.tab);
});
setInterval(liveTick, LIVE_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) liveTick(); });

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
