// Building X-Ray: screen-space annotations.
//
// 3D anchor points are projected by the scene; this module places the HTML labels in two columns
// beside the model (never on top of each other), draws leader lines to the anchors, and hides labels
// whose anchors are off-screen or occluded. `layoutLabels` is pure and tested in Node.

const GAP = 8;
const PAD = 10;

// items: [{ key, x, y, w, h, side? }]  (x, y = projected anchor in px; w, h = label size)
// box:   { w, h, x0, x1 } = canvas size and the model's projected horizontal extent
// returns Map(key -> { lx, ly, side })
export function layoutLabels(items, box) {
  const out = new Map();
  if (!items.length) return out;
  const cx = Number.isFinite(box.x0) ? (box.x0 + box.x1) / 2 : box.w / 2;
  const sides = { left: [], right: [] };
  for (const it of items) sides[it.side ?? (it.x < cx ? 'left' : 'right')].push(it);
  // keep the columns balanced: move the items nearest the centre line across
  const balance = (from, to) => {
    while (sides[from].length > Math.ceil(items.length / 2) + 1) {
      sides[from].sort((a, b) => Math.abs(a.x - cx) - Math.abs(b.x - cx));
      sides[to].push(sides[from].shift());
    }
  };
  balance('left', 'right');
  balance('right', 'left');
  for (const side of ['left', 'right']) {
    const col = sides[side].sort((a, b) => a.y - b.y);
    const ys = col.map((it) => it.y - it.h / 2);
    for (let i = 0; i < col.length; i++) {               // push down to clear the label above
      ys[i] = Math.max(ys[i], PAD, i ? ys[i - 1] + col[i - 1].h + GAP : PAD);
    }
    for (let i = col.length - 1; i >= 0; i--) {          // then pull up from the bottom edge
      const limit = i === col.length - 1 ? box.h - PAD - col[i].h : ys[i + 1] - GAP - col[i].h;
      ys[i] = Math.max(PAD, Math.min(ys[i], limit));
    }
    // columns hug the model's projected outline, but never leave the canvas
    const x0 = Number.isFinite(box.x0) ? box.x0 : cx, x1 = Number.isFinite(box.x1) ? box.x1 : cx;
    col.forEach((it, i) => {
      const lx = side === 'left' ? Math.max(PAD, x0 - 18 - it.w) : Math.min(box.w - PAD - it.w, x1 + 18);
      out.set(it.key, { lx, ly: ys[i], side });
    });
  }
  return out;
}

export function createAnnotations(container, { onSelect, onHover }) {
  const layer = document.createElement('div');
  layer.className = 'xr-annot';
  layer.setAttribute('aria-hidden', 'true');   // the category list is the accessible equivalent
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'xr-leaders');
  layer.append(svg);
  container.append(layer);
  const els = new Map();

  function labelFor(key) {
    let el = els.get(key);
    if (el) return el;
    el = document.createElement('div');
    el.className = 'xr-label';
    el.dataset.zone = key;
    el.innerHTML = '<span class="xr-swatch" aria-hidden="true"></span><span class="xr-label-text"><b></b><small></small></span>';
    el.addEventListener('click', () => onSelect(key));
    el.addEventListener('pointerenter', () => onHover(key));
    el.addEventListener('pointerleave', () => onHover(null));
    layer.append(el);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', '3.5');
    svg.append(path, dot);
    el._leader = path;
    el._dot = dot;
    el._size = null;
    els.set(key, el);
    return el;
  }

  // items: [{ key, x, y, visible, title, sub, status, hot, selected, dim, compact }]
  function update(items, box) {
    svg.setAttribute('width', box.w);
    svg.setAttribute('height', box.h);
    const shown = [];
    for (const it of items) {
      const el = labelFor(it.key);
      const text = `${it.title}|${it.sub}|${it.compact}`;
      if (el._text !== text) {
        el.querySelector('b').textContent = it.title;
        el.querySelector('small').textContent = it.sub;
        el.classList.toggle('is-compact', !!it.compact);
        el._text = text;
        el._size = null;
      }
      el.querySelector('.xr-swatch').className = `xr-swatch s-${it.status}`;
      el.classList.toggle('is-hot', !!it.hot);
      el.classList.toggle('is-selected', !!it.selected);
      el.classList.toggle('is-dim', !!it.dim);
      if (!it.visible) { hide(el); continue; }
      el.hidden = false;
      if (!el._size) el._size = { w: el.offsetWidth || 120, h: el.offsetHeight || 36 };
      shown.push({ ...it, w: el._size.w, h: el._size.h });
    }
    for (const [key, el] of els) if (!items.some((i) => i.key === key)) hide(el);
    const pos = layoutLabels(shown, box);
    for (const it of shown) {
      const el = els.get(it.key), p = pos.get(it.key);
      el.style.transform = `translate(${Math.round(p.lx)}px, ${Math.round(p.ly)}px)`;
      const ax = p.side === 'left' ? p.lx + it.w : p.lx, ay = p.ly + it.h / 2;
      const bend = p.side === 'left' ? ax + 12 : ax - 12;
      el._leader.setAttribute('d', `M${ax},${ay} L${bend},${ay} L${it.x},${it.y}`);
      el._leader.setAttribute('class', `xr-leader${it.selected ? ' is-selected' : ''}${it.dim ? ' is-dim' : ''}`);
      el._dot.setAttribute('cx', it.x);
      el._dot.setAttribute('cy', it.y);
      el._dot.setAttribute('class', `xr-anchor${it.selected ? ' is-selected' : ''}${it.dim ? ' is-dim' : ''}`);
      el._leader.style.display = el._dot.style.display = '';
    }
  }
  function hide(el) { el.hidden = true; el._leader.style.display = el._dot.style.display = 'none'; }

  return { update, dispose() { layer.remove(); els.clear(); } };
}
