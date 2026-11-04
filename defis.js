// ---------- Onglet « Défis freebets » ----------
// On recopie les conditions d'un défi Winamax / Betclic ; l'app cherche les paris des matchs
// à venir qui les respectent au plus juste (cote la plus proche du minimum, donc la plus probable)
// et estime si le défi vaut le coup. Utilise les mêmes données que l'onglet Matchs.

const DEFI_DEFAULT = { book: 'winamax', kind: 'single', minOdd: 1.10, maxOdd: '', legs: 2, minTotal: '', sport: 'all', stake: '', freebet: '', onlyIfWon: true };
// Cote estimée : on garde une marge, la cote réelle peut être un peu plus basse.
const EST_MARGIN = 0.03;
// Part moyenne de la valeur d'un freebet réellement récupérée (seul le gain est versé, joué vers 2,5).
const FREEBET_VALUE = 0.65;

const defiState = () => ({ ...DEFI_DEFAULT, ...store.get('pdj-defi', {}) });
const numOr = (v, d) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : d; };

// Matchs disponibles : aujourd'hui et demain, si la journée a été mise à jour.
function defiMatches() {
  const out = [];
  for (const off of [0, 1]) {
    const d = new Date();
    d.setDate(d.getDate() + off);
    const live = ui.data?.day === dayKey(d) ? ui.data.matches : null;
    const c = live ? null : store.get(cacheKey(d), null);
    const ms = live || (c ? c.matches.filter(m => SRC_BY_PATH.has(m.src?.path)).map(withAnalysis) : []);
    out.push(...ms);
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
function eligibleBets(m, s) {
  const min = numOr(s.minOdd, 1.01);
  const max = s.maxOdd === '' ? Infinity : numOr(s.maxOdd, Infinity);
  return m.analysis.bets
    .map(b => ({ m, b, o: bookOdd(b, s.book) }))
    .filter(x => x.o && x.o.v >= min + (x.o.real ? 0 : EST_MARGIN) && x.o.v <= max)
    .sort((x, y) => y.b.p - x.b.p || x.o.v - y.o.v);
}

// Combiné : au moins `legs` matchs différents, cote totale >= minTotal, probabilité maximale.
function bestCombo(options, legs, minTotal) {
  const pool = options.slice(0, 40); // [[option du match la plus probable, ...autres], ...]
  if (pool.length < legs) return null;
  const lp = x => Math.log(x.b.p), lo = x => Math.log(x.o.v);
  const target = Math.log(minTotal || 1);
  let best = null;
  for (let k = legs; k <= Math.min(pool.length, legs + 6); k++) {
    // Départ : les k matchs les plus sûrs, chacun avec son pari le plus probable
    const pick = new Map(pool.slice(0, k).map((opts, i) => [i, opts[0]]));
    let logO = [...pick.values()].reduce((s, x) => s + lo(x), 0);
    for (let guard = 0; logO < target - 1e-9 && guard < 60; guard++) {
      // Meilleur échange : le plus de cote gagnée pour le moins de probabilité perdue
      let move = null;
      for (const [i, cur] of pick) {
        const tryIt = (key, nx) => {
          const dO = lo(nx) - lo(cur);
          if (dO <= 1e-9) return;
          const cost = Math.max(0, lp(cur) - lp(nx));
          const eff = cost / dO;
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
function defiValue(s, p, o) {
  const stake = numOr(s.stake, 0), fb = numOr(s.freebet, 0);
  if (!stake || !fb) return null;
  const evStake = stake * (p * o - 1);
  const evFb = fb * FREEBET_VALUE * (s.onlyIfWon ? p : 1);
  return { evStake, evFb, total: evStake + evFb };
}

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

function valueBlock(s, p, o) {
  const v = defiValue(s, p, o);
  if (!v) return '<p class="hint">Indiquez la mise demandée et le montant du freebet pour savoir si le défi vaut le coup.</p>';
  const ok = v.total > 0;
  return `<div class="defi-value ${ok ? 'ok' : 'ko'}">
    <p class="defi-verdict">${ok ? 'Le défi vaut le coup' : 'Le défi ne vaut pas le coup'} : ${eur(v.total)} en moyenne</p>
    <ul>
      <li>Pari imposé (marge du bookmaker) : <b>${eur(v.evStake)}</b> en moyenne sur ${numOr(s.stake, 0)} €</li>
      <li>Freebet de ${numOr(s.freebet, 0)} € : vaut environ <b>${eur(v.evFb)}</b>${s.onlyIfWon ? ` (seulement si le pari passe, ${pct(p)})` : ''}</li>
    </ul>
    <p class="hint">Un freebet ne rend que le gain, pas la mise : joué sur une cote d’environ 2,5, il rapporte en moyenne 65 % de sa valeur.</p>
  </div>`;
}

function renderDefiResults() {
  const s = defiState();
  const el = $('#defi-results');
  const all = defiMatches().filter(m => s.sport === 'all' || m.sport === s.sport);
  if (!all.length) {
    el.innerHTML = `<div class="empty"><p class="empty-title">Aucun match à venir</p><p>Appuyez sur <b>Mettre à jour</b> (gratuit), pour aujourd’hui et pour demain, afin de chercher les paris compatibles.</p></div>`;
    return;
  }
  const options = all.map(m => eligibleBets(m, s)).filter(o => o.length).sort((a, b) => b[0].b.p - a[0].b.p);
  const realCount = all.filter(m => m.books).length;
  const note = realCount ? '' : `<p class="hint">Cotes estimées (pas de vraies cotes chargées) : l’app ne retient que les cotes estimées d’au moins ${odd(numOr(s.minOdd, 1.01) + EST_MARGIN)}, par sécurité. Vérifiez la cote dans l’appli ${s.book === 'both' ? 'Betclic ou Winamax' : bookName(s.book)} avant de jouer.</p>`;
  if (!options.length) {
    el.innerHTML = `<div class="empty"><p class="empty-title">Aucun pari compatible</p><p>Aucun pari des ${all.length} matchs à venir ne respecte ces cotes. Élargissez la cote maximum ou le sport.</p></div>${note}`;
    return;
  }
  if (s.kind === 'single') {
    const top = options.slice(0, 5).map(o => o[0]);
    el.innerHTML = `<h2>Top ${top.length} des paris compatibles</h2>
      <p class="meta">Un pari par match, le plus probable qui respecte la cote minimum. ${options.length} match${options.length > 1 ? 's' : ''} compatible${options.length > 1 ? 's' : ''} sur ${all.length}.</p>
      <ol class="tickets">${top.map(defiRow).join('')}</ol>
      ${note}
      <h3 class="defi-sub">Le défi vaut-il le coup ? (avec le n° 1)</h3>
      ${valueBlock(s, top[0].b.p, top[0].o.v)}`;
    return;
  }
  const legs = Math.max(2, Math.round(numOr(s.legs, 2)));
  const minTotal = s.minTotal === '' ? 0 : numOr(s.minTotal, 0);
  const c = bestCombo(options, legs, minTotal);
  if (!c) {
    el.innerHTML = `<div class="empty"><p class="empty-title">Combiné impossible</p><p>Pas assez de matchs compatibles (${options.length}) pour ${legs} sélections${minTotal ? ` avec une cote totale de ${odd(minTotal)}` : ''}.</p></div>${note}`;
    return;
  }
  const spare = options.filter(o => !c.sel.some(x => x.m.id === o[0].m.id)).slice(0, 3).map(o => o[0]);
  el.innerHTML = `<h2>Le combiné le plus sûr pour ce défi</h2>
    <div class="combo"><div class="combo-head"><span>${c.sel.length} sélections</span><span class="combo-num">${pct(c.p)} · cote ${c.real ? '' : '≈ '}${odd(c.o)}</span></div>
      <ul>${c.sel.map(x => `<li><span>${dayLabel(x.m.date)}${timeOf(x.m.date)} · ${esc(x.m.home.short)} – ${esc(x.m.away.short)}</span><b>${esc(x.b.label)} · ${x.o.real ? '' : '≈'}${odd(x.o.v)}</b></li>`).join('')}</ul>
      <p class="hint">Le moins de sélections possible pour atteindre la condition, chacune la plus probable. À placer avant le premier match du combiné.</p></div>
    <ol class="tickets defi-legs">${c.sel.map(defiRow).join('')}</ol>
    ${spare.length ? `<h3 class="defi-sub">Remplaçants si une cote a bougé</h3><ol class="tickets">${spare.map(defiRow).join('')}</ol>` : ''}
    ${note}
    <h3 class="defi-sub">Le défi vaut-il le coup ?</h3>
    ${valueBlock(s, c.p, c.o)}`;
}

function renderDefiForm() {
  const s = defiState();
  const f = $('#defi-form');
  f.elements.book.value = s.book;
  f.elements.kind.value = s.kind;
  f.elements.minOdd.value = s.minOdd;
  f.elements.maxOdd.value = s.maxOdd;
  f.elements.legs.value = s.legs;
  f.elements.minTotal.value = s.minTotal;
  f.elements.stake.value = s.stake;
  f.elements.freebet.value = s.freebet;
  f.elements.onlyIfWon.checked = !!s.onlyIfWon;
  const sports = [...new Set(defiMatches().map(m => m.sport))];
  f.elements.sport.innerHTML = ['all', ...SPORT_ORDER.filter(x => sports.includes(x) || x === s.sport)]
    .map(k => `<option value="${k}">${k === 'all' ? 'Tous les sports' : esc(Engine.SPORT_CFG[k].label)}</option>`).join('');
  f.elements.sport.value = s.sport;
  document.querySelectorAll('.combo-only').forEach(e => { e.hidden = s.kind !== 'combo'; });
}

function renderDefis() {
  if (ui.tab !== 'defis') return;
  renderDefiForm();
  renderDefiResults();
}

function saveDefi() {
  const f = $('#defi-form').elements;
  store.set('pdj-defi', {
    book: f.book.value, kind: f.kind.value,
    minOdd: f.minOdd.value, maxOdd: f.maxOdd.value.trim(),
    legs: f.legs.value, minTotal: f.minTotal.value.trim(), sport: f.sport.value,
    stake: f.stake.value.trim(), freebet: f.freebet.value.trim(), onlyIfWon: f.onlyIfWon.checked,
  });
  document.querySelectorAll('.combo-only').forEach(e => { e.hidden = f.kind.value !== 'combo'; });
  renderDefiResults();
}

function bindDefis() {
  const f = $('#defi-form');
  f.addEventListener('input', saveDefi);
  f.addEventListener('change', saveDefi);
  f.addEventListener('submit', e => e.preventDefault());
  $('#defi-reset').addEventListener('click', () => { store.set('pdj-defi', {}); renderDefis(); });
  $('#defi-results').addEventListener('click', e => {
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
