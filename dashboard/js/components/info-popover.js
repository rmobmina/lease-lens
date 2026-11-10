// InfoPopover: one reusable "i" explanation, used everywhere on the site.
//
// Level 1 (always visible) is the page text. Level 2 lives here: a short explanation behind an
// <button class="info-btn" data-info="key">. Level 3 (full methodology) is a link from the popover
// to the method notes or the About page.
//
// Behaviour: opens on click/tap/Enter/Space (never on hover alone), closes on Escape, outside click
// or a second press, returns focus to its button, flips and clamps to stay inside the viewport, and
// is announced as a non-modal dialog named by its title. One popover is open at a time.
//
// Content comes from content/info.js. A button may also name a hidden element with data-info-from:
// that element's current text is shown (used where a view computes its own explanation).

import { INFO } from '../content/info.js';

let pop, current = null;

function ensure() {
  if (pop) return pop;
  pop = document.createElement('div');
  pop.className = 'popover';
  pop.id = 'info-popover';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'false');
  pop.setAttribute('aria-labelledby', 'info-popover-title');
  pop.tabIndex = -1;
  pop.hidden = true;
  document.body.append(pop);
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(true); } });
  return pop;
}

function contentFor(btn) {
  const key = btn.dataset.info;
  const base = INFO[key] ?? { title: btn.getAttribute('aria-label') || 'About this', body: '' };
  const from = btn.dataset.infoFrom && document.getElementById(btn.dataset.infoFrom);
  const extra = from && from.innerHTML.trim() ? `<p>${from.innerHTML}</p>` : '';
  return { ...base, body: (base.body || '') + extra };
}

export function open(btn) {
  ensure();
  if (current === btn) { close(true); return; }
  if (current) close(false);
  const c = contentFor(btn);
  pop.innerHTML = `<div class="popover-head"><p class="popover-title" id="info-popover-title">${c.title}</p>
      <button type="button" class="popover-close" aria-label="Close">×</button></div>
    <div class="popover-body">${c.body}</div>
    ${c.more ? `<p class="popover-more"><a href="${c.more.href}">${c.more.label}</a></p>` : ''}`;
  pop.querySelector('.popover-close').addEventListener('click', () => close(true));
  pop.querySelectorAll('.popover-more a').forEach((a) => a.addEventListener('click', () => close(false)));
  pop.hidden = false;
  current = btn;
  btn.setAttribute('aria-expanded', 'true');
  btn.setAttribute('aria-controls', pop.id);
  place();
  pop.focus({ preventScroll: true });
}

export function close(returnFocus) {
  if (!current) return;
  const btn = current;
  current = null;
  pop.hidden = true;
  btn.setAttribute('aria-expanded', 'false');
  if (returnFocus && btn.isConnected) btn.focus({ preventScroll: true });
}

export const isOpen = () => !!current;

// Below the button if it fits, otherwise above; clamped horizontally to the viewport (8px gutter).
function place() {
  if (!current) return;
  const b = current.getBoundingClientRect();
  if (!b.width && !b.height) { close(false); return; }
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  pop.style.maxWidth = `${Math.min(340, vw - 16)}px`;
  pop.style.left = '0px'; pop.style.top = '0px';
  const p = pop.getBoundingClientRect();
  let left = b.left + b.width / 2 - p.width / 2;
  left = Math.max(8, Math.min(left, vw - p.width - 8));
  let top = b.bottom + 8;
  const above = b.top - 8 - p.height;
  pop.dataset.side = 'below';
  if (top + p.height > vh - 8 && above >= 8) { top = above; pop.dataset.side = 'above'; }
  top = Math.max(8, Math.min(top, vh - p.height - 8));
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

export function initInfoPopovers() {
  ensure();
  // Every button gets the same state attributes, including ones added to the page later.
  const prep = (root) => root.querySelectorAll?.('.info-btn[data-info]:not([aria-expanded])').forEach((b) => {
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-haspopup', 'dialog');
  });
  prep(document);
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && prep(n)))).observe(document.body, { childList: true, subtree: true });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.info-btn[data-info]');
    if (btn) { e.preventDefault(); e.stopPropagation(); open(btn); return; }
    if (current && !pop.contains(e.target)) close(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current) { e.stopPropagation(); close(true); }
  }, true);
  window.addEventListener('resize', place);
  // Scrolling inside the app moves the button: follow it, or close if it scrolls out of view.
  document.addEventListener('scroll', () => {
    if (!current) return;
    const b = current.getBoundingClientRect();
    if (b.bottom < 0 || b.top > window.innerHeight) close(false); else place();
  }, true);
  window.addEventListener('hashchange', () => close(false));
}
