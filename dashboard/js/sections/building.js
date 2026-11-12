// Place panel: the compact, dismissible card beside the map for what is selected.
//   Building → address, latest score with its citywide band, latest inspection date, one line of context,
//              one primary action (Inspect building) and two quieter ones (History, Compare nearby).
//   Ward     → one finding: its share in the citywide lowest 10%, against the city's share. "Explore ward"
//              opens the rest on request: median and rank, its lowest-scoring buildings (also the keyboard
//              route to individual buildings) and the two analysis layers that work per ward.
// It replaces the old full-page Building Explorer; the numbers and rules are the same.

import { scoreBand } from '../model.js';
import { buildingEvaluations, timelinePoints } from '../xray-model.js';
import { nearby } from '../atlas/logic.js';
import { renderTimeline } from './xray-timeline.js';
import { pct, fmt, esc, titleCase, formatDate } from '../ui.js';

const BAND = {
  low10: { label: 'Lowest 10% in Toronto', cls: 'band-low10', mark: '▼ ' },
  low25: { label: 'Lowest 25% in Toronto', cls: 'band-low25', mark: '▼ ' },
  other: { label: 'Above the lowest 25%', cls: 'band-ok', mark: '' },
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

  const head = `<header class="place-head">
      <div><p class="place-kicker">Ward ${+any.ward} · ${esc(any.wardName)}</p>
      <h2 id="place-title" tabindex="-1">${esc(titleCase(any.address))}</h2></div>
      <button type="button" class="icon-button place-close" data-act="close" aria-label="Close building details" title="Close (Esc)">×</button>
    </header>`;

  if (!r) {
    box.innerHTML = `${head}
      <p class="place-note">No evaluation of this building in the ${esc(pm.P.long)}.${other ? ` Its latest evaluation (${formatDate(other.date)}) used the ${esc(M.byPeriod[otherEra].P.long)}.` : ''}</p>
      <div class="place-actions">
        ${other ? `<button type="button" class="btn btn-primary" data-act="period" data-era="${otherEra}">Show the ${esc(M.byPeriod[otherEra].P.label)} system</button>` : ''}
        <button type="button" class="btn" data-act="inspect">Inspect building</button>
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
  box.innerHTML = `${head}
    <div class="place-score">
      <p class="score-line"><span class="score-num">${r.score}</span><span class="score-of">/100</span>
        <span class="band ${BAND[band].cls}">${BAND[band].mark ? `<span aria-hidden="true">${BAND[band].mark}</span>` : ''}${BAND[band].label}</span></p>
      <p class="place-date"><span>Latest inspection <b>${formatDate(r.date)}</b></span><span class="place-sys">${esc(pm.P.label)} system
        <button type="button" class="info-btn" data-info="score" aria-label="What does this score mean?">i</button></span></p>
    </div>
    <p class="place-context"><b>${poor}</b> of ${rated.length} items rated poorly<span aria-hidden="true"> · </span><span class="place-facts">${facts.join(' · ')}</span></p>
    <div class="place-actions" role="group" aria-label="Building actions">
      <button type="button" class="btn btn-primary" data-act="inspect">Inspect building</button>
      <div class="place-sec">
        <button type="button" class="btn btn-quiet" data-act="tab" data-tab="history" ${pressed('history')} aria-controls="place-more">History</button>
        <button type="button" class="btn btn-quiet" data-act="tab" data-tab="nearby" ${pressed('nearby')} aria-controls="place-more">Compare nearby</button>
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
    ${pm.era === 'cur' ? `<p class="place-link"><a href="#/compare/${r.rsn}" data-depth>Same score, elsewhere: compare item by item →</a></p>` : ''}`;
}

function renderHistory(el, r, ctx, M, opts) {
  const { pm } = ctx;
  const all = buildingEvaluations(M.data.byRsn.get(r.rsn) ?? []);
  el.innerHTML = '<h3 class="place-h3">Score history</h3><div class="place-tl chart"></div>';
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
  const lowest = [...inWard].sort((a, b) => a.score - b.score || a.address.localeCompare(b.address)).slice(0, 5);
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
      <h3 class="place-h3">Lowest-scoring buildings</h3>
      <ol class="near-list low-list">${lowest.map((d) => `
        <li><button type="button" data-rsn="${d.rsn}"><span class="nl-name">${esc(titleCase(d.address))}</span>
        <span class="nl-km">${formatDate(d.date)}</span><span class="nl-score ${scoreBand(d.score, pm)}">${d.score}</span></button></li>`).join('')}</ol>
      <h3 class="place-h3">Analyse this ward</h3>
      <div class="place-lenses">
        <button type="button" class="btn btn-sm" data-act="lens" data-lens="age">Age and score</button>
        <button type="button" class="btn btn-sm" data-act="lens" data-lens="problems">Common problems</button>
      </div>
    </div>`;
  wire(box, opts);
  box.querySelector('[data-act="ward-more"]').addEventListener('click', (e) => {
    wardOpen = wardOpen === ward ? null : ward;
    const now = wardOpen === ward;
    const more = box.querySelector('#ward-more');
    e.currentTarget.setAttribute('aria-expanded', String(now));
    e.currentTarget.textContent = now ? 'Hide ward details' : 'Explore ward';
    more.hidden = !now;
    if (now && !matchMedia('(prefers-reduced-motion: reduce)').matches) more.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
  });
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
