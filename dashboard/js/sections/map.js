// Ward comparison (an analysis layer of the Explore map): the share of each ward's buildings in the
// citywide lowest 10%, as a ranked list against the citywide share. It is the text-and-keyboard
// equivalent of the ward choropleth; selecting a row selects that ward on the map.
// The map itself is ../atlas/map.js.

import { wardLowShares } from '../model.js';
import { SMALL_WARD } from '../atlas/logic.js';
import { pct, fmt, esc, setFinding } from '../ui.js';
import { snapshot, play } from '../chart-motion.js';

// The ranking fills the panel a page at a time (rows stay readable and easy to select); a selected ward
// brings its page into view. The map beside it shows every ward at once.
let wardPage = 0, pagedWard = null, pagerWired = false, lastCtx = null;
const WARD_ROW = 26;

export function renderWards(ctx, settled = false) {
  const { pm, ward } = ctx;
  lastCtx = ctx;
  const all = wardLowShares(pm.latest, pm);
  const el0 = document.getElementById('ward-chart');
  const pager = document.getElementById('ward-pager');
  pager.hidden = false;                       // measured with the pager in place, hidden again if one page holds all
  const room = el0.clientHeight > 100 ? el0.clientHeight : 0;
  const per = room ? Math.max(6, Math.floor(room / WARD_ROW)) : all.length;
  const pages = Math.ceil(all.length / per);
  if (ward && ward !== pagedWard) { const i = all.findIndex((d) => d.ward === ward); if (i >= 0) wardPage = Math.floor(i / per); }
  pagedWard = ward;
  wardPage = Math.min(Math.max(0, wardPage), pages - 1);
  const rows = all.slice(wardPage * per, wardPage * per + per);
  pager.hidden = pages <= 1;
  document.getElementById('ward-range').textContent = `${wardPage * per + 1}–${wardPage * per + rows.length} of ${all.length} wards`;
  document.getElementById('ward-prev').disabled = wardPage === 0;
  document.getElementById('ward-next').disabled = wardPage >= pages - 1;
  if (!pagerWired) {
    pagerWired = true;
    document.getElementById('ward-prev').addEventListener('click', () => { wardPage--; renderWards(lastCtx); });
    document.getElementById('ward-next').addEventListener('click', () => { wardPage++; renderWards(lastCtx); });
  }
  const city = pm.latest.filter((r) => r.score <= pm.t10).length / pm.latest.length;
  const max = Math.max(city, d3.max(all, (d) => d.share)) * 1.05;
  const el = el0;
  const before = snapshot(el);
  el.innerHTML = rows.map((d) => `
    <button type="button" class="ward-row ${d.ward === ward ? 'active' : ''}" data-ward="${d.ward}" data-k="${d.ward}" aria-pressed="${d.ward === ward}"
      aria-label="Ward ${+d.ward} ${esc(d.name)}: ${d.low10} of ${d.n} buildings (${pct(d.share)}) in the lowest 10%"
      title="${d.low10} of ${d.n} buildings · median score ${d.median}">
      <span class="name">${esc(d.name)}</span>
      <span class="track" aria-hidden="true"><span class="fill" data-bar style="width:${(d.share / max) * 100}%"></span><span class="city" style="left:${(city / max) * 100}%"></span></span>
      <span class="val">${pct(d.share)}</span>
    </button>`).join('');
  play(before, el); // switching scoring system reorders the wards: rows slide to their new rank
  let foot = el.parentElement.querySelector('.ward-foot');
  if (!foot) { foot = document.createElement('div'); foot.className = 'ward-foot'; el.parentElement.appendChild(foot); }
  foot.innerHTML = `<span class="city-key" aria-hidden="true"></span> Citywide: ${pct(city)} of buildings are in the lowest 10%`;
  el.querySelectorAll('.ward-row').forEach((b) => b.addEventListener('click', () => ctx.setWard(b.dataset.ward === ward ? '' : b.dataset.ward)));

  // Key finding
  const low = pm.latest.filter((r) => r.score <= pm.t10);
  if (ward) {
    const d = all.find((x) => x.ward === ward);
    setFinding('q1-takeaway', d && {
      value: pct(d.share),
      caption: `of buildings in ${esc(d.name)} are in Toronto's lowest-scoring 10%`,
      text: `That's ${d.low10} of ${d.n} buildings, compared with ${pct(city)} citywide. This ward ranks ${all.indexOf(d) + 1} of ${all.length}.`,
    });
  } else {
    // The headline only uses wards with enough buildings for the share to be stable (the map marks the rest).
    const top3 = all.filter((d) => d.n >= SMALL_WARD).slice(0, 3);
    const top3Low = d3.sum(top3, (d) => d.low10), top3N = d3.sum(top3, (d) => d.n);
    setFinding('q1-takeaway', {
      value: `${(top3[0].share / city).toFixed(1)}×`,
      caption: `the citywide rate of low scorers, in ${esc(top3[0].name)}`,
      text: `Low scorers are <b>not spread evenly</b>. The three highest wards with at least ${SMALL_WARD} evaluated buildings (${top3.map((d) => esc(d.name)).join(', ')}) have ${pct(top3N / pm.latest.length)} of all buildings but ${pct(top3Low / low.length)} of the lowest-scoring ones.`,
    });
  }

  // Method note
  const share = (f) => pct(pm.latest.filter(f).length / pm.latest.length);
  const noCoord = pm.latest.filter((r) => r.lat == null).length;
  const derived = pm.latest.filter((r) => r.coordSource === 'derived-from-XY').length;
  document.getElementById('q1-method').innerHTML = `<ul>
    <li>Each building counts once, using its most recent evaluation in the ${pm.P.long}.</li>
    <li>“Lowest 10%” and “lowest 25%” are citywide cut-offs on those latest scores (${pm.t10} and ${pm.t25}). Buildings tied at a cut-off are included, so the groups hold ${share((r) => r.score <= pm.t10)} and ${share((r) => r.score <= pm.t25)} of buildings.</li>
    <li>Wards are assigned by the City in the RentSafeTO records (25-ward model). The vertical tick marks the citywide share. Wards with fewer than ${SMALL_WARD} evaluated buildings are listed, but left out of the key finding, because a few buildings move their share a lot.</li>
    <li>${fmt.n(noCoord)} building${noCoord === 1 ? ' has' : 's have'} no coordinates and can't be mapped, but still count in its ward. ${fmt.n(derived)} position${derived === 1 ? ' was' : 's were'} estimated from the dataset's X/Y grid columns because latitude/longitude were blank.</li>
  </ul>`;
  // the finding above the list is written after it was measured; if it took room, measure once more
  if (!settled && room && el.scrollHeight > el.clientHeight + 1) renderWards(ctx, true);
}
