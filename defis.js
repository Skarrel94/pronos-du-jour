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

const defiUi = { reading: new Map() }; // id -> progression de lecture (0 à 1)
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
  const c = { book: 'both', kind: 'single', minOdd: null, minTotal: null, maxOdd: null, legs: 1, stake: null, freebet: null, when: 'won', sport: 'all', league: null, deadline: null, lottery: false, tickets: false, found: [] };

  const wina = /winamax/.test(t), betc = /betclic/.test(t);
  if (wina !== betc) c.book = wina ? 'winamax' : 'betclic';

  const legsM = t.match(/(?<![:\d])(\d{1,2})\s*(?:selections?|matchs?|paris)\b/);
  // « simple ou combiné » = au choix : un pari simple suffit
  const free = /(simple ou combine|combine ou simple|simples? et combines?|simple\/combine)/.test(t);
  if (!free && (/combin/.test(t) || (legsM && Number(legsM[1]) >= 2))) {
    c.kind = 'combo';
    c.legs = legsM ? Math.max(2, Number(legsM[1])) : 2;
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
      total: /(totale|globale|du combine)/.test(ctx) && !/(par selection|chaque selection)/.test(ctx),
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

  // Date limite : « … au jeudi 5 novembre 2026 à 01:00 »
  const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
  const dates = [...t.matchAll(new RegExp(`(\\d{1,2})(?:er)? (${MONTHS.join('|')})(?: (\\d{4}))?(?: a| des)? (\\d{1,2})[:h](\\d{2})`, 'g'))]
    .map(m => new Date(Number(m[3] || new Date().getFullYear()), MONTHS.indexOf(m[2]), Number(m[1]), Number(m[4]), Number(m[5])))
    .filter(d => !Number.isNaN(+d));
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
  if (c.league) parts.push(c.league);
  else if (c.sport !== 'all') parts.push(Engine.SPORT_CFG[c.sport]?.label || c.sport);
  if (c.stake) parts.push(`mise ${num2(c.stake)} €`);
  if (c.lottery) parts.push(c.tickets ? '1 ticket par pari gagné, freebets par tirage au sort' : 'freebets par tirage au sort');
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
  return out.filter(m => m.state === 'pre' && !m.canceled && new Date(m.date) > soon && !seen.has(m.id) && seen.add(m.id));
}

// Cote du pari chez le bookmaker choisi (« both » : la meilleure des deux).
function bookOdd(b, book) {
  if (book === 'both') return { ...b.bestOdd, book: b.bestBook };
  const o = b.odds[book];
  return o ? { ...o, book } : null;
}

// Tous les paris d'un match qui respectent les conditions, du plus probable au moins probable.
function eligibleBets(m, c) {
  const min = c.minOdd || 1.01;
  const max = c.maxOdd || Infinity;
  return m.analysis.bets
    .map(b => ({ m, b, o: bookOdd(b, c.book) }))
    .filter(x => x.o && x.o.v >= min + (x.o.real ? 0 : EST_MARGIN) && x.o.v <= max)
    .sort((x, y) => y.b.p - x.b.p || x.o.v - y.o.v);
}

// Combiné : au moins `legs` matchs différents, cote totale >= minTotal, probabilité maximale.
function bestCombo(options, legs, minTotal) {
  const pool = options.slice(0, 40); // [[pari le plus probable du match, ...autres], ...]
  if (pool.length < legs) return null;
  const lp = x => Math.log(x.b.p), lo = x => Math.log(x.o.v);
  const target = Math.log(minTotal || 1);
  let best = null;
  for (let k = legs; k <= Math.min(pool.length, legs + 6); k++) {
    const pick = new Map(pool.slice(0, k).map((opts, i) => [i, opts[0]]));
    let logO = [...pick.values()].reduce((s, x) => s + lo(x), 0);
    for (let guard = 0; logO < target - 1e-9 && guard < 60; guard++) {
      // Meilleur échange : le plus de cote gagnée pour le moins de probabilité perdue
      let move = null;
      for (const [i, cur] of pick) {
        const tryIt = (key, nx) => {
          const dO = lo(nx) - lo(cur);
          if (dO <= 1e-9) return;
          const eff = Math.max(0, lp(cur) - lp(nx)) / dO;
          if (!move || eff < move.eff) move = { eff, from: i, to: key, nx, dO };
        };
        pool[i].forEach(nx => tryIt(i, nx));
        pool.forEach((opts, j) => { if (!pick.has(j)) opts.forEach(nx => tryIt(j, nx)); });
      }
      if (!move) break;
      pick.delete(move.from);
      pick.set(move.to, move.nx);
      logO += move.dO;
    }
    if (logO < target - 1e-9) continue;
    const sel = [...pick.values()].sort((a, b) => new Date(a.m.date) - new Date(b.m.date));
    const p = sel.reduce((s, x) => s * x.b.p, 1);
    if (!best || p > best.p) best = { sel, p, o: Math.exp(logO), real: sel.every(x => x.o.real) };
  }
  return best;
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

function defiRow(x, i) {
  const { m, b, o } = x;
  const why = [];
  if (m.lineup?.status === 'official') why.push('compos officielles prises en compte');
  else if (m.lineup?.status === 'probable') why.push('compo probable prise en compte');
  if (m.books) why.push('vraie cote');
  why.push(`fiabilité ${m.analysis.reliability}/3`);
  return `<li><button class="ticket" data-goto-match="${esc(m.id)}" data-day-of="${esc(dayKey(new Date(m.date)))}">
    <span class="t-rank">${i + 1}</span>
    <span class="t-body">
      <span class="t-match">${esc(m.home.short)} – ${esc(m.away.short)}</span>
      <span class="t-meta">${dayLabel(m.date)}${timeOf(m.date)} · ${esc(Engine.SPORT_CFG[m.sport].label)} · ${esc(m.league)}</span>
      <span class="t-bet">${esc(b.label)}</span>
      <span class="t-meta">${esc(why.join(' · '))}</span>
    </span>
    <span class="t-num"><b>${pct(b.p)}</b>${defiOddTag(o)}</span>
  </button></li>`;
}

function valueBlock(c, p, o) {
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

function defiResults(c) {
  const DUR = { soccer: 2, tennis: 3, basketball: 2.5, football: 3.5, baseball: 3.5, hockey: 2.75, rugby: 2, mma: 1, afl: 3 };
  const all = defiMatches().filter(m => (c.sport === 'all' || m.sport === c.sport) && (!c.league || m.league === c.league)
    && (!c.deadline || new Date(m.date).getTime() + (DUR[m.sport] || 3) * 36e5 <= c.deadline));
  if (!all.length) {
    return `<p class="defi-empty">Aucun match à venir${c.league ? ` en ${esc(c.league)}` : ''} chargé. Appuyez sur <b>Mettre à jour</b> (gratuit) pour aujourd’hui et pour demain.</p>`;
  }
  const options = all.map(m => eligibleBets(m, c)).filter(o => o.length).sort((a, b) => b[0].b.p - a[0].b.p);
  const estNote = all.some(m => m.books) ? '' : `<p class="hint">Cotes estimées : par sécurité, l’app ne retient que des cotes d’au moins ${odd((c.minOdd || 1.01) + EST_MARGIN)}. Vérifiez la cote dans l’appli avant de jouer.</p>`;
  if (!options.length) return `<p class="defi-empty">Aucun pari des ${all.length} matchs à venir ne respecte ces cotes.</p>`;
  if (c.kind !== 'combo') {
    const top = options.slice(0, 5).map(o => o[0]);
    return `<p class="defi-sub">Top ${top.length} des paris qui remplissent la condition au plus juste</p>
      <ol class="tickets">${top.map(defiRow).join('')}</ol>${estNote}${valueBlock(c, top[0].b.p, top[0].o.v)}`;
  }
  const best = bestCombo(options, c.legs, c.minTotal);
  if (!best) return `<p class="defi-empty">Pas assez de matchs compatibles (${options.length}) pour un combiné de ${c.legs} sélections.</p>`;
  const spare = options.filter(o => !best.sel.some(x => x.m.id === o[0].m.id)).slice(0, 3).map(o => o[0]);
  return `<div class="combo"><div class="combo-head"><span>Combiné conseillé · ${best.sel.length} sélections</span><span class="combo-num">${pct(best.p)} · cote ${best.real ? '' : '≈ '}${odd(best.o)}</span></div>
      <p class="hint">Le moins de sélections possible pour remplir la condition, chacune la plus probable. À placer avant le premier match.</p></div>
    <ol class="tickets">${best.sel.map(defiRow).join('')}</ol>
    ${spare.length ? `<p class="defi-sub">Remplaçants si une cote a bougé</p><ol class="tickets">${spare.map(defiRow).join('')}</ol>` : ''}
    ${estNote}${valueBlock(c, best.p, best.o)}`;
}

function defiCard(d) {
  const reading = defiUi.reading.get(d.id);
  const head = `<div class="defi-head">
      ${d.thumb ? `<img src="${d.thumb}" alt="" class="defi-thumb">` : ''}
      <div class="defi-cond">${reading != null
        ? `<b>Lecture de la capture… ${Math.round(reading * 100)} %</b>`
        : d.error ? `<b class="warn">${esc(d.error)}</b>`
        : `<b>${esc(d.title || 'Défi')}</b><span>${esc(conditionsText(d.c))}</span>`}</div>
      <button type="button" class="icon-btn defi-del" data-del-defi="${esc(d.id)}" aria-label="Supprimer ce défi">✕</button>
    </div>`;
  if (reading != null || d.error) return `<article class="defi-card">${head}</article>`;
  const unsure = !d.c.minOdd && !d.c.minTotal
    ? '<p class="hint warn">Aucune cote minimum trouvée sur la capture : l’app propose les paris les plus sûrs. Si le défi impose une cote, refaites une capture plus nette du texte des conditions.</p>' : '';
  return `<article class="defi-card">${head}${unsure}${defiResults(d.c)}</article>`;
}

function renderDefis() {
  if (ui.tab !== 'defis') return;
  const list = loadDefis();
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

async function addCaptures(files) {
  const imgs = [...files].filter(f => f.type.startsWith('image/'));
  if (!imgs.length) return;
  for (const file of imgs) {
    const id = `d${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const d = { id, thumb: await thumbnail(file), c: parseDefi(''), at: Date.now() };
    saveDefis([d, ...loadDefis()]);
    defiUi.reading.set(id, 0);
    renderDefis();
    try {
      const text = await readImage(file, p => { defiUi.reading.set(id, p); renderDefis(); });
      const leagues = [...new Set(defiMatches().map(m => m.league))];
      Object.assign(d, { text: text.slice(0, 2000), title: titleOf(text), c: parseDefi(text, leagues) });
    } catch (e) {
      d.error = e.message || 'Impossible de lire cette capture.';
    }
    defiUi.reading.delete(id);
    saveDefis(loadDefis().map(x => (x.id === id ? d : x)));
    renderDefis();
  }
}

function bindDefis() {
  const input = $('#defi-file');
  $('#defi-add').addEventListener('click', () => input.click());
  input.addEventListener('change', () => { addCaptures(input.files); input.value = ''; });
  // Ordinateur : coller une capture (Ctrl+V) quand l'onglet Défis est ouvert
  document.addEventListener('paste', e => {
    if (ui.tab !== 'defis') return;
    const files = [...(e.clipboardData?.items || [])].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile());
    if (files.length) addCaptures(files);
  });
  $('#defi-list').addEventListener('click', e => {
    const del = e.target.closest('[data-del-defi]');
    if (del) { saveDefis(loadDefis().filter(d => d.id !== del.dataset.delDefi)); renderDefis(); return; }
    const b = e.target.closest('[data-goto-match]');
    if (!b) return;
    // Ouvre le match dans l'onglet Matchs (en changeant de journée si besoin)
    const off = b.dataset.dayOf === dayKey(new Date()) ? 0 : 1;
    if (ui.dayOffset !== off) { ui.dayOffset = off; saveUi(); loadCached(); }
    setTab('matchs');
    ui.sport = 'all'; ui.status = 'all'; ui.query = ''; $('#search').value = '';
    ui.open.add(b.dataset.gotoMatch);
    render();
    document.querySelector(`.match[data-id="${CSS.escape(b.dataset.gotoMatch)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}
