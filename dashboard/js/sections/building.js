// Place panel: the compact, dismissible card beside the map for what is selected.
//   Building → address, latest score in the chosen scoring system, evaluation date, characteristics, and
//              three actions: Inspect building (X-Ray), Compare nearby, View history.
//   Ward     → its share in the citywide lowest 10%, against the city, and its lowest-scoring buildings
//              (also the keyboard route to individual buildings).
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

// "Scores higher than 72% of …" for most buildings; flipped for low scorers so it never reads "higher than 0%".
function rankText(r, rs, who) {
  const lower = rs.filter((d) => d.score < r.score).length / rs.length;
  const higher = rs.filter((d) => d.score > r.score).length / rs.length;
  return lower >= 0.5 ? `Scores higher than <b>${pct(lower)}</b> of ${who}.` : `Scores lower than <b>${pct(higher)}</b> of ${who}.`;
}
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
  const facts = [
    ['Built', r.yearBuilt ?? 'not recorded'],
    ['Storeys', r.storeys ?? '–'],
    ['Units', r.units ?? '–'],
    ['Rated poorly', `${poor} of ${rated.length} items`],
  ];
  box.innerHTML = `${head}
    <div class="place-score">
      <p class="score-line"><span class="score-num">${r.score}</span><span class="score-of">/100</span>
        <span class="band ${BAND[band].cls}">${BAND[band].mark ? `<span aria-hidden="true">${BAND[band].mark}</span>` : ''}${BAND[band].label}</span></p>
      <p class="place-date">Evaluated ${formatDate(r.date)} · ${esc(pm.P.label)} system
        <button type="button" class="info-btn" data-info="score" aria-label="What does this score mean?">i</button></p>
    </div>
    <dl class="place-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    <p class="place-rank">${rankText(r, pm.latest, 'Toronto buildings')}</p>
    <div class="place-actions" role="group" aria-label="Building actions">
      <button type="button" class="btn btn-primary" data-act="inspect">Inspect building</button>
      <button type="button" class="btn" data-act="tab" data-tab="nearby" aria-pressed="${tab === 'nearby'}" aria-controls="place-more">Compare nearby</button>
      <button type="button" class="btn" data-act="tab" data-tab="history" aria-pressed="${tab === 'history'}" aria-controls="place-more">View history</button>
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
  const near = nearby(r, pm.latest, 5, 1500);
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
  });
}

// ---- ward ------------------------------------------------------------------------------------------------
function renderWardCard(box, ctx, M, opts) {
  const { pm, ward, ch } = ctx;
  const row = ch?.byWard.get(ward);
  box.hidden = false;
  const name = M.wardName.get(ward) ?? `Ward ${+ward}`;
  const head = `<header class="place-head">
      <div><p class="place-kicker">Ward ${+ward}</p><h2 id="place-title" tabindex="-1">${esc(name)}</h2></div>
      <button type="button" class="icon-button place-close" data-act="close" aria-label="Close ward details" title="Back to all of Toronto (Esc)">×</button>
    </header>`;
  if (!row) { box.innerHTML = `${head}<p class="place-note">No evaluated buildings in this ward in the ${esc(pm.P.long)}.</p>`; wire(box, opts); return; }
  const inWard = pm.latest.filter((r) => r.ward === ward);
  const lowest = [...inWard].sort((a, b) => a.score - b.score || a.address.localeCompare(b.address)).slice(0, 5);
  box.innerHTML = `${head}
    <p class="place-stat"><span class="stat-num ${row.share > ch.city * 1.15 ? 'is-high' : ''}">${pct(row.share)}</span>
      of its ${fmt.n(row.n)} evaluated buildings score in Toronto’s lowest 10%
      <button type="button" class="info-btn" data-info="lowest-10" aria-label="What “lowest 10%” means">i</button></p>
    <p class="place-sub">Citywide: ${pct(ch.city)}. Median score here: <b>${row.median}</b>. Rank ${row.rank} of ${ch.rows.length} wards by this share.</p>
    ${row.small ? `<p class="place-note">Only ${row.n} evaluated buildings, so a few buildings move this share a lot.</p>` : ''}
    <h3 class="place-h3">Lowest-scoring buildings here</h3>
    <ol class="near-list low-list">${lowest.map((d) => `
      <li><button type="button" data-rsn="${d.rsn}"><span class="nl-name">${esc(titleCase(d.address))}</span>
      <span class="nl-km">${formatDate(d.date)}</span><span class="nl-score ${scoreBand(d.score, pm)}">${d.score}</span></button></li>`).join('')}</ol>
    <p class="place-sub">Analyse this ward:
      <button type="button" class="link-btn" data-act="lens" data-lens="age">age and score</button> ·
      <button type="button" class="link-btn" data-act="lens" data-lens="problems">common problems</button></p>`;
  wire(box, opts);
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
