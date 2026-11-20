// Place panel: the compact, dismissible card beside the map for what is selected.
//   Building → one card: Toronto › ward breadcrumb (filled by main.js), ward, address, the score and its
//              citywide ranking in one panel, the inspection finding, last inspected date and building facts,
//              then one primary action (View inspection details) over two equal ones (Score history, Compare nearby).
//   Ward     → one finding: its share in the citywide lowest 10%, against the city's share. "Explore ward"
//              opens the rest on request: median and rank, its lowest- or highest-scoring buildings (switchable;
//              also the keyboard route to individual buildings) and the two analysis layers that work per ward.
// It replaces the old full-page Building Explorer; the numbers and rules are the same.

import { scoreBand } from '../model.js';
import { buildingEvaluations, timelinePoints } from '../xray-model.js';
import { nearby } from '../atlas/logic.js';
import { renderTimeline } from './xray-timeline.js';
import { pct, fmt, esc, titleCase, formatDate } from '../ui.js';
import { reducedMotion } from '../motion.js';

const BAND = {
  low10: { label: 'Lowest 10% in Toronto', cls: 'band-low10' },
  low25: { label: 'Lowest 25% in Toronto', cls: 'band-low25' },
  other: { label: 'Above the lowest 25%', cls: 'band-ok' },
};

const distance = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

// opts: { tab: 'summary'|'nearby'|'history', onClose, onTab, onInspect(rsn, uid?), onSelect(rsn), onWard(ward), onPeriod(era), onLens(id) }
export function renderPlace(box, ctx, M, opts) {
  const { pm, selected, ward } = ctx;
  if (selected) return renderBuildingCard(box, ctx, M, opts);
  if (ward) return renderWardCard(box, ctx, M, opts);
  box.hidden = true;
  box.innerHTML = '';
}

// ---- building -----------------------------------------------------------------------------------------
function renderBuildingCard(box, ctx, M, opts) {
  const { pm, selected } = ctx;
  const r = pm.latestByRsn.get(selected);
  const otherEra = pm.era === 'cur' ? 'pre' : 'cur';
  const other = !r && M.byPeriod[otherEra].latestByRsn.get(selected);
  const any = r ?? other ?? M.data.byRsn.get(selected)?.at(-1);
  box.hidden = false;
  if (!any) { box.innerHTML = ''; box.hidden = true; return; }

  // the breadcrumb (Toronto › ward › building) is filled by main.js, which owns its navigation
  const head = `<header class="place-head">
      <nav aria-label="You are here" class="place-crumbs"><ol class="crumbs" id="place-crumbs"></ol></nav>
      <button type="button" class="icon-button place-close" data-act="close" aria-label="Close building details" title="Close (Esc)">×</button>
    </header>
    <p class="place-kicker">Ward ${+any.ward} · ${esc(any.wardName)}</p>
    <h2 id="place-title" tabindex="-1">${esc(titleCase(any.address))}</h2>`;

  if (!r) {
    box.innerHTML = `${head}
      <p class="place-note">No evaluation of this building in the ${esc(pm.P.long)}.${other ? ` Its latest evaluation (${formatDate(other.date)}) used the ${esc(M.byPeriod[otherEra].P.long)}.` : ''}</p>
      <div class="place-actions">
        ${other ? `<button type="button" class="btn btn-primary" data-act="period" data-era="${otherEra}">Show the ${esc(M.byPeriod[otherEra].P.label)} system</button>` : ''}
        <button type="button" class="btn" data-act="inspect">View inspection details</button>
      </div>`;
    wire(box, opts, selected);
    return;
  }

  const band = scoreBand(r.score, pm);
  const rated = pm.cats.filter((c) => r.ratings[c] != null);
  const poor = rated.filter((c) => r.ratings[c] <= pm.P.poorMax).length;
  const tab = opts.tab ?? 'summary';
  const facts = [r.yearBuilt ? `Built ${r.yearBuilt}` : 'Year built not recorded', r.storeys ? `${r.storeys} storeys` : null, r.units ? `${r.units} units` : null].filter(Boolean);
  // Summary: the full card. History / nearby: the card condenses to name, score and the actions, and the
  // chosen view takes the room the details used, so nothing in the panel has to scroll.
  box.classList.toggle('is-compact', tab !== 'summary');
  const pressed = (t) => `aria-pressed="${tab === t}"`;
  // the scoring system and its explanation live in Score history (renderHistory)
  box.innerHTML = `${head}
    <div class="place-score">
      <p class="score-line"><span class="score-num">${r.score}</span><span class="score-of">/100</span></p>
      <p class="band ${BAND[band].cls}">${BAND[band].label}</p>
    </div>
    <div class="place-findings">
      <p class="place-context"><b>${poor}</b> of ${rated.length} items rated poorly</p>
      <p class="place-date">Last inspected <b>${formatDate(r.date)}</b></p>
      <p class="place-facts">${facts.join(' · ')}</p>
    </div>
    <div class="place-actions" role="group" aria-label="Building actions">
      <button type="button" class="btn btn-primary" data-act="inspect">View inspection details</button>
      <div class="place-sec">
        <button type="button" class="btn place-sec-btn" data-act="tab" data-tab="history" ${pressed('history')} aria-controls="place-more">Score history</button>
        <button type="button" class="btn place-sec-btn" data-act="tab" data-tab="nearby" ${pressed('nearby')} aria-controls="place-more">Compare nearby</button>
      </div>
    </div>
    <div class="place-more" id="place-more" aria-live="polite"></div>`;

  const more = box.querySelector('#place-more');
  if (tab === 'nearby') renderNearby(more, r, ctx, M);
  if (tab === 'history') renderHistory(more, r, ctx, M, opts);
  more.hidden = tab === 'summary';
  wire(box, opts, selected);
}

function renderNearby(el, r, ctx, M) {
  const { pm } = ctx;
  const near = nearby(r, pm.latest, 4, 1500);
  const scores = near.map((x) => x.r.score);
  const typical = scores.length ? d3.median(scores) : null;
  el.innerHTML = `<h3 class="place-h3">Nearest evaluated buildings</h3>
    ${near.length ? `<p class="place-sub">Within 1.5 km, same scoring system. Their median score is <b>${typical}</b>; this building scored <b>${r.score}</b>.</p>
    <ul class="near-list">${near.map(({ r: d, d: m }) => `
      <li><button type="button" data-rsn="${d.rsn}"><span class="nl-name">${esc(titleCase(d.address))}</span>
      <span class="nl-km">${distance(m)}</span><span class="nl-score ${scoreBand(d.score, pm)}">${d.score}</span></button></li>`).join('')}</ul>`
      : '<p class="place-sub">No other evaluated building within 1.5 km.</p>'}
    ${pm.era === 'cur' ? `<p class="place-link"><a href="#/compare/${r.rsn}" data-depth>Compare buildings with the same score&nbsp;→</a></p>` : ''}`;
}

function renderHistory(el, r, ctx, M, opts) {
  const { pm } = ctx;
  const all = buildingEvaluations(M.data.byRsn.get(r.rsn) ?? []);
  el.innerHTML = `<h3 class="place-h3">Score history</h3>
    <p class="place-sys">Latest score uses the ${esc(pm.P.label)} system
      <button type="button" class="info-btn" data-info="score" aria-label="What does this score mean?">i</button></p>
    <div class="place-tl chart"></div>`;
  renderTimeline(el.querySelector('.place-tl'), {
    points: timelinePoints(all), shown: r, era: pm.era, P: pm.P, systemChange: M.byPeriod.cur.dates[0],
    onPick: (uid) => opts.onInspect(r.rsn, uid),
    where: 'inMap',
    height: matchMedia('(max-width: 760px)').matches ? 150 : 170,
    brief: true,
  });
}

// ---- ward ------------------------------------------------------------------------------------------------
// The card leads with one finding. Its details stay open per ward while the reader moves the map.
let wardOpen = null;
let wardList = 'low';   // which buildings the ward list shows: 'low' (lowest scores) | 'high' (highest); kept across wards

// The ward's buildings at one end of the score range: five, then a note for any others tied with the fifth,
// so a cut-off never silently hides buildings with exactly the same score.
const LIST_N = 5;
export function wardExtremes(inWard, which) {
  const dir = which === 'high' ? -1 : 1;
  const sorted = [...inWard].sort((a, b) => dir * (a.score - b.score) || a.address.localeCompare(b.address));
  const shown = sorted.slice(0, LIST_N);
  const edge = shown.at(-1)?.score;
  const tiedMore = sorted.slice(LIST_N).filter((r) => r.score === edge).length;
  return { shown, edge, tiedMore };
}

function wardListHtml(inWard, pm) {
  const { shown, edge, tiedMore } = wardExtremes(inWard, wardList);
  return `<ol class="near-list">${shown.map((d) => `
      <li><button type="button" data-rsn="${d.rsn}"><span class="nl-name">${esc(titleCase(d.address))}</span>
      <span class="nl-km">${formatDate(d.date)}</span><span class="nl-score ${scoreBand(d.score, pm)}">${d.score}</span></button></li>`).join('')}</ol>
    ${tiedMore ? `<p class="place-note">${fmt.n(tiedMore)} more building${tiedMore === 1 ? '' : 's'} also scored ${edge}.</p>` : ''}`;
}

function renderWardCard(box, ctx, M, opts) {
  const { pm, ward, ch } = ctx;
  box.classList.remove('is-compact');
  const row = ch?.byWard.get(ward);
  box.hidden = false;
  const name = M.wardName.get(ward) ?? `Ward ${+ward}`;
  const head = `<header class="place-head">
      <div><p class="place-kicker">Ward ${+ward}</p><h2 id="place-title" tabindex="-1">${esc(name)}</h2></div>
      <button type="button" class="icon-button place-close" data-act="close" aria-label="Close ward details" title="Back to all of Toronto (Esc)">×</button>
    </header>`;
  if (!row) { box.innerHTML = `${head}<p class="place-note">No evaluated buildings in this ward in the ${esc(pm.P.long)}.</p>`; wire(box, opts); return; }
  const open = wardOpen === ward;
  const inWard = pm.latest.filter((r) => r.ward === ward);
  const high = row.share > ch.city * 1.15, low = row.share < ch.city * 0.85;
  const max = Math.max(row.share, ch.city) * 1.15 || 1;
  box.innerHTML = `${head}
    <div class="ward-stat">
      <p class="stat-num ${high ? 'is-high' : ''}">${pct(row.share)}</p>
      <p class="stat-cap">of its ${fmt.n(row.n)} evaluated buildings are in Toronto’s lowest-scoring 10%
        <button type="button" class="info-btn" data-info="lowest-10" aria-label="What “lowest 10%” means">i</button></p>
      <div class="ward-vs" role="img" aria-label="${esc(name)} ${pct(row.share)}, citywide ${pct(ch.city)}">
        <span class="ward-vs-row"><span class="ward-vs-k">This ward</span><span class="ward-vs-track"><span class="ward-vs-bar ${high ? 'is-high' : low ? 'is-low' : ''}" style="--w:${(row.share / max * 100).toFixed(1)}%"></span></span><b>${pct(row.share)}</b></span>
        <span class="ward-vs-row"><span class="ward-vs-k">Citywide</span><span class="ward-vs-track"><span class="ward-vs-bar is-city" style="--w:${(ch.city / max * 100).toFixed(1)}%"></span></span><b>${pct(ch.city)}</b></span>
      </div>
      ${row.small ? `<p class="place-note">Only ${row.n} evaluated buildings, so a few buildings move this share a lot.</p>` : ''}
    </div>
    <div class="place-actions">
      <button type="button" class="btn btn-primary" data-act="ward-more" aria-expanded="${open}" aria-controls="ward-more">${open ? 'Hide ward details' : 'Explore ward'}</button>
    </div>
    <div class="place-more ward-more" id="ward-more" ${open ? '' : 'hidden'}>
      <p class="place-sub">Median score <b>${row.median}</b> · rank ${row.rank} of ${ch.rows.length} wards by this share</p>
      <fieldset class="seg seg-sm ward-list-pick">
        <legend class="place-h3">Buildings in this ward</legend>
        <label><input type="radio" name="ward-list" value="low" ${wardList === 'low' ? 'checked' : ''} /><span>Lowest scores</span></label>
        <label><input type="radio" name="ward-list" value="high" ${wardList === 'high' ? 'checked' : ''} /><span>Highest scores</span></label>
      </fieldset>
      <div class="ward-list" id="ward-list" aria-live="polite">${wardListHtml(inWard, pm)}</div>
      <p class="place-link"><button type="button" class="link-btn" data-act="ward-all" aria-haspopup="dialog">See all ${fmt.n(inWard.length)} buildings and scores</button></p>
      <h3 class="place-h3">Analyse this ward</h3>
      <div class="place-lenses">
        <button type="button" class="btn btn-sm" data-act="lens" data-lens="age">Age and score</button>
        <button type="button" class="btn btn-sm" data-act="lens" data-lens="problems">Common problems</button>
      </div>
    </div>`;
  wire(box, opts);
  box.querySelector('[data-act="ward-all"]').addEventListener('click', (e) => openWardTable(inWard, name, pm, opts, e.currentTarget));
  // Switching the list redraws only the list, so focus stays on the switch.
  box.querySelectorAll('input[name="ward-list"]').forEach((i) => i.addEventListener('change', () => {
    wardList = i.value;
    const list = box.querySelector('#ward-list');
    list.innerHTML = wardListHtml(inWard, pm);
    list.querySelectorAll('[data-rsn]').forEach((b) => b.addEventListener('click', () => opts.onSelect(b.dataset.rsn)));
  }));
  box.querySelector('[data-act="ward-more"]').addEventListener('click', (e) => {
    wardOpen = wardOpen === ward ? null : ward;
    const now = wardOpen === ward;
    const more = box.querySelector('#ward-more');
    e.currentTarget.setAttribute('aria-expanded', String(now));
    e.currentTarget.textContent = now ? 'Hide ward details' : 'Explore ward';
    more.hidden = !now;
    if (now && !reducedMotion()) more.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
  });
}

// ---- every building in a ward: a sortable, searchable table in a dialog -----------------------------------
// The card stays short (the page never scrolls); the full list opens on request. Every column heading sorts the
// list (click again to reverse): each shows ↕ until it is the sort, then ▲ or ▼. Filter by address. Choosing a
// building closes the dialog and selects it on the map.
const COLS = [
  { key: 'address', label: 'Address', get: (r) => titleCase(r.address), cmp: (a, b) => a.localeCompare(b) },
  { key: 'score', label: 'Score', get: (r) => r.score, num: true },
  { key: 'date', label: 'Latest inspection', get: (r) => r.date ?? '', cmp: (a, b) => a.localeCompare(b) },
  { key: 'yearBuilt', label: 'Built', get: (r) => r.yearBuilt, num: true },
  { key: 'storeys', label: 'Storeys', get: (r) => r.storeys, num: true },
  { key: 'units', label: 'Units', get: (r) => r.units, num: true },
];
let tableSort = { key: 'score', dir: 1 };   // lowest scores first, like the card; kept between openings

export function sortWardRows(rows, { key, dir }) {
  const col = COLS.find((c) => c.key === key) ?? COLS[1];
  const cmp = col.cmp ?? ((a, b) => a - b);
  return [...rows].sort((a, b) => {
    const va = col.get(a), vb = col.get(b);
    if (va == null || vb == null) return va == null && vb == null ? 0 : va == null ? 1 : -1;   // not recorded: always last
    return dir * cmp(va, vb) || a.address.localeCompare(b.address);
  });
}

function openWardTable(inWard, name, pm, opts, opener) {
  let dlg = document.getElementById('ward-table-dialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.className = 'bx-dialog ward-dialog';
    dlg.id = 'ward-table-dialog';
    dlg.setAttribute('aria-labelledby', 'ward-table-title');
    document.body.append(dlg);
  }
  dlg.innerHTML = `
    <div class="bx-dialog-head">
      <div><p class="place-kicker">${esc(pm.P.label)} system</p><h2 id="ward-table-title">Every evaluated building in ${esc(name)}</h2></div>
      <button type="button" class="popover-close" data-close aria-label="Close the list">×</button>
    </div>
    <div class="ward-table-tools">
      <label class="visually-hidden" for="ward-table-q">Filter by address</label>
      <input id="ward-table-q" type="search" placeholder="Filter by address" autocomplete="off" spellcheck="false" />
      <p class="ward-table-count" id="ward-table-count" aria-live="polite"></p>
    </div>
    <div class="bx-dialog-body ward-table">
      <table>
        <caption class="visually-hidden">Buildings in ${esc(name)}, with their latest score. Column headings sort the table.</caption>
        <thead><tr>${COLS.map((c) => `<th scope="col" data-key="${c.key}" data-col="${c.key}" class="${c.num ? 'is-num' : ''}"><button type="button"><span class="th-label">${c.label}</span><span class="sort-mark" aria-hidden="true"></span></button></th>`).join('')}</tr></thead>
        <tbody></tbody>
      </table>
    </div>`;

  const q = dlg.querySelector('#ward-table-q');
  const table = dlg.querySelector('table');
  const body = dlg.querySelector('tbody');
  const draw = () => {
    table.dataset.sort = tableSort.key;   // on phones, the sorted column stays visible (building.css)
    const needle = q.value.trim().toLowerCase();
    const rows = sortWardRows(inWard.filter((r) => !needle || r.address.toLowerCase().includes(needle)), tableSort);
    dlg.querySelectorAll('thead th').forEach((th) => {
      const on = th.dataset.key === tableSort.key;
      th.setAttribute('aria-sort', on ? (tableSort.dir > 0 ? 'ascending' : 'descending') : 'none');
      const mark = th.querySelector('.sort-mark');
      mark.textContent = on ? (tableSort.dir > 0 ? '▲' : '▼') : '↕';
      mark.classList.toggle('is-on', on);
      th.querySelector('button').setAttribute('aria-label', `${th.querySelector('.th-label').textContent}: ${on ? `sorted ${tableSort.dir > 0 ? 'ascending' : 'descending'}, click to reverse` : 'click to sort'}`);
    });
    body.innerHTML = rows.map((r) => {
      const band = scoreBand(r.score, pm);
      return `<tr>
        <th scope="row"><button type="button" class="link-btn" data-rsn="${r.rsn}">${esc(titleCase(r.address))}</button></th>
        <td class="is-num"><span class="nl-score ${band}">${r.score}</span>${BAND[band].mark ? `<span class="visually-hidden"> (${BAND[band].label})</span>` : ''}</td>
        <td data-col="date">${formatDate(r.date)}</td>
        <td class="is-num" data-col="yearBuilt">${r.yearBuilt ?? '<span class="muted">–</span>'}</td>
        <td class="is-num" data-col="storeys">${r.storeys ?? '<span class="muted">–</span>'}</td>
        <td class="is-num" data-col="units">${r.units ?? '<span class="muted">–</span>'}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="${COLS.length}" class="muted">No building in this ward matches “${esc(q.value)}”.</td></tr>`;
    dlg.querySelector('#ward-table-count').textContent = needle ? `${fmt.n(rows.length)} of ${fmt.n(inWard.length)} buildings` : `${fmt.n(inWard.length)} buildings`;
  };
  dlg.querySelectorAll('thead th button').forEach((b) => b.addEventListener('click', () => {
    const key = b.parentElement.dataset.key;
    tableSort = tableSort.key === key ? { key, dir: -tableSort.dir } : { key, dir: key === 'address' || key === 'score' ? 1 : -1 };
    draw();
  }));

  q.addEventListener('input', draw);
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rsn]');
    if (!b) return;
    dlg.close();
    opts.onSelect(b.dataset.rsn);
  });
  const close = () => dlg.close();
  dlg.querySelector('[data-close]').addEventListener('click', close);
  dlg.onclick = (e) => { if (e.target === dlg) close(); };
  // Escape closes only the dialog, never the ward behind it (main.js skips key events already handled)
  dlg.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  dlg.onclose = () => { if (opener.isConnected) opener.focus(); };
  draw();
  dlg.showModal();
  q.focus();
}

function wire(box, opts, rsn) {
  box.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.act;
    if (a === 'close') opts.onClose();
    if (a === 'inspect') opts.onInspect(rsn);
    if (a === 'tab') opts.onTab(b.getAttribute('aria-pressed') === 'true' ? 'summary' : b.dataset.tab);
    if (a === 'period') opts.onPeriod(b.dataset.era);
    if (a === 'lens') opts.onLens(b.dataset.lens);
  }));
  box.querySelectorAll('[data-rsn]').forEach((b) => b.addEventListener('click', () => opts.onSelect(b.dataset.rsn)));
}
