// Ward comparison (an analysis layer of the Explore map): the share of each ward's buildings in the
// citywide lowest 10%, as a ranked list against the citywide share. It is the text-and-keyboard
// equivalent of the ward choropleth; selecting a row selects that ward on the map.
// The map itself is ../atlas/map.js.

import { wardLowShares } from '../model.js';
import { SMALL_WARD } from '../atlas/logic.js';
import { pct, fmt, esc, setFinding } from '../ui.js';

export function renderWards(ctx) {
  const { pm, ward } = ctx;
  const rows = wardLowShares(pm.latest, pm);
  const city = pm.latest.filter((r) => r.score <= pm.t10).length / pm.latest.length;
  const max = Math.max(city, d3.max(rows, (d) => d.share)) * 1.05;
  const el = document.getElementById('ward-chart');
  el.innerHTML = rows.map((d) => `
    <button type="button" class="ward-row ${d.ward === ward ? 'active' : ''}" data-ward="${d.ward}" aria-pressed="${d.ward === ward}"
      aria-label="Ward ${+d.ward} ${esc(d.name)}: ${d.low10} of ${d.n} buildings (${pct(d.share)}) in the lowest 10%"
      title="${d.low10} of ${d.n} buildings · median score ${d.median}">
      <span class="name">${esc(d.name)}</span>
      <span class="track" aria-hidden="true"><span class="fill" style="width:${(d.share / max) * 100}%"></span><span class="city" style="left:${(city / max) * 100}%"></span></span>
      <span class="val">${pct(d.share)}</span>
    </button>`).join('');
  let foot = el.parentElement.querySelector('.ward-foot');
  if (!foot) { foot = document.createElement('div'); foot.className = 'ward-foot'; el.parentElement.appendChild(foot); }
  foot.innerHTML = `<span class="city-key" aria-hidden="true"></span> Citywide: ${pct(city)} of buildings are in the lowest 10%`;
  el.querySelectorAll('.ward-row').forEach((b) => b.addEventListener('click', () => ctx.setWard(b.dataset.ward === ward ? '' : b.dataset.ward)));

  // Key finding
  const low = pm.latest.filter((r) => r.score <= pm.t10);
  if (ward) {
    const d = rows.find((x) => x.ward === ward);
    setFinding('q1-takeaway', d && {
      value: pct(d.share),
      caption: `of buildings in ${esc(d.name)} are in Toronto's lowest-scoring 10%`,
      text: `That's ${d.low10} of ${d.n} buildings, compared with ${pct(city)} citywide. This ward ranks ${rows.indexOf(d) + 1} of ${rows.length}.`,
    });
  } else {
    // The headline only uses wards with enough buildings for the share to be stable (the map marks the rest).
    const top3 = rows.filter((d) => d.n >= SMALL_WARD).slice(0, 3);
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
}
