// ---------- Onglet « Défis freebets » ----------
// On ajoute une capture d'écran d'un défi Winamax / Betclic : l'app lit le texte de l'image
// (Tesseract.js, directement dans le téléphone, rien n'est envoyé à un serveur), en déduit les
// conditions, puis cherche les paris des matchs à venir qui les respectent au plus juste
// (cote la plus proche du minimum, donc la plus probable) et estime si le défi vaut le coup.

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
// Cote estimée : on garde une marge, la cote réelle peut être un peu plus basse.
const EST_MARGIN = 0.03;
// Part moyenne de la valeur d'un freebet réellement récupérée (seul le gain est versé, joué vers 2,5).
const FREEBET_VALUE = 0.65;
const DEFI_KEY = 'pdj-defis';
// Version de la lecture des conditions : les défis lus avant sont relus automatiquement.
const PARSE_V = 2;

// reading : id -> progression de lecture (0 à 1) ; legs : id -> nombre de sélections choisi ;
// todo : id -> matchs affichés dont on peut charger les vraies cotes
const defiUi = { reading: new Map(), legs: new Map(), todo: new Map() };
const loadDefis = () => store.get(DEFI_KEY, []);
const saveDefis = list => store.set(DEFI_KEY, list);

// ---------- Lecture du texte de la capture ----------
let tesseractReady = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  tesseractReady ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.onload = resolve;
    s.onerror = () => { tesseractReady = null; reject(new Error('Lecteur de capture indisponible (connexion internet requise la première fois).')); };
    document.head.append(s);
  });
  return tesseractReady;
}

async function readImage(file, onProgress) {
  await loadTesseract();
  const { data } = await Tesseract.recognize(file, 'fra', {
    logger: l => { if (l.status === 'recognizing text') onProgress(l.progress); },
  });
  return data.text || '';
}

// ---------- Analyse des conditions du défi ----------
const DEC = '(\\d{1,3}(?:[.,]\\d{1,2})?)';
const EURO = '\\s?(?:€|eur(?:os?)?\\b|e\\b)';
const toNum = s => Number(String(s).replace(',', '.'));
// Texte en minuscules, sans accents, en gardant chiffres, virgules, € et symboles utiles.
const flat = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[’‘]/g, "'").replace(/(\d)\s*([.,])\s+(\d)/g, '$1$2$3');

const SPORT_WORDS = [
  ['soccer', /\b(foot(ball)?|ligue \d|ligue des champions|premier league|liga|serie a|bundesliga|ligue europa|conference)\b/],
  ['basketball', /\b(basket(ball)?|nba|euroleague)\b/],
  ['tennis', /\b(tennis|atp|wta)\b/],
  ['rugby', /\b(rugby|top ?14)\b/],
  ['hockey', /\b(hockey|nhl)\b/],
  ['football', /\b(nfl|football americain)\b/],
  ['baseball', /\b(baseball|mlb)\b/],
  ['mma', /\b(mma|ufc)\b/],
];

// Transforme le texte lu en conditions. Tout ce qui n'est pas trouvé garde une valeur prudente.
function parseDefi(raw, leagues = []) {
  const t = flat(raw).replace(/[«»"“”]/g, ' ').replace(/\s+/g, ' ');
  const c = { noLive: false, book: 'both', kind: 'single', minOdd: null, minTotal: null, maxOdd: null, legs: 1, stake: null, freebet: null, when: 'won', sport: 'all', league: null, deadline: null, lottery: false, tickets: false, found: [] };

  const wina = /winamax/.test(t), betc = /betclic/.test(t);
  if (wina !== betc) c.book = wina ? 'winamax' : 'betclic';

  // « 3 sélections », ou l'écriture Betclic « Sél. min. 2 »
  const legsN = Number(t.match(/(?<![:\d])(\d{1,2})\s*(?:selections?|matchs?|paris)\b/)?.[1]
    || t.match(/\bsel(?:ections?)?\.?\s*(?:min(?:imum|i)?\.?)\s*:?\s*(\d{1,2})\b/)?.[1] || 0);
  // « simple ou combiné » = au choix : un pari simple suffit
  const free = /(simple ou combine|combine ou simple|simples? et combines?|simple\/combine)/.test(t);
  if (!free && (/combin/.test(t) || legsN >= 2)) {
    c.kind = 'combo';
    c.legs = Math.max(2, legsN);
  }

  // Cotes : « cote minimum de 1,50 », « cote ≥ 1.50 », « à 1,50 minimum », « @1,50 »
  const odds = [];
  const oddRe = new RegExp(`(cote[s]?(?: totale| globale| du combine| de chaque selection| par selection| par pari| par mise| par ticket| requise| exigee| minimale| minimum| mini| min\\.?| maximale| maximum| max\\.?| d'au moins| superieure? ou egale? a| superieure? a| de| a|\\s|:|>=|≥|@)*)${DEC}`, 'g');
  for (const m of t.matchAll(oddRe)) {
    const v = toNum(m[2]);
    if (v < 1.01 || v > 50) continue;
    const ctx = t.slice(Math.max(0, m.index - 25), m.index + m[0].length + 30);
    odds.push({
      v,
      max: /max/.test(m[1]),
      // Dans un combiné, « cote min. » ou « cote minimale par pari » = cote du combiné entier,
      // sauf si le texte précise « par sélection ».
      total: !/(par selection|chaque selection|par match)/.test(ctx),
    });
  }
  for (const m of t.matchAll(new RegExp(`(?:a|@)\\s?${DEC}\\s?(?:minimum|mini|min\\b)`, 'g'))) {
    const v = toNum(m[1]);
    if (v >= 1.01 && v <= 50) odds.push({ v, max: false, total: false });
  }
  for (const o of odds) {
    if (o.max) c.maxOdd = c.maxOdd ? Math.min(c.maxOdd, o.v) : o.v;
    else if (o.total && c.kind === 'combo') c.minTotal = Math.max(c.minTotal || 0, o.v);
    else c.minOdd = Math.max(c.minOdd || 0, o.v);
  }

  // Montants : mise demandée et freebet gagné
  // (on repère chaque montant par sa position dans le texte pour ne pas compter deux fois le même)
  const amounts = re => [...t.matchAll(re)].map(m => ({ v: toNum(m[1]), at: m.index + m[0].indexOf(m[1]) }));
  const stakeA = [
    ...amounts(new RegExp(`(?:misez|mise|miser|pariez|parier|jouez|jouer|placez|placer|engagez)[^0-9€]{0,40}?${DEC}${EURO}`, 'g')),
    ...amounts(new RegExp(`${DEC}${EURO}\\s?(?:mises?|de mise)\\b`, 'g')),
  ].sort((a, b) => a.at - b.at)[0];
  const fbA = [
    ...amounts(new RegExp(`(?:f?r?ee ?bets?|paris? gratuits?|paris? offerts?|bonus|rembourse(?:ra)?(?: \\w+){0,3})\\s?(?:de|d'une valeur de|:|jusqu'a)?\\s?${DEC}${EURO}`, 'g')),
    ...amounts(new RegExp(`${DEC}${EURO}\\s?(?:de |en |offerts? en )?(?:f?r?ee ?bets?|paris? gratuits?|paris? offerts?|bonus|cash)`, 'g')),
  ].filter(a => a.at !== stakeA?.at).sort((a, b) => a.at - b.at)[0];
  if (stakeA) c.stake = stakeA.v;
  if (fbA) c.freebet = fbA.v;

  // Freebet versé si le pari est gagné, perdu (« remboursé »), ou dans tous les cas
  if (/(perdant|perdu|rembourse|si vous perdez|si tu perds)/.test(t)) c.when = 'lost';
  else if (/(gagnant|gagne|si vous gagnez|si tu gagnes)/.test(t)) c.when = 'won';
  else if (/(quel que soit|peu importe|qu'il soit gagnant ou perdant)/.test(t)) c.when = 'any';
  // Récompense par tirage au sort, tickets gagnés à chaque pari gagné (ex. « Ticket Mania »)
  c.lottery = /tirage au sort/.test(t);
  c.tickets = /tickets?/.test(t) && /(pari gagne|paris gagnes|chaque pari)/.test(t);
  if (c.lottery) c.when = 'won';
  // Défi au classement (« 1€ gagné = 1 point », « Voir le classement ») : pas de freebet par pari
  c.ranking = !c.lottery && /(classement|gagnes? ?= ?\d+ ?points?)/.test(t);
  c.liveX2 = c.ranking && /live[^.=]{0,20}= ?2 ?points?/.test(t);
  if (c.ranking) c.freebet = null;
  // Paris en direct exclus ?
  c.noLive = /(hors live|hors direct|avant-match uniquement|pre-?match uniquement|paris? en direct (?:ne sont pas|exclus|non)|live exclus|hors paris? en direct)/.test(t);

  // Date limite : « … au jeudi 5 novembre 2026 à 01:00 »
  const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
  const dates = [...t.matchAll(new RegExp(`(\\d{1,2})(?:er)? (${MONTHS.join('|')})(?: (\\d{4}))?(?: a| des)? (\\d{1,2})[:h](\\d{2})`, 'g'))]
    .map(m => new Date(Number(m[3] || new Date().getFullYear()), MONTHS.indexOf(m[2]), Number(m[1]), Number(m[4]), Number(m[5])))
    .filter(d => !Number.isNaN(+d));
  // … ou en chiffres : « au 09/11/2026 à 07:00 », « (09/11 - 07h00) »
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s?(?:a|-|,)?\s?(\d{1,2})[:h](\d{2})\b/g)) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : new Date().getFullYear();
    const d = new Date(y, Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]));
    if (!Number.isNaN(+d) && Number(m[2]) <= 12) dates.push(d);
  }
  if (dates.length) c.deadline = Math.max(...dates.map(Number));

  for (const [sport, re] of SPORT_WORDS) if (re.test(t)) { c.sport = sport; break; }
  const lg = leagues.map(l => [l, flat(l)]).filter(([, n]) => n.length > 5).sort((a, b) => b[1].length - a[1].length)
    .find(([, n]) => t.includes(n));
  if (lg) c.league = lg[0];

  if (c.minOdd) c.found.push('cote');
  if (c.minTotal) c.found.push('cote totale');
  if (c.stake) c.found.push('mise');
  if (c.freebet) c.found.push('freebet');
  if (c.kind === 'combo') c.found.push('combiné');
  return c;
}

function conditionsText(c) {
  const parts = [c.book === 'both' ? 'Betclic ou Winamax' : bookName(c.book)];
  parts.push(c.kind === 'combo' ? `combiné ${c.legs} sélections min.` : 'pari simple');
  if (c.minOdd) parts.push(`cote ≥ ${odd(c.minOdd)}${c.kind === 'combo' ? ' par sélection' : ''}`);
  if (c.minTotal) parts.push(`cote totale ≥ ${odd(c.minTotal)}`);
  if (c.maxOdd) parts.push(`cote ≤ ${odd(c.maxOdd)}`);
  if (c.deadline) parts.push(`matchs finis avant le ${new Date(c.deadline).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`);
  if (c.noLive) parts.push('avant-match uniquement');
  if (c.league) parts.push(c.league);
  else if (c.sport !== 'all') parts.push(Engine.SPORT_CFG[c.sport]?.label || c.sport);
  if (c.stake) parts.push(`mise ${num2(c.stake)} €`);
  if (c.ranking) parts.push(`au classement : 1 € gagné = 1 point${c.liveX2 ? ', 2 en live' : ''}`);
  else if (c.lottery) parts.push(c.tickets ? '1 ticket par pari gagné, freebets par tirage au sort' : 'freebets par tirage au sort');
  else if (c.freebet) parts.push(`freebet ${num2(c.freebet)} € ${c.when === 'lost' ? 'si perdu' : c.when === 'any' ? 'dans tous les cas' : 'si gagné'}`);
  return parts.join(' · ');
}
const num2 = x => String(x).replace('.', ',');

// ---------- Recherche des paris ----------
// Matchs disponibles : aujourd'hui et demain, si la journée a été mise à jour.
function defiMatches() {
  const out = [];
  for (const off of [0, 1]) {
    const d = new Date();
    d.setDate(d.getDate() + off);
    const live = ui.data?.day === dayKey(d) ? ui.data.matches : null;
    const c = live ? null : store.get(cacheKey(d), null);
    out.push(...(live || (c ? c.matches.filter(m => SRC_BY_PATH.has(m.src?.path)).map(withAnalysis) : [])));
  }
  const soon = Date.now() + 2 * 60e3;
  const seen = new Set();
  const today = ui.data?.day === dayKey(new Date()) ? new Set(ui.data.matches.map(m => m.id)) : new Set();
  // (oddsChecked sans cotes : match que Betclic et Winamax ne proposent pas)
  return out.filter(m => !m.canceled && !(m.oddsChecked && !m.books) && !seen.has(m.id) && seen.add(m.id)).map(m => {
    if (m.state === 'pre' && new Date(m.date) > soon) return m;
    // En cours : seulement si les scores sont tenus à jour (journée d'aujourd'hui affichée)
    if (m.state === 'in' && today.has(m.id)) {
      const liveA = Engine.live(m);
      // Fin de match : trop tard pour parier (marchés fermés ou cotes sans intérêt)
      return liveA && !(liveA.share > 0.93) ? { ...m, liveA } : null;
    }
    return null;
  }).filter(Boolean);
}

const BOOK_KEYS = ['betclic', 'winamax'];

// Cote du pari chez le bookmaker choisi (« both » : la meilleure des deux).
// Si les vraies cotes du match sont chargées, seules les vraies cotes comptent : un pari que l'API
// ne cote pas (les deux marquent, double chance, remboursé si nul…) est alors écarté.
function bookOdd(b, book, m) {
  const keys = book === 'both' ? BOOK_KEYS : [book];
  const odds = keys.map(k => b.odds[k] && { ...b.odds[k], book: k })
    .filter(o => o && (!m.books || o.real))
    .sort((x, y) => y.v - x.v);
  return odds[0] || null;
}

// Tous les paris d'un match qui respectent les conditions, du plus probable au moins probable.
// eff : cote retenue pour les calculs (une cote estimée est comptée 3 % plus bas, par sécurité).
function eligibleBets(m, c) {
  const min = c.minOdd || 1.01;
  const max = c.maxOdd || Infinity;
  return (m.liveA || m.analysis).bets
    .map(b => ({ m, b, o: bookOdd(b, c.book, m) }))
    .filter(x => x.o && x.o.v >= min + (x.o.real ? 0 : EST_MARGIN) && x.o.v <= max)
    .map(x => ({ ...x, eff: x.o.real ? x.o.v : x.o.v / (1 + EST_MARGIN) }))
    .sort((x, y) => y.b.p - x.b.p || x.o.v - y.o.v);
}

// Combinés optimisés : pour chaque nombre de sélections (du minimum du défi à 5), la combinaison
// la plus probable dont la cote totale atteint minTotal, un seul pari par match.
// Programmation dynamique sur la cote (en log, arrondie vers le bas : la cote réelle est toujours ≥).
const MAX_LEGS = 5;
function bestCombos(options, minLegs, minTotal) {
  const pool = options.slice(0, 40).map(opts => opts.slice(0, 15));
  const maxL = Math.max(minLegs, MAX_LEGS);
  const STEP = 0.004;
  const T = minTotal ? Math.ceil(Math.log(minTotal) / STEP - 1e-9) : 0;
  let best = Array.from({ length: maxL + 1 }, () => new Array(T + 1).fill(null));
  best[0][0] = { lp: 0, sel: null };
  for (const opts of pool) {
    const next = best.map(r => r.slice());
    for (let k = 0; k < maxL; k++) {
      for (let b = 0; b <= T; b++) {
        const cur = best[k][b];
        if (!cur) continue;
        for (const x of opts) {
          const nb = Math.min(T, b + Math.floor(Math.log(x.eff) / STEP + 1e-9));
          const lp = cur.lp + Math.log(x.b.p);
          const t = next[k + 1][nb];
          if (!t || lp > t.lp) next[k + 1][nb] = { lp, sel: { x, prev: cur.sel } };
        }
      }
    }
    best = next;
  }
  const out = [];
  for (let k = minLegs; k <= maxL; k++) {
    const r = best[k][T];
    if (!r) continue;
    const sel = [];
    for (let s = r.sel; s; s = s.prev) sel.push(s.x);
    sel.sort((a, b) => new Date(a.m.date) - new Date(b.m.date));
    out.push({ k, sel, p: Math.exp(r.lp), o: sel.reduce((s, x) => s * x.o.v, 1), real: sel.every(x => x.o.real) });
  }
  return out;
}

// Le défi vaut-il le coup ? Perte moyenne due à la marge + valeur moyenne du freebet.
function defiValue(c, p, o) {
  if (!c.stake || !c.freebet) return null;
  const evStake = c.stake * (p * o - 1);
  const chance = c.when === 'lost' ? 1 - p : c.when === 'any' ? 1 : p;
  const evFb = c.freebet * FREEBET_VALUE * chance;
  return { evStake, evFb, chance, total: evStake + evFb };
}

// ---------- Affichage ----------
const eur = x => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2).replace('.', ',')} €`;
const bookName = k => Engine.BOOKS[k] || k;
const dayLabel = iso => (dayKey(new Date(iso)) === dayKey(new Date()) ? '' : 'Demain ');

function defiOddTag(o) {
  return `<span class="bk ${o.real ? 'real' : 'est'}">${o.real ? '' : '≈ '}${odd(o.v)} <small>${bookName(o.book)}</small></span>`;
}

// Score court pour un match en cours : « 1-0 » ou, au tennis, les jeux des sets « 6-4 2-3 »
function liveScore(m) {
  if (m.sport === 'tennis') return (m.home.games || []).map((g, i) => `${g.v ?? 0}-${m.away.games?.[i]?.v ?? 0}`).join(' ');
  return `${m.home.score ?? 0}-${m.away.score ?? 0}`;
}

function defiRow(x, i, did) {
  const { m, b, o } = x;
  const why = [];
  if (m.liveA) why.push('cote live estimée d’après le score');
  else {
    if (m.lineup?.status === 'official') why.push('compos officielles prises en compte');
    else if (m.lineup?.status === 'probable') why.push('compo probable prise en compte');
    if (m.books) why.push('vraie cote');
    why.push(`fiabilité ${m.analysis.reliability}/3`);
  }
  const key = `${did}:${m.id}`;
  const open = ui.peek.has(key);
  const when = m.liveA
    ? `<span class="live-dot">En direct</span> · ${esc(liveScore(m))}${m.sport !== 'tennis' && m.detail ? ` (${esc(m.detail)})` : ''}`
    : `${dayLabel(m.date)}${timeOf(m.date)}`;
  const inToday = ui.data?.day === dayKey(new Date(m.date)) && ui.data.matches.some(x => x.id === m.id);
  return `<li class="peek${open ? ' open' : ''}"><button class="ticket" data-peek="${esc(key)}" aria-expanded="${open}">
    <span class="t-rank">${i + 1}</span>
    <span class="t-body">
      <span class="t-match">${esc(m.home.short)} – ${esc(m.away.short)}</span>
      <span class="t-meta">${when} · ${esc(Engine.SPORT_CFG[m.sport].label)} · ${esc(m.league)}</span>
      <span class="t-bet">${esc(b.label)}</span>
      <span class="t-meta">${esc(why.join(' · '))}</span>
      <span class="t-more">${open ? 'Masquer le détail' : 'Voir le détail et les stats'}</span>
    </span>
    <span class="t-num"><b>${pct(b.p)}</b>${defiOddTag(o)}</span>
  </button>${open ? `<div class="peek-body">${peekHead(m)}${matchDetails(m, { a: m.liveA || m.analysis, deep: inToday, hl: b })}</div>` : ''}</li>`;
}

function valueBlock(c, p, o, live = false) {
  if (c.ranking) {
    const s = c.stake || 2;
    const pts = s * o * (live && c.liveX2 ? 2 : 1);
    return `<div class="defi-value">
      <p class="defi-verdict">Défi au classement : pas de freebet garanti</p>
      <p>Chaque € gagné rapporte 1 point${c.liveX2 ? ' (2 points sur un combiné en live)' : ''}, et seuls les mieux classés reçoivent des freebets. Avec ce combiné à ${num2(s)} € : environ <b>${Math.round(pts)} points</b> s’il passe (${pct(p)} de chances). Résultat moyen de la mise selon l’estimation : ${eur(s * (p * o - 1))}.</p>
      <p class="hint">Grimper beaucoup de places demande de gros gains, donc de grosses mises ou de grosses cotes, perdantes en moyenne. Ne misez pas plus que prévu pour monter au classement.</p>
    </div>`;
  }
  if (c.lottery) {
    return `<div class="defi-value">
      <p class="defi-verdict">Récompense par tirage au sort</p>
      <p>Impossible de chiffrer la valeur du défi : les freebets sont tirés au sort.${c.tickets ? ` Chaque pari gagné donne un ticket : le plus malin est de jouer <b>la mise minimum${c.stake ? ` (${num2(c.stake)} €)` : ''}</b> sur les paris les plus sûrs ci-dessus, un pari par match, pour gagner un maximum de tickets en perdant le moins possible.` : ''}</p>
      ${c.stake ? `<p class="hint">Coût moyen d’un pari à ${num2(c.stake)} € sur le n° 1 : ${eur(c.stake * (p * o - 1))} (marge du bookmaker), pour ${pct(p)} de chances de gagner un ticket.</p>` : ''}
    </div>`;
  }
  const v = defiValue(c, p, o);
  if (!v) return '';
  const ok = v.total > 0;
  const cond = c.when === 'lost' ? `seulement si le pari est perdu, ${pct(v.chance)}` : c.when === 'won' ? `seulement si le pari passe, ${pct(v.chance)}` : 'dans tous les cas';
  return `<div class="defi-value ${ok ? 'ok' : 'ko'}">
    <p class="defi-verdict">${ok ? 'Le défi vaut le coup' : 'Le défi ne vaut pas le coup'} : ${eur(v.total)} en moyenne</p>
    <ul>
      <li>Pari imposé (marge du bookmaker) : <b>${eur(v.evStake)}</b> en moyenne sur ${num2(c.stake)} €</li>
      <li>Freebet de ${num2(c.freebet)} € : vaut environ <b>${eur(v.evFb)}</b> (${cond})</li>
    </ul>
    <p class="hint">Un freebet ne rend que le gain, pas la mise : joué sur une cote d’environ 2,5, il rapporte en moyenne 65 % de sa valeur.</p>
  </div>`;
}

function defiResults(c, did) {
  const DUR = { soccer: 2, tennis: 3, basketball: 2.5, football: 3.5, baseball: 3.5, hockey: 2.75, rugby: 2, mma: 1, afl: 3 };
  const ends = m => (m.liveA ? Date.now() + (DUR[m.sport] || 3) * (1 - (m.liveA.share ?? 0.5)) * 36e5
    : new Date(m.date).getTime() + (DUR[m.sport] || 3) * 36e5);
  const all = defiMatches().filter(m => (c.sport === 'all' || m.sport === c.sport) && (!c.league || m.league === c.league)
    && !(c.noLive && m.liveA) && (!c.deadline || ends(m) <= c.deadline));
  const row = (x, i) => defiRow(x, i, did);
  const liveNote = shown => shown.some(x => x.m.liveA) ? '<p class="hint">Matchs en direct : probabilités et cotes estimées d’après le score, sans crédit. Les cotes live changent vite et certains défis excluent le direct : vérifiez dans l’appli.</p>' : '';
  if (!all.length) {
    return `<p class="defi-empty">Aucun match à venir ou en cours${c.league ? ` en ${esc(c.league)}` : ''} chargé. Appuyez sur <b>Mettre à jour</b> (gratuit) pour aujourd’hui et pour demain.</p>`;
  }
  const options = all.map(m => eligibleBets(m, c)).filter(o => o.length).sort((a, b) => b[0].b.p - a[0].b.p);
  const estNote = shown => shown.every(x => x.o.real) ? '' : `<p class="hint">Cote${shown.length > 1 ? 's' : ''} marquée${shown.length > 1 ? 's' : ''} ≈ : estimée${shown.length > 1 ? 's' : ''}, comptée${shown.length > 1 ? 's' : ''} 3 % plus bas par sécurité. Chargez les vraies cotes ou vérifiez dans l’appli avant de jouer.</p>`;
  if (!options.length) return `<p class="defi-empty">Aucun pari des ${all.length} matchs à venir ou en cours ne respecte ces cotes.</p>`;
  if (c.kind !== 'combo') {
    const top = options.slice(0, 5).map(o => o[0]);
    return `<p class="defi-sub">Top ${top.length} des paris qui remplissent la condition au plus juste</p>
      <ol class="tickets">${top.map(row).join('')}</ol>${oddsAction(top, did)}${estNote(top)}${liveNote(top)}${valueBlock(c, top[0].b.p, top[0].o.v)}`;
  }
  const mixed = bestCombos(options, c.legs, c.minTotal);
  if (!mixed.length) return `<p class="defi-empty">Pas assez de matchs compatibles (${options.length}) pour un combiné de ${c.legs} à ${Math.max(c.legs, MAX_LEGS)} sélections${c.minTotal ? ` à ${odd(c.minTotal)}` : ''}.</p>`;
  const topOf = list => list.reduce((a, b) => (b.p > a.p + 1e-9 ? b : a));
  // Dès que des vraies cotes sont chargées : combiné 100 % vraies cotes en priorité. On signale
  // seulement s'il existe un combiné nettement plus sûr avec des matchs aux cotes encore estimées.
  const realOpts = options.map(o => o.filter(x => x.o.real)).filter(o => o.length);
  const realCombos = realOpts.length >= c.legs ? bestCombos(realOpts, c.legs, c.minTotal) : [];
  const combos = realCombos.length ? realCombos : mixed;
  const top = topOf(combos);
  const better = realCombos.length && topOf(mixed).p > top.p + 0.02 && !topOf(mixed).real ? topOf(mixed) : null;
  const best = combos.find(x => x.k === defiUi.legs.get(did)) || top;
  const spare = options.filter(o => !best.sel.some(x => x.m.id === o[0].m.id)).slice(0, 3).map(o => o[0]);
  const choices = combos.length > 1 ? `<div class="legs-pick" role="group" aria-label="Nombre de sélections">${combos.map(x => `<button type="button" data-legs="${esc(did)}:${x.k}" aria-pressed="${x === best}">
      <b>${x.k} sél.</b><span>${pct(x.p)}</span><small>cote ${x.real ? '' : '≈ '}${odd(x.o)}</small>${x === top ? '<em>le + sûr</em>' : ''}</button>`).join('')}</div>` : '';
  return `<div class="combo"><div class="combo-head"><span>Combiné ${best === top ? 'optimisé' : 'choisi'} · ${best.sel.length} sélections</span><span class="combo-num">${pct(best.p)} · cote ${best.real ? '' : '≈ '}${odd(best.o)}</span></div>
      <p class="hint">La combinaison la plus probable qui atteint ${c.minTotal ? `la cote de ${odd(c.minTotal)}` : 'la condition'}, comparée de ${c.legs} à ${Math.max(c.legs, MAX_LEGS)} sélections. ${best.sel.some(x => x.m.liveA) ? 'Contient des matchs en cours : à placer tout de suite.' : 'À placer avant le premier match.'}</p>${choices}</div>
    <ol class="tickets">${best.sel.map(row).join('')}</ol>
    ${better ? `<p class="hint">Peut-être plus sûr : un combiné à ${pct(better.p)} avec des matchs dont les cotes ne sont pas encore chargées (${better.sel.filter(x => !x.o.real).map(x => esc(`${x.m.home.short} – ${x.m.away.short}`)).join(', ')}).</p>${oddsAction(better.sel, did)}` : oddsAction([...best.sel, ...spare], did)}
    ${spare.length ? `<p class="defi-sub">Remplaçants si une cote a bougé</p><ol class="tickets">${spare.map(row).join('')}</ol>` : ''}
    ${estNote(best.sel)}${liveNote([...best.sel, ...spare])}${valueBlock(c, best.p, best.o, best.sel.some(x => x.m.liveA))}`;
}

// ---------- Vraies cotes des paris proposés ----------
// Coût The Odds API d'une compétition (comme pour le bouton « Charger les vraies cotes »).
function oddsGroupCost(m) {
  const s = SRC_BY_PATH.get(m.src?.path);
  if (!s || !(s.odds || s.oddsTitle || s.sport === 'tennis')) return 0;
  return s.sport === 'soccer' ? 2 : s.sport === 'tennis' || s.sport === 'mma' ? 1 : 3;
}
const oddsGroup = m => `${m.src.path}|${m.tournament || ''}`;

// Paris affichés dont la vraie cote peut encore être chargée, regroupés par compétition.
function oddsTodo(shown) {
  const groups = new Map();
  for (const { m, o } of shown) {
    if (o.real || m.liveA || m.state !== 'pre' || m.oddsChecked || !oddsGroupCost(m)) continue;
    groups.set(oddsGroup(m), oddsGroupCost(m));
  }
  return { groups, cost: [...groups.values()].reduce((a, b) => a + b, 0) };
}

function oddsAction(shown, did) {
  const { groups, cost } = oddsTodo(shown);
  const left = shown.filter(x => !x.o.real).length;
  if (!cost) {
    return left && shown.some(x => !x.o.real && (x.m.liveA || !oddsGroupCost(x.m)))
      ? '<p class="hint">Certaines cotes ne peuvent pas être chargées (match en cours ou compétition non couverte par The Odds API) : vérifiez-les dans l’appli.</p>' : '';
  }
  defiUi.todo.set(did, shown.map(x => x.m.id));
  return `<button type="button" class="odds-btn defi-odds" data-odds-for="${esc(did)}">Charger les vraies cotes de ces paris · ${cost} crédit${cost > 1 ? 's' : ''} (${groups.size} compétition${groups.size > 1 ? 's' : ''})</button>
    <p class="hint">Avec les vraies cotes, l’app recalcule le combiné uniquement avec des paris cotés par Betclic et Winamax (1N2, plus/moins de buts ou de points, handicap) : « les deux marquent », double chance ou remboursé si nul ne sont pas fournis par The Odds API.</p>`;
}

// Charge les vraies cotes des compétitions des paris proposés, puis recalcule.
async function loadDefiOdds(did, btn) {
  if (!settings().key) { toast('Ajoutez d’abord une clé The Odds API (bouton réglages).'); $('#open-settings').click(); return; }
  const ids = new Set(defiUi.todo.get(did) || []);
  const shown = defiMatches().filter(m => ids.has(m.id));
  const costs = new Map(shown.filter(m => m.state === 'pre' && !m.oddsChecked && oddsGroupCost(m)).map(m => [oddsGroup(m), oddsGroupCost(m)]));
  const groups = new Set(costs.keys());
  const cost = [...costs.values()].reduce((a, b) => a + b, 0);
  if (!cost) return;
  if (!(await confirmCredits(cost))) return;
  setBusy(btn, true);
  let credits = null;
  try {
    for (const off of [0, 1]) {
      const day = new Date();
      day.setDate(day.getDate() + off);
      const inUi = ui.data?.day === dayKey(day);
      const cached = inUi ? null : store.get(cacheKey(day), null);
      const list = inUi ? ui.data.matches : cached?.matches;
      const todo = (list || []).filter(m => m.state === 'pre' && !m.canceled && groups.has(oddsGroup(m)));
      if (!todo.length) continue;
      const res = await fetchBooks(todo, day, t => { btn.textContent = t; });
      credits = res?.credits || credits;
      if (inUi) { ui.data.matches = ui.data.matches.map(m => withAnalysis(strip(m))); saveDay(); }
      else store.set(cacheKey(day), cached);
    }
    toast(`Vraies cotes chargées${credits ? ` · ${credits.remaining} crédits restants` : ''}`);
  } catch (e) {
    toast(e.message || 'Impossible de charger les cotes.');
  } finally {
    render();
    renderDefis();
  }
}

const thumbsOf = d => d.thumbs || (d.thumb ? [d.thumb] : []);

function defiCard(d) {
  const reading = defiUi.reading.get(d.id);
  const thumbs = thumbsOf(d);
  // Bookmaker choisi à la main (la capture ne dit pas toujours si c'est Betclic ou Winamax)
  const c = d.book ? { ...d.c, book: d.book } : d.c;
  const head = `<div class="defi-head">
      <div class="defi-thumbs">${thumbs.map(t => `<img src="${t}" alt="" class="defi-thumb">`).join('')}
        ${reading == null && thumbs.length < MAX_SHOTS ? `<button type="button" class="defi-more" data-add-to="${esc(d.id)}" aria-label="Ajouter une 2e capture à ce défi">+<small>2e capture</small></button>` : ''}</div>
      <div class="defi-cond">${reading != null
        ? `<b>Lecture de la capture… ${Math.round(reading * 100)} %</b>`
        : d.error ? `<b class="warn">${esc(d.error)}</b>`
        : `<b>${esc(d.title || 'Défi')}</b><span>${esc(conditionsText(c))}</span>`}</div>
      <button type="button" class="icon-btn defi-del" data-del-defi="${esc(d.id)}" aria-label="Supprimer ce défi">✕</button>
    </div>`;
  if (reading != null || d.error) return `<article class="defi-card">${head}</article>`;
  const unsure = !d.c.minOdd && !d.c.minTotal
    ? `<p class="hint warn">Aucune cote minimum trouvée sur la capture : l’app propose les paris les plus sûrs. Si le défi impose une cote, ${thumbs.length < MAX_SHOTS ? 'ajoutez une 2e capture avec la suite des conditions (bouton +) ou ' : ''}refaites une capture plus nette du texte des conditions.</p>` : '';
  const books = d.c.book === 'both' || d.book
    ? `<div class="seg defi-book" role="group" aria-label="Bookmaker du défi"><span>Défi</span>${[['betclic', 'Betclic'], ['winamax', 'Winamax'], ['both', 'Les deux']]
      .map(([k, l]) => `<button type="button" data-book="${esc(d.id)}:${k}" aria-pressed="${c.book === k}">${l}</button>`).join('')}</div>` : '';
  return `<article class="defi-card">${head}${books}${unsure}${defiResults(c, d.id)}</article>`;
}

function renderDefis() {
  if (ui.tab !== 'defis') return;
  let list = loadDefis();
  // Défis lus avec une ancienne version : on relit leur texte avec la lecture à jour
  if (list.some(d => d.text && d.pv !== PARSE_V && !defiUi.reading.has(d.id))) {
    const leagues = [...new Set(defiMatches().map(m => m.league))];
    list = list.map(d => (d.text && d.pv !== PARSE_V && !defiUi.reading.has(d.id) ? { ...d, c: parseDefi(d.text, leagues), pv: PARSE_V } : d));
    saveDefis(list);
  }
  $('#defi-list').innerHTML = list.length
    ? list.map(defiCard).join('')
    : '<p class="defi-empty">Aucun défi pour l’instant. Ajoutez une capture d’écran d’un défi Winamax ou Betclic : l’app lit les conditions toute seule.</p>';
}

// Petite miniature (gardée sur le téléphone, jamais envoyée)
function thumbnail(file) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const s = 96 / Math.max(img.width, img.height);
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(img.src);
      resolve(cv.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => resolve('');
    img.src = URL.createObjectURL(file);
  });
}

// Titre du défi : son nom s'il apparaît (« Ticket Mania », « Défi … »), sinon la première vraie phrase
// (on saute la barre d'état du téléphone et les intitulés génériques).
function titleOf(text) {
  const named = text.match(/\b(?:fin du|fin de la)\s+([A-ZÀ-Ý][\wÀ-ÿ'’]+(?:\s+[A-ZÀ-Ý][\wÀ-ÿ'’]+){0,3})/)
    || text.match(/\b((?:D[ée]fi|Challenge|Mission)\b[^\n]{0,40})/i);
  if (named) return named[1].trim().slice(0, 60);
  const generic = /^(comment jouer|r[èe]gles|date|r[ée]compense|conditions)\b/i;
  const line = text.split('\n').map(l => l.trim())
    .find(l => (l.match(/[a-zà-ÿ]{4,}/gi) || []).length >= 2 && !generic.test(l) && !/^\d{1,2}[:h]\d{2}/.test(l));
  return line ? line.slice(0, 60) : 'Défi';
}

// Un défi = 1 ou 2 captures (quand les conditions ne tiennent pas sur un seul écran).
// Sans toId : nouveau défi avec les 2 premières images. Avec toId : 2e capture d'un défi existant.
const MAX_SHOTS = 2;
async function addCaptures(files, toId = null) {
  let imgs = [...files].filter(f => f && f.type.startsWith('image/'));
  if (!imgs.length) return;
  const old = toId ? loadDefis().find(x => x.id === toId) : null;
  const room = MAX_SHOTS - (old ? thumbsOf(old).length : 0);
  if (room <= 0) { toast(`${MAX_SHOTS} captures maximum par défi`); return; }
  if (imgs.length > room) { toast(`${MAX_SHOTS} captures maximum par défi : ${room === 1 ? 'seule la première est utilisée' : `seules les ${room} premières sont utilisées`}`); imgs = imgs.slice(0, room); }
  const id = old?.id || `d${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const thumbs = [...(old ? thumbsOf(old) : []), ...await Promise.all(imgs.map(thumbnail))];
  const d = { ...(old || { c: parseDefi(''), at: Date.now() }), id, thumbs };
  delete d.thumb;
  delete d.error;
  saveDefis(old ? loadDefis().map(x => (x.id === id ? d : x)) : [d, ...loadDefis()]);
  defiUi.reading.set(id, 0);
  renderDefis();
  try {
    const texts = [...(old?.texts || (old?.text ? [old.text] : []))];
    for (const [k, file] of imgs.entries()) {
      texts.push((await readImage(file, p => { defiUi.reading.set(id, (k + p) / imgs.length); renderDefis(); })).slice(0, 2000));
    }
    const text = texts.join('\n');
    const leagues = [...new Set(defiMatches().map(m => m.league))];
    Object.assign(d, { texts, text, title: titleOf(text), c: parseDefi(text, leagues), pv: PARSE_V });
  } catch (e) {
    d.error = e.message || 'Impossible de lire cette capture.';
  }
  defiUi.reading.delete(id);
  saveDefis(loadDefis().map(x => (x.id === id ? d : x)));
  renderDefis();
}

function bindDefis() {
  const input = $('#defi-file');
  $('#defi-add').addEventListener('click', () => { defiUi.target = null; input.click(); });
  input.addEventListener('change', () => { addCaptures(input.files, defiUi.target); defiUi.target = null; input.value = ''; });
  // Ordinateur : coller une capture (Ctrl+V) quand l'onglet Défis est ouvert
  document.addEventListener('paste', e => {
    if (ui.tab !== 'defis') return;
    const files = [...(e.clipboardData?.items || [])].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile());
    if (files.length) addCaptures(files);
  });
  $('#defi-list').addEventListener('click', e => {
    const del = e.target.closest('[data-del-defi]');
    if (del) { saveDefis(loadDefis().filter(d => d.id !== del.dataset.delDefi)); renderDefis(); return; }
    const more = e.target.closest('[data-add-to]');
    if (more) { defiUi.target = more.dataset.addTo; input.click(); return; }
    const legs = e.target.closest('[data-legs]');
    if (legs) {
      const [id, k] = legs.dataset.legs.split(':');
      defiUi.legs.set(id, Number(k));
      renderDefis();
      return;
    }
    const bk = e.target.closest('[data-book]');
    if (bk) {
      const [id, book] = bk.dataset.book.split(':');
      saveDefis(loadDefis().map(x => (x.id === id ? { ...x, book } : x)));
      renderDefis();
      return;
    }
    const oddsBtn = e.target.closest('[data-odds-for]');
    if (oddsBtn) { if (!oddsBtn.disabled) loadDefiOdds(oddsBtn.dataset.oddsFor, oddsBtn); return; }
    onPeekClick(e); // détail du match ouvert sur place
  });
}
