// Chart motion: meaning-preserving updates for charts that redraw from scratch.
//
// The analysis charts rebuild their SVG on every render (a filter, a ward, a theme change, a map move).
// Rebuilding is simple and keeps the drawing code readable, but on its own it makes every update a jump.
// This module adds continuity without changing how the charts draw (a FLIP technique):
//
//   const before = snapshot(root);    // just before the old chart is removed
//   ... draw the new chart ...
//   play(before, root);               // the new marks start where the old ones were and settle
//
// Marks opt in with attributes: a row/group carries data-k (a stable key: the item, ward or bin), its bar
// carries data-bar, its value label data-val. Rows that moved slide to their new place, bars grow or
// shrink from their baseline, labels travel with the bar end, new rows fade in. If nothing changed,
// nothing moves, so the frequent re-renders that only repeat the same data are invisible.
// A resized container is not a data change: it redraws without motion. Reduced motion: no animation.

const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const box = (n) => n?.getBoundingClientRect();

export function snapshot(root) {
  if (!root) return null;
  const marks = new Map();
  root.querySelectorAll('[data-k]').forEach((n) => {
    const r = box(n), bar = box(n.hasAttribute('data-bar') ? n : n.querySelector('[data-bar]')), val = box(n.querySelector('[data-val]'));
    marks.set(n.dataset.k, { top: r.top, left: r.left, bar, val });
  });
  return { width: root.clientWidth, marks };
}

// CSS transforms replace an SVG element's transform attribute, so a row's own translate(x,y) is carried
// into the animation's keyframes.
function baseTranslate(n) {
  const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(n.getAttribute?.('transform') ?? '');
  return m ? [+m[1], +m[2]] : null;
}

export function play(before, root, { duration = 360 } = {}) {
  if (!before || !root || reduced() || !before.marks.size) return;
  if (Math.abs(before.width - root.clientWidth) > 1) return; // a resize, not a data change
  const opts = { duration, easing: EASE };
  root.querySelectorAll('[data-k]').forEach((n) => {
    const p = before.marks.get(n.dataset.k);
    if (!p) { n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE, delay: 80, fill: 'backwards' }); return; }
    const self = n.hasAttribute('data-bar'); // a bar that is its own mark (histogram): it only resizes
    const r = box(n);
    const dx = self ? 0 : p.left - r.left, dy = self ? 0 : p.top - r.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      const t = baseTranslate(n);
      const to = t ? `translate(${t[0]}px, ${t[1]}px)` : 'none';
      const from = t ? `translate(${t[0] + dx}px, ${t[1] + dy}px)` : `translate(${dx}px, ${dy}px)`;
      n.animate([{ transform: from }, { transform: to }], opts);
    }
    const barEl = self ? n : n.querySelector('[data-bar]');
    if (barEl && p.bar) {
      const b = box(barEl);
      const horizontal = Math.abs(b.height - p.bar.height) < 0.5;
      const prev = horizontal ? p.bar.width : p.bar.height, now = horizontal ? b.width : b.height;
      if (now > 0.5 && Math.abs(prev - now) > 0.5) {
        // grow from whichever end stayed put (the baseline)
        const origin = horizontal
          ? (Math.abs(p.bar.left - b.left - dx) < 1 ? '0% 50%' : '100% 50%')
          : (Math.abs(p.bar.bottom - b.bottom - dy) < 1 ? '50% 100%' : '50% 0%');
        barEl.style.transformBox = 'fill-box';
        barEl.style.transformOrigin = origin;
        const s = Math.max(0, prev / now);
        barEl.animate([{ transform: horizontal ? `scaleX(${s})` : `scaleY(${s})` }, { transform: 'none' }], opts);
      }
    }
    const valEl = n.querySelector('[data-val]');
    if (valEl && p.val) {
      const v = box(valEl);
      const vx = p.val.left - v.left - dx, vy = p.val.top - v.top - dy;
      if (Math.abs(vx) > 0.5 || Math.abs(vy) > 0.5) valEl.animate([{ transform: `translate(${vx}px, ${vy}px)` }, { transform: 'none' }], opts);
    }
  });
}
