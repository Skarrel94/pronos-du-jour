// ---------- Onglet « Suivi » : journal des paris joués, bankroll, ROI, CLV, bilan des pronos ----------
// Un parieur ne se juge pas au taux de réussite mais :
//  - au ROI (bénéfice / mises) sur un grand nombre de paris ;
//  - à la CLV (closing line value) : la cote prise est-elle meilleure que la cote juste au coup
//    d'envoi ? Une CLV positive régulière est le meilleur signe qu'on bat le marché, bien avant que
//    les résultats ne le montrent.

const loadJournal = () => store.get('pdj-bets', []);
const saveJournal = list => store.set('pdj-bets', list);

// Bankroll actuelle : bankroll de départ (réglages) + bénéfices des paris réglés.
function currentBankroll() {
  const start = settings().bankroll;
  if (!(start > 0)) return 0;
  return start + loadJournal().reduce((s, j) => s + (j.profit || 0), 0);
}

// Matchs connus (journée affichée + aujourd'hui et demain en cache), pour noter un pari.
function knownMatch(id) {
  const fromUi = ui.data?.matches.find(m => m.id === id);
  if (fromUi) return fromUi;
  for (const off of [0, 1]) {
    const d = new Date();
    d.setDate(d.getDate() + off);
    const m = store.get(cacheKey(d), null)?.matches.find(x => x.id === id);
    if (m) return withAnalysis(m);
  }
  return null;
}

// ---------- Noter un pari joué ----------
const logUi = { match: null };

function openLog(id, preset = null) {
  const m = knownMatch(id);
  if (!m) { toast('Match introuvable : mettez la journée à jour.'); return; }
  logUi.match = m;
  const a = m.analysis;
  const bets = [...a.bets].sort((x, y) => y.p - x.p);
  const sel = preset ? bets.findIndex(b => sameBet(b, preset)) : bets.indexOf(a.best);
  $('#log-match').textContent = `${m.home.name} – ${m.away.name} · ${timeOf(m.date)}`;
  $('#log-bet').innerHTML = bets.map((b, i) => `<option value="${i}" ${i === Math.max(0, sel) ? 'selected' : ''}>${esc(b.label)} (${pct(b.p)})</option>`).join('');
  logUi.bets = bets;
  const mine = settings().books;
  $('#log-book').innerHTML = Object.entries(Engine.BOOKS).map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('');
  $('#log-book').value = bets[Math.max(0, sel)].bestBook && mine.includes(bets[Math.max(0, sel)].bestBook) ? bets[Math.max(0, sel)].bestBook : mine[0];
  $('#log-freebet').checked = false;
  fillLogOdd(true);
  $('#log-dialog').showModal();
}

// Préremplit la cote (celle du bookmaker choisi) et la mise conseillée
function fillLogOdd(withStake) {
  const b = logUi.bets[Number($('#log-bet').value)];
  const o = b.odds[$('#log-book').value];
  $('#log-odd').value = o ? o.v.toFixed(2) : '';
  const stake = stakeOf(b);
  if (withStake) $('#log-stake').value = stake || '';
  const fair = b.fair;
  $('#log-hint').innerHTML = `Cote juste ${odd(fair)}${b.evSrc === 'sharp' ? ' (Pinnacle)' : ' (estimation, sans Pinnacle)'}`
    + (o && !o.real ? ' · cote préremplie estimée : corrigez-la avec la cote réelle de votre ticket.' : '')
    + (stake ? ` · mise conseillée ${eur2(stake)}.` : '.');
}

function saveLog(e) {
  e.preventDefault();
  const m = logUi.match;
  const b = logUi.bets[Number($('#log-bet').value)];
  const oddV = Number(String($('#log-odd').value).replace(',', '.'));
  const stake = Number(String($('#log-stake').value).replace(',', '.'));
  if (!(oddV > 1) || !(stake > 0)) { toast('Indiquez la cote (supérieure à 1) et la mise.'); return; }
  const j = {
    id: `b${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
    matchId: m.id, path: m.src.path, day: dayKey(new Date(m.date)), date: m.date, sport: m.sport,
    match: `${m.home.short} – ${m.away.short}`, label: b.label, type: b.type, side: b.side, line: b.line ?? null,
    book: $('#log-book').value, odd: oddV, stake, freebet: $('#log-freebet').checked,
    p: b.p, fair: b.fair, sharp: b.evSrc === 'sharp', closeFair: b.fair, closeSharp: b.evSrc === 'sharp',
    status: 'pending', profit: 0, at: Date.now(),
  };
  saveJournal([j, ...loadJournal()]);
  $('#log-dialog').close();
  toast(`Pari noté : ${b.label} à ${odd(oddV)}${j.freebet ? ' (freebet)' : ''}`);
  render();
}

function bindJournal() {
  $('#log-form').addEventListener('submit', saveLog);
  $('#log-cancel').addEventListener('click', () => $('#log-dialog').close());
  $('#log-bet').addEventListener('change', () => fillLogOdd(true));
  $('#log-book').addEventListener('change', () => fillLogOdd(false));
  $('#view-suivi').addEventListener('click', e => {
    const del = e.target.closest('[data-del-bet]');
    if (del) {
      if (confirm('Supprimer ce pari du journal ?')) { saveJournal(loadJournal().filter(j => j.id !== del.dataset.delBet)); render(); }
      return;
    }
    const st = e.target.closest('[data-settle]');
    if (st) {
      const [id, status] = st.dataset.settle.split(':');
      saveJournal(loadJournal().map(j => {
        if (j.id !== id) return j;
        const profit = status === 'won' ? j.stake * (j.odd - 1) : status === 'lost' ? (j.freebet ? 0 : -j.stake) : 0;
        return { ...j, status, profit, settledAt: Date.now(), manual: true };
      }));
      render();
      return;
    }
    if (e.target.closest('#export-csv')) exportCsv();
    if (e.target.closest('[data-goto-settings]')) openSettings();
  });
}

// ---------- Statistiques ----------
function journalStats(list) {
  const done = list.filter(j => j.status !== 'pending');
  const cash = done.filter(j => !j.freebet);
  const staked = cash.reduce((s, j) => s + j.stake, 0);
  const profit = done.reduce((s, j) => s + (j.profit || 0), 0);
  // CLV : seulement une fois le match commencé (la cote juste ne bouge plus)
  const clv = list.filter(j => j.closeSharp && j.closeFair && new Date(j.date) <= Date.now()).map(j => j.odd / j.closeFair - 1);
  return {
    n: list.length, done: done.length, pending: list.length - done.length,
    won: done.filter(j => j.status === 'won').length,
    staked, profit, roi: staked ? profit / staked : null,
    clv: clv.length ? clv.reduce((a, b) => a + b, 0) / clv.length : null, nClv: clv.length,
    beatClose: clv.length ? clv.filter(x => x > 0).length / clv.length : null,
  };
}

// Petite courbe du bénéfice cumulé
function profitCurve(list) {
  const pts = list.filter(j => j.status !== 'pending').sort((a, b) => (a.settledAt || a.at) - (b.settledAt || b.at));
  if (pts.length < 2) return '';
  let c = 0;
  const ys = [0, ...pts.map(j => (c += j.profit || 0))];
  const min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
  const W = 300, H = 70;
  const xy = ys.map((y, i) => `${(i / (ys.length - 1) * W).toFixed(1)},${(H - 4 - (y - min) / span * (H - 8)).toFixed(1)}`);
  const zero = (H - 4 - (0 - min) / span * (H - 8)).toFixed(1);
  return `<svg class="curve" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Bénéfice cumulé : ${euro(c)}">
    <line x1="0" x2="${W}" y1="${zero}" y2="${zero}" class="zero"/>
    <polyline points="${xy.join(' ')}" class="${c >= 0 ? 'up' : 'down'}"/></svg>`;
}

const sign = x => (x >= 0 ? '+' : '');

function statRow(label, st) {
  if (!st.n) return '';
  return `<tr><td>${esc(label)}</td><td class="n">${st.n}</td><td class="n">${pct(st.won / st.n)}</td><td class="n">${pct(st.expected / st.n)}</td>
    <td class="n ${st.roi > 0 ? 'good' : st.roi < 0 ? 'bad' : ''}">${st.roi == null ? '–' : `${sign(st.roi)}${pct1(st.roi)}`}</td></tr>`;
}

// ROI et CLV par compétition : paris joués (journal) et pronos de l'app, pour garder dans le mode
// Rentabilité les compétitions qui rapportent et retirer les autres.
function byLeagueTable(journal, hist) {
  const rows = new Map();
  const row = path => {
    if (!rows.has(path)) rows.set(path, { path, bets: [], picks: [] });
    return rows.get(path);
  };
  journal.forEach(j => j.path && row(j.path).bets.push(j));
  hist.forEach(h => h.path && row(h.path).picks.push(h));
  const list = [...rows.values()].filter(r => r.bets.length || r.picks.length)
    .sort((a, b) => (b.bets.length - a.bets.length) || (b.picks.length - a.picks.length));
  if (!list.length) return '';
  const cell = (v, n) => (v == null ? '<td class="n">–</td>' : `<td class="n ${v > 0 ? 'good' : v < 0 ? 'bad' : ''}">${sign(v)}${pct1(v)}</td>`);
  return `<h3 class="sub">Par compétition</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Compétition</th><th class="n">Paris</th><th class="n">ROI</th><th class="n">CLV</th><th class="n">Pronos</th><th class="n">ROI pronos</th></tr></thead>
      <tbody>${list.map(r => {
        const js = journalStats(r.bets), ps = pickStats(r.picks);
        const src = SRC_BY_PATH.get(r.path);
        return `<tr><td>${esc(src?.league || r.path)}${src && !isActive(r.path) ? ' <small class="hint">(non suivie)</small>' : ''}</td><td class="n">${r.bets.length}</td>${cell(js.roi)}${cell(js.clv)}<td class="n">${ps.n}</td>${cell(ps.roi)}</tr>`;
      }).join('')}</tbody></table></div>
    <p class="hint">Après 30 à 50 paris dans une compétition, une CLV négative est le signal pour la retirer (réglages ⚙, « Compétitions suivies »).</p>`;
}

function renderSuivi() {
  if (ui.tab !== 'suivi') return;
  const s = settings();
  const journal = loadJournal();
  const st = journalStats(journal);
  const bk = currentBankroll();
  const statusTxt = { pending: 'En attente', won: 'Gagné', lost: 'Perdu', void: 'Remboursé' };
  const rows = journal.slice(0, 100).map(j => {
    const started = new Date(j.date) <= Date.now();
    const clv = j.closeSharp && j.closeFair ? j.odd / j.closeFair - 1 : null;
    const past = new Date(j.date).getTime() + 3 * 36e5 < Date.now();
    return `<li class="jrow ${j.status}">
      <div class="jmain"><b>${esc(j.match)}</b><span>${esc(j.label)}</span>
        <small>${new Date(j.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} · ${esc(Engine.BOOKS[j.book] || j.book)} à ${odd(j.odd)} · ${j.freebet ? 'freebet ' : ''}${eur2(j.stake)}${clv != null ? ` · ${started ? 'CLV' : 'avantage actuel'} <span class="${clv >= 0 ? 'good' : 'bad'}">${sign(clv)}${pct1(clv)}</span>` : ''}</small></div>
      <div class="jside"><span class="jst">${statusTxt[j.status]}</span>${j.status !== 'pending' ? `<b class="${j.profit > 0 ? 'good' : j.profit < 0 ? 'bad' : ''}">${euro(j.profit || 0)}</b>` : ''}
        ${j.status === 'pending' && past ? `<span class="jset"><button type="button" data-settle="${j.id}:won">Gagné</button><button type="button" data-settle="${j.id}:lost">Perdu</button><button type="button" data-settle="${j.id}:void">Remb.</button></span>` : ''}
        <button type="button" class="icon-btn jdel" data-del-bet="${j.id}" aria-label="Supprimer ce pari">✕</button></div></li>`;
  }).join('');

  // Bilan des pronos de l'app (mise fixe de 1 à la cote affichée avant le match)
  const hist = Object.values(store.get('pdj-history', {})).filter(h => h.won !== null);
  const bySport = {};
  hist.forEach(h => { (bySport[h.sport || '?'] ||= []).push(h); });
  const buckets = [[0, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 1.01]].map(([lo, hi]) => {
    const l = hist.filter(h => h.p >= lo && h.p < hi);
    return l.length ? `<tr><td>${Math.round(lo * 100)}–${Math.min(100, Math.round(hi * 100))} %</td><td class="n">${l.length}</td><td class="n">${pct(l.reduce((a, h) => a + h.p, 0) / l.length)}</td><td class="n">${pct(l.filter(h => h.won).length / l.length)}</td></tr>` : '';
  }).join('');

  $('#suivi-body').innerHTML = `
    <div class="kpis">
      <div class="kpi"><span>Bankroll</span><b>${s.bankroll > 0 ? eur2(bk) : '–'}</b><small>${s.bankroll > 0 ? `départ ${eur2(s.bankroll)}` : '<button type="button" class="linkish" data-goto-settings>la renseigner</button>'}</small></div>
      <div class="kpi"><span>Bénéfice</span><b class="${st.profit > 0 ? 'good' : st.profit < 0 ? 'bad' : ''}">${euro(st.profit)}</b><small>${st.done} pari${st.done > 1 ? 's' : ''} réglé${st.done > 1 ? 's' : ''}, ${st.pending} en attente</small></div>
      <div class="kpi"><span>ROI</span><b class="${st.roi > 0 ? 'good' : st.roi < 0 ? 'bad' : ''}">${st.roi == null ? '–' : `${sign(st.roi)}${pct1(st.roi)}`}</b><small>sur ${eur2(st.staked)} misés (hors freebets)</small></div>
      <div class="kpi"><span>CLV moyenne</span><b class="${st.clv > 0 ? 'good' : st.clv < 0 ? 'bad' : ''}">${st.clv == null ? '–' : `${sign(st.clv)}${pct1(st.clv)}`}</b><small>${st.nClv ? `cote battue ${pct(st.beatClose)} du temps` : 'avec cote Pinnacle'}</small></div>
    </div>
    ${profitCurve(journal)}
    <p class="hint">La <b>CLV</b> compare votre cote à la cote juste Pinnacle relevée au plus près du coup d’envoi (dernière fois que les vraies cotes ont été chargées avant le match). Sur 50 paris et plus, une CLV positive prouve que vous battez le marché ; le ROI, lui, ne devient fiable qu’après plusieurs centaines de paris.</p>
    <h3 class="sub">Journal des paris joués</h3>
    ${journal.length ? `<ul class="journal">${rows}</ul><button type="button" class="ghost" id="export-csv">Exporter le journal (CSV)</button>`
      : '<p class="defi-empty">Aucun pari noté. Dans le détail d’un match, touchez « J’ai joué un pari sur ce match » : le pari est réglé automatiquement après le match.</p>'}
    ${byLeagueTable(journal, Object.values(store.get('pdj-history', {})).filter(h => h.won !== null))}
    <h3 class="sub">Bilan des pronos de l’app (60 jours)</h3>
    ${hist.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Pronos</th><th class="n">Nb</th><th class="n">Réussis</th><th class="n">Attendu</th><th class="n">ROI</th></tr></thead>
      <tbody>${statRow('Tous', pickStats(hist))}${statRow('Paris value', pickStats(hist.filter(h => h.value)))}${statRow('Indicatifs', pickStats(hist.filter(h => !h.value)))}
      ${Object.entries(bySport).map(([k, l]) => statRow(Engine.SPORT_CFG[k]?.label || k, pickStats(l))).join('')}</tbody></table></div>
      <p class="hint">ROI : mise de 1 sur chaque prono, à la cote affichée avant le match (réelle ou estimée). « Attendu » : moyenne des probabilités annoncées ; s’il est proche de « Réussis », les probabilités sont bien calibrées.</p>
      <h3 class="sub">Calibration</h3>
      <div class="table-wrap"><table><thead><tr><th>Probabilité annoncée</th><th class="n">Nb</th><th class="n">Moyenne</th><th class="n">Réalisé</th></tr></thead><tbody>${buckets}</tbody></table></div>`
      : '<p class="defi-empty">Pas encore de prono réglé. Les pronos sont enregistrés avant chaque match et réglés automatiquement (même les jours suivants, à la mise à jour).</p>'}`;
}

function exportCsv() {
  const head = ['date', 'match', 'pari', 'bookmaker', 'cote', 'mise', 'freebet', 'proba', 'cote_juste', 'cote_juste_cloture', 'statut', 'benefice'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = loadJournal().map(j => [j.date, j.match, j.label, Engine.BOOKS[j.book] || j.book, j.odd, j.stake, j.freebet ? 'oui' : 'non',
    j.p?.toFixed(3), j.fair?.toFixed(2), j.closeFair?.toFixed(2), j.status, (j.profit || 0).toFixed(2)].map(q).join(';'));
  const blob = new Blob(['﻿' + [head.join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pronos-du-jour-journal-${dayKey(new Date())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
