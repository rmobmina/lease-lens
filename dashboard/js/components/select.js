// Select: one application-styled dropdown for every choice list in LeaseLens (ward, comparison building,
// overall score). It replaces the operating system's popup, so the menu looks the same on every platform.
//
// Progressive enhancement over a real <select>: the native element stays in the page, hidden, as the source
// of truth. Choosing an option sets select.value and fires a normal "change" event, and assigning
// select.value from code updates the trigger, so existing listeners and state code keep working unchanged.
// Options added or replaced later (innerHTML) are picked up automatically.
//
// Accessibility follows the WAI-ARIA Authoring Practices combobox patterns:
//   - without search: a select-only combobox. Focus stays on the trigger (role=combobox), the active option
//     is announced through aria-activedescendant, and typing letters jumps to a matching option.
//   - with search: the trigger is a button (aria-haspopup=listbox); opening moves focus to a search field
//     (role=combobox, aria-autocomplete=list) that filters the listbox and owns aria-activedescendant.
// Keys: Enter / Space / ↓ / ↑ / Alt+↓ open; ↑ ↓ Home End PageUp PageDown move; Enter selects; Escape closes
// and returns focus to the trigger; Tab closes and moves on. Outside clicks close.
//
// The menu is a portal on <body> (position: fixed, the --z-popover layer), so map panes, Leaflet controls
// and overflow: hidden parents can't clip or cover it. It opens below the field, or above when there is more
// room there, never leaves the viewport, and follows the field while it is open. Only the list scrolls
// (overscroll-behavior: contain), never the page or the map. On narrow screens it becomes a bottom sheet.

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const NATIVE_VALUE = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
const LIST_MAX = 320;      // px: the list never grows taller than this
const GAP = 4;             // px between the field and the menu
const EDGE = 8;            // px kept free at the viewport edges
const SHEET_BELOW = 560;   // px: narrower viewports get a bottom sheet
let uid = 0;
let openOne = null;        // one menu open at a time

// "Etobicoke–Lakeshore" should match "etobicoke-lake", "Montréal" should match "montreal".
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[‐-―]/g, '-').toLowerCase().trim();

const CHEVRON = '<svg class="ll-select-chev" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 6l4 4 4-4"/></svg>';
const CHECK = '<svg class="ll-select-check" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.5 8.5l3 3 6-7"/></svg>';

export function enhanceSelect(select, { search = false, searchLabel = 'Search', placeholder = 'Search…', labelledBy = null, className = '' } = {}) {
  if (!select || select._ll) return select?._ll;
  const id = `ll-select-${++uid}`;
  const label = labelledBy ? document.getElementById(labelledBy) : select.closest('label')?.querySelector('.field-label');
  if (label && !label.id) label.id = `${id}-label`;

  // ---- the field ----------------------------------------------------------------------------------------------
  const wrap = document.createElement('div');
  wrap.className = `ll-select ${className}`.trim();
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'll-select-trigger';
  trigger.id = `${id}-trigger`;
  trigger.innerHTML = `<span class="ll-select-value"></span>${CHEVRON}`;
  if (search) trigger.setAttribute('aria-haspopup', 'listbox');
  else { trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox'); }
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', `${id}-list`);
  if (label) trigger.setAttribute('aria-labelledby', `${label.id} ${trigger.id}`);
  else if (select.getAttribute('aria-label')) trigger.setAttribute('aria-label', select.getAttribute('aria-label'));
  select.after(wrap);
  wrap.append(select, trigger);
  select.hidden = true;
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  // the wrapping <label> would focus the hidden select: send it to the trigger instead
  select.closest('label')?.addEventListener('click', (e) => { if (!wrap.contains(e.target) || e.target === select) { e.preventDefault(); trigger.focus(); } });

  // ---- the menu (portal) ----------------------------------------------------------------------------------------
  const pop = document.createElement('div');
  pop.className = `ll-select-pop ${className ? `${className}-pop` : ''}`.trim();
  pop.hidden = true;
  pop.innerHTML = `${search ? `<div class="ll-select-search"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
      <input type="text" id="${id}-search" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="${id}-list" aria-label="${searchLabel}" placeholder="${placeholder}" autocomplete="off" spellcheck="false" /></div>` : ''}
    <ul class="ll-select-list" id="${id}-list" role="listbox" tabindex="-1"${label ? ` aria-labelledby="${label.id}"` : ''}></ul>
    <p class="ll-select-empty" hidden>No matches</p>`;
  document.body.append(pop);
  const list = pop.querySelector('.ll-select-list');
  const input = pop.querySelector('input');
  const empty = pop.querySelector('.ll-select-empty');
  const owner = input ?? trigger;   // the element that holds focus and aria-activedescendant while open

  let items = [];       // [{ value, text, sub, disabled, el }]
  let visible = [];     // the items that pass the search filter
  let active = -1;      // index into visible
  let anim = null;
  let typed = '', typedAt = 0;

  // ---- options -----------------------------------------------------------------------------------------------
  function build() {
    items = [...select.options].map((o, i) => ({ value: o.value, text: o.textContent.trim(), sub: o.dataset.sub ?? '', disabled: o.disabled, i }));
    list.innerHTML = items.map((it) => `<li role="option" id="${id}-o${it.i}" class="ll-select-option" data-i="${it.i}" aria-selected="false"${it.disabled ? ' aria-disabled="true"' : ''}>
        ${CHECK}<span class="ll-select-text">${escapeHtml(it.text)}</span>${it.sub ? `<span class="ll-select-sub">${escapeHtml(it.sub)}</span>` : ''}</li>`).join('');
    items.forEach((it) => (it.el = list.children[it.i]));
    visible = items;
    sync();
  }
  function sync() {
    const cur = select.selectedIndex;
    const it = items[cur];
    trigger.querySelector('.ll-select-value').textContent = it ? it.text : '';
    trigger.title = it?.sub ? `${it.text} · ${it.sub}` : '';
    trigger.disabled = select.disabled;
    items.forEach((x) => x.el.setAttribute('aria-selected', String(x.i === cur)));
  }

  // value set from code (state restore, Back/Forward) updates the trigger too
  Object.defineProperty(select, 'value', {
    configurable: true,
    get() { return NATIVE_VALUE.get.call(this); },
    set(v) { NATIVE_VALUE.set.call(this, v); sync(); },
  });
  new MutationObserver((ms) => {
    if (ms.some((m) => m.type !== 'attributes')) { build(); if (isOpen()) { filter(); place(); } }
    else { sync(); if (select.disabled) close(false); }
  }).observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });

  // ---- open / close ------------------------------------------------------------------------------------------
  const isOpen = () => !pop.hidden && trigger.getAttribute('aria-expanded') === 'true';
  function open(start = 'selected') {
    if (isOpen() || select.disabled || !trigger.getClientRects().length) return;   // never from a hidden field
    if (openOne && openOne !== api) openOne.close(false);
    openOne = api;
    if (input) input.value = '';
    filter();
    pop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    wrap.classList.add('is-open');
    place();
    const sel = visible.findIndex((x) => x.i === select.selectedIndex);
    setActive(start === 'first' ? firstEnabled(1) : start === 'last' ? firstEnabled(-1) : sel >= 0 ? sel : firstEnabled(1), 'center');
    play(true);
    if (input) input.focus({ preventScroll: true });
    addGlobal();
  }
  function close(returnFocus = true) {
    if (!isOpen()) return;
    trigger.setAttribute('aria-expanded', 'false');
    wrap.classList.remove('is-open');
    owner.removeAttribute('aria-activedescendant');
    if (openOne === api) openOne = null;
    removeGlobal();
    play(false);
    if (returnFocus) trigger.focus({ preventScroll: true });
  }
  function play(show) {
    // Interruptible: a running animation is cancelled and the next one starts from where the menu visibly is.
    const from = anim ? { opacity: getComputedStyle(pop).opacity, transform: getComputedStyle(pop).transform } : null;
    anim?.cancel();
    anim = null;
    if (reduced()) { if (!show) pop.hidden = true; return; }
    const dy = pop.dataset.side === 'above' ? 4 : -4;
    const shut = { opacity: 0, transform: `translateY(${dy}px)` };
    const shown = { opacity: 1, transform: 'none' };
    const a = pop.animate(show ? [from ?? shut, shown] : [from ?? shown, shut],
      { duration: show ? 160 : 120, easing: show ? 'cubic-bezier(0.2, 0.7, 0.2, 1)' : 'cubic-bezier(0.4, 0, 1, 1)', fill: 'both' });
    anim = a;
    a.onfinish = () => { if (anim !== a) return; anim = null; a.cancel(); if (!show) pop.hidden = true; };
  }

  // ---- position: below the field if it fits, else wherever there is more room; never off-screen ----------------
  function place() {
    if (pop.hidden) return;
    const r = trigger.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    if (!r.width || r.bottom < 0 || r.top > vh) { close(false); return; }   // the field was hidden or scrolled away
    const sheet = vw < SHEET_BELOW;
    pop.classList.toggle('is-sheet', sheet);
    if (sheet) {
      pop.style.cssText = '';
      pop.dataset.side = 'above';
      list.style.maxHeight = `${Math.min(LIST_MAX + 80, Math.round(vh * 0.6))}px`;
      return;
    }
    const chrome = pop.offsetHeight - list.offsetHeight;          // search field + padding
    const below = vh - r.bottom - GAP - EDGE, above = r.top - GAP - EDGE;
    const want = Math.min(LIST_MAX, list.scrollHeight) + chrome;
    const side = below >= want || below >= above ? 'below' : 'above';
    const room = side === 'below' ? below : above;
    list.style.maxHeight = `${Math.max(96, Math.min(LIST_MAX, room - chrome))}px`;
    const width = Math.min(Math.max(r.width, pop.scrollWidth > r.width ? Math.min(pop.scrollWidth, 360) : r.width), vw - EDGE * 2);
    const left = Math.max(EDGE, Math.min(r.left, vw - width - EDGE));
    pop.style.width = `${Math.round(width)}px`;
    pop.style.left = `${Math.round(left)}px`;
    pop.dataset.side = side;
    if (side === 'below') { pop.style.top = `${Math.round(r.bottom + GAP)}px`; pop.style.bottom = ''; }
    else { pop.style.top = ''; pop.style.bottom = `${Math.round(vh - r.top + GAP)}px`; }
    pop.style.transformOrigin = side === 'below' ? 'top' : 'bottom';
  }

  // ---- filtering and the active option ---------------------------------------------------------------------------
  function filter() {
    const q = input ? norm(input.value) : '';
    visible = q ? items.filter((it) => norm(`${it.text} ${it.sub}`).includes(q)) : items;
    const set = new Set(visible);
    items.forEach((it) => (it.el.hidden = !set.has(it)));
    empty.hidden = visible.length > 0;
    if (input) input.setAttribute('aria-expanded', String(visible.length > 0));
    setActive(visible.length ? firstEnabled(1) : -1);
  }
  function firstEnabled(dir) {
    if (dir > 0) return visible.findIndex((x) => !x.disabled);
    for (let k = visible.length - 1; k >= 0; k--) if (!visible[k].disabled) return k;
    return -1;
  }
  function setActive(k, align = 'nearest') {
    items.forEach((x) => x.el.classList.remove('is-active'));
    active = k;
    const it = visible[k];
    if (!it) { owner.removeAttribute('aria-activedescendant'); return; }
    it.el.classList.add('is-active');
    owner.setAttribute('aria-activedescendant', it.el.id);
    // scroll the list only (never the page)
    const top = it.el.offsetTop, h = it.el.offsetHeight, st = list.scrollTop, lh = list.clientHeight;
    if (align === 'center') list.scrollTop = Math.max(0, top - (lh - h) / 2);
    else if (top < st) list.scrollTop = top;
    else if (top + h > st + lh) list.scrollTop = top + h - lh;
  }
  function move(by) {
    if (!visible.length) return;
    let k = active < 0 ? (by > 0 ? -1 : visible.length) : active;
    const step = Math.sign(by);
    let left = Math.abs(by);
    while (left > 0) {
      const n = k + step;
      if (n < 0 || n >= visible.length) break;
      k = n;
      if (!visible[k].disabled) left--;
    }
    if (visible[k] && !visible[k].disabled) setActive(k);
  }
  function choose(it) {
    if (!it || it.disabled) return;
    const changed = select.selectedIndex !== it.i;
    select.selectedIndex = it.i;
    sync();
    close(true);
    if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // select-only typeahead: letters typed within half a second build one search string
  function typeahead(ch) {
    const now = performance.now();
    typed = now - typedAt > 500 ? ch : typed + ch;
    typedAt = now;
    const q = norm(typed);
    const starts = (it) => norm(it.text).startsWith(q) || norm(it.text.split(/\s·\s/).pop()).startsWith(q);
    const from = active < 0 ? 0 : active + (typed.length === 1 ? 1 : 0);
    const order = [...visible.slice(from), ...visible.slice(0, from)];
    const hit = order.find((it) => !it.disabled && starts(it));
    if (hit) setActive(visible.indexOf(hit));
  }

  // ---- events ---------------------------------------------------------------------------------------------------
  trigger.addEventListener('click', () => (isOpen() ? close(true) : open()));
  trigger.addEventListener('keydown', (e) => {
    const k = e.key;
    if (!isOpen()) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { e.preventDefault(); open(); return; }
      if (k === 'Home' || k === 'End') { e.preventDefault(); open(k === 'Home' ? 'first' : 'last'); return; }
      if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && k !== ' ') {
        e.preventDefault();
        open();
        if (input) { input.value = k; filter(); } else typeahead(k);
      }
      return;
    }
    listKeys(e);   // select-only: focus stays on the trigger while open
  });
  input?.addEventListener('input', () => filter());
  input?.addEventListener('keydown', listKeys);
  function listKeys(e) {
    const k = e.key;
    if (k === 'ArrowDown') { e.preventDefault(); if (e.altKey) return; move(1); }
    else if (k === 'ArrowUp') { e.preventDefault(); if (e.altKey) { choose(visible[active]); return; } move(-1); }
    else if (k === 'PageDown') { e.preventDefault(); move(8); }
    else if (k === 'PageUp') { e.preventDefault(); move(-8); }
    else if (k === 'Home' && (!input || !input.value)) { e.preventDefault(); setActive(firstEnabled(1)); }
    else if (k === 'End' && (!input || !input.value)) { e.preventDefault(); setActive(firstEnabled(-1)); }
    else if (k === 'Enter' || (k === ' ' && !input)) { e.preventDefault(); choose(visible[active]); }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (k === 'Tab') {
      // close, and let Tab carry on from the field (the menu itself lives at the end of the page)
      close(false);
      trigger.focus({ preventScroll: true });
    } else if (!input && k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); typeahead(k); }
  }
  // pointer: hover moves the highlight; a click chooses. mousedown is prevented so focus never leaves the field.
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('pointermove', (e) => {
    const li = e.target.closest('.ll-select-option');
    if (!li) return;
    const k = visible.findIndex((x) => x.el === li);
    if (k !== active && !visible[k]?.disabled) setActive(k);
  });
  list.addEventListener('click', (e) => {
    const li = e.target.closest('.ll-select-option');
    if (li) choose(items[+li.dataset.i]);
  });

  const onDocDown = (e) => { if (!pop.contains(e.target) && !wrap.contains(e.target)) close(false); };
  const onReflow = () => place();
  const onScroll = (e) => { if (!pop.contains(e.target)) place(); };
  function addGlobal() {
    document.addEventListener('pointerdown', onDocDown, true);
    window.addEventListener('resize', onReflow);
    document.addEventListener('scroll', onScroll, true);
  }
  function removeGlobal() {
    document.removeEventListener('pointerdown', onDocDown, true);
    window.removeEventListener('resize', onReflow);
    document.removeEventListener('scroll', onScroll, true);
  }
  // A field that leaves the page (a view re-rendered) takes its menu with it.
  const gone = new MutationObserver(() => { if (!wrap.isConnected) { close(false); pop.remove(); gone.disconnect(); } });
  gone.observe(document.body, { childList: true, subtree: true });

  const api = { open, close, sync, el: wrap, trigger, pop };
  select._ll = api;
  build();
  return api;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Changing route closes whatever menu is open.
window.addEventListener('hashchange', () => openOne?.close(false));
