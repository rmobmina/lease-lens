// StoryAnnotation: a short callout pinned next to a mark in a workspace view (a ward row, the
// history chart). It follows its target while the page scrolls or resizes, hides when the target is
// out of view, and is hidden from assistive technology because the same sentence is in the story panel.

let note = null, target = null, raf = 0;

export function annotate(selector, text, { tries = 40 } = {}) {
  clearAnnotation();
  const find = (left) => {
    const el = document.querySelector(selector);
    if (!el) { if (left > 0) raf = requestAnimationFrame(() => setTimeout(() => find(left - 1), 60)); return; }
    target = el;
    note = document.createElement('div');
    note.className = 'story-annot';
    note.setAttribute('aria-hidden', 'true');
    note.textContent = text;
    document.body.append(note);
    target.classList.add('story-target');
    place();
  };
  find(tries);
}

function place() {
  if (!note || !target) return;
  if (!target.isConnected) { clearAnnotation(); return; }
  const r = target.getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const visible = r.bottom > 0 && r.top < vh && r.width > 0;
  note.hidden = !visible;
  if (!visible) return;
  const n = note.getBoundingClientRect();
  let top = r.top - n.height - 8;
  if (top < 8) top = r.bottom + 8;
  const left = Math.max(8, Math.min(r.left + Math.min(r.width, 280) / 2 - n.width / 2, vw - n.width - 8));
  note.style.left = `${Math.round(left)}px`;
  note.style.top = `${Math.round(top)}px`;
}

export function clearAnnotation() {
  cancelAnimationFrame(raf);
  target?.classList.remove('story-target');
  note?.remove();
  note = null; target = null;
}

window.addEventListener('resize', place);
document.addEventListener('scroll', place, true);
