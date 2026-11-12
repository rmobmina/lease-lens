// Small presentation helpers shared by the dashboard sections.
// Reuses the explorer's tooltip, number formats and deterministic hash (window.LLC from explorer/js/charts.js).

export const { fmt, tip, hash } = LLC;
export const pct = (v, digits = 0) => (v == null || !isFinite(v) ? '–' : `${(v * 100).toFixed(digits)}%`);
export const signed = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0');
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const titleCase = (s) => String(s ?? '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
export const formatDate = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }) : '–');

// Tooltip that works for mouse and keyboard: on focus it anchors to the element's box.
export function bindTooltip(selection, html) {
  selection
    .on('mouseenter.tt', (ev, d) => tip.show(html(d), ev))
    .on('mousemove.tt', (ev) => tip.move(ev))
    .on('mouseleave.tt', () => tip.hide())
    .on('focus.tt', function (ev, d) { tip.show(html(d), anchorEvent(this)); })
    .on('blur.tt', () => tip.hide());
}
export function anchorEvent(node) {
  const b = node.getBoundingClientRect();
  return { clientX: b.left + Math.min(b.width, 240), clientY: b.top + b.height / 2 };
}

// Building tooltip: address, score, ward, evaluation date, year built.
export function buildingTip(r, extra = '') {
  const rows = [
    ['Score', `<b>${r.score}</b> / 100`],
    ['Ward', `${r.ward} · ${esc(r.wardName)}`],
    ['Evaluated', formatDate(r.date)],
    ['Built', r.yearBuilt ?? 'not recorded'],
    ['Size', `${r.storeys ?? '–'} storeys · ${r.units ?? '–'} units`],
  ];
  return `<div class="tt-title">${esc(titleCase(r.address))}</div>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>${extra}`;
}

// Responsive SVG: width follows the container, drawn in CSS pixels.
export function svgIn(container, height, label) {
  const width = Math.max(260, container.clientWidth - (parseFloat(getComputedStyle(container).paddingLeft) || 0) * 2);
  const svg = d3.select(container).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`).attr('width', width).attr('height', height)
    .attr('role', 'img').attr('aria-label', label);
  return { svg, width, height };
}

export const legendKey = (color, label, kind = '') => `<span class="key"><span class="swatch ${kind}" style="background:${color}"></span>${label}</span>`;
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// The one finding of an analysis layer (level 1): the number and what it measures, nothing more.
// The sentence of interpretation (level 2) goes to the top of that layer's "How to read this" disclosure,
// next to the method (level 3), so the default view is title, chart and one finding.
export function setFinding(id, f) {
  const node = document.getElementById(id);
  if (!node) return;
  node.innerHTML = f ? `<p class="finding-value">${f.value}</p><p class="finding-caption">${f.caption}</p>` : '';
  const det = node.closest('.lens-view, section')?.querySelector('details.method');
  if (!det) return;
  let lead = det.querySelector('.method-lead');
  if (!lead) { lead = document.createElement('p'); lead.className = 'method-lead'; det.querySelector('summary').after(lead); }
  lead.innerHTML = f?.text ?? '';
  lead.hidden = !f?.text;
}

export function empty(container, msg) {
  container.innerHTML = `<p class="empty">${msg}</p>`;
}
