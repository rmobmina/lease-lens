// StoryController: runs "Beyond the Score" on top of the real workspace.
//
// Each chapter is a hash route (#/story/<id>), so Back/Forward and links work. Entering the story
// saves the reader's state (route, filters, selection, view settings); every chapter then applies
// its own temporary state (the current scoring system, citywide, its example building) and shows the
// real view. Leaving the story, by Exit or by following any link out, puts the saved state back.
//
// The panel docks beside the map: kicker + progress, headline, one or two sentences, the discovery,
// chapter actions, the transition question, Back / Next. Chapters move the real map (city, ward,
// building), open one analysis layer, or go down into the X-Ray and the comparison, through
// app.present(). Keys: ← and → (ignored while typing, inside the map or the 3D model).
// Reduced motion: no smooth scrolling or camera flights.

import { CHAPTERS, OPENING, chapterIndex } from './chapters.js';
import { drawVisual } from './visuals.js';
import { annotate, clearAnnotation } from './annotation.js';
import * as S from './selectors.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const KEEP = ['period', 'ward', 'selected', 'mapShow', 'lens', 'placeTab', 'problems', 'changes', 'movers', 'fp', 'xray'];

export function createStory(app) {
  let D = null;           // computed once per load (always the current scoring system, citywide)
  let saved = null;       // reader's state before the story
  let index = 0;
  const panel = document.getElementById('story-panel');

  function data() {
    if (D) return D;
    const pm = app.M.byPeriod.cur;
    const pair = S.examplePair(pm);
    // Chapter 5 follows the low-flag building of the pair; if it has fewer than two evaluations in
    // the current system, the other one (rule documented in selectors.js).
    let hist = S.historyIn(app.M, pair.b.rec.rsn, 'cur'), histRec = pair.b.rec;
    if (hist.inEra.length < 2) { const h2 = S.historyIn(app.M, pair.a.rec.rsn, 'cur'); if (h2.inEra.length >= 2) { hist = h2; histRec = pair.a.rec; } }
    hist.rsn = histRec.rsn;
    D = { pm, dist: S.scoreDistribution(pm), ward: S.wardContrast(pm), cats: S.categoryShares(pm), pair, hist, histRec, re: S.reinspections(pm) };
    return D;
  }

  const active = () => saved !== null;

  // ---- entering / leaving ----------------------------------------------------------------
  function enter(id, fromHash) {
    if (!active()) {
      saved = { hash: fromHash ?? '#/', state: structuredClone(Object.fromEntries(KEEP.map((k) => [k, app.state[k]]))) };
      document.body.classList.add('is-story');
      panel.hidden = false;
    }
    index = chapterIndex(id);
    show();
  }

  // Called by the router whenever the route is no longer a story chapter.
  function leave() {
    if (!active()) return;
    clearAnnotation();
    Object.assign(app.state, saved.state);
    saved = null;
    document.body.classList.remove('is-story');
    panel.hidden = true;
    panel.innerHTML = '';
    app.highlight = null;
    app.syncControls();
  }

  function exit() {
    // back to where the reader was; from the homepage, onto the map
    const to = saved?.hash && !saved.hash.startsWith('#/story') && saved.hash !== '#/' ? saved.hash : '#/explore';
    app.navigate(to);
  }

  function go(i) {
    const c = CHAPTERS[Math.max(0, Math.min(CHAPTERS.length - 1, i))];
    app.navigate(`#/story/${c.id}`);
  }

  // ---- one chapter ---------------------------------------------------------------------------
  function show() {
    const d = data();
    const c = CHAPTERS[index];
    clearAnnotation();
    // temporary state: current system, all of Toronto, then the chapter's own settings
    Object.assign(app.state, structuredClone(saved.state));
    Object.assign(app.state, { period: 'cur', ward: '', selected: null, mapShow: 'all', lens: c.lens ?? null, placeTab: 'summary' });
    c.apply?.(app.state, d);
    app.highlight = c.highlight ? c.highlight(d) : null;
    app.syncControls();
    renderPanel(c, d);
    app.present({ depth: c.depth, mapTo: c.mapTo?.(d), after: () => afterRender(c, d) });
  }

  function afterRender(c, d) {
    if (c.visual) drawVisual(c.visual, document.getElementById('story-visual'), d);
    if (c.focus) {
      const el = document.querySelector(c.focus);
      if (el) setTimeout(() => el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }), 120);
    }
    if (c.outline) setTimeout(() => document.querySelector(c.outline)?.classList.add('story-target'), 300);
    const a = c.annotate?.(d);
    if (a) setTimeout(() => annotate(a.target, a.text), c.focus ? 700 : 200);
  }

  function renderPanel(c, d) {
    const n = CHAPTERS.length;
    const discovery = c.discovery ? c.discovery(d) : '';
    panel.innerHTML = `
      <div class="story-top">
        <p class="story-kicker">Beyond the Score <button type="button" class="info-btn" data-info="story" aria-label="About this story">i</button></p>
        <button type="button" class="btn btn-sm btn-quiet story-exit" data-act="exit">Exit story</button>
      </div>
      <ol class="story-progress" aria-label="Story progress">
        ${CHAPTERS.map((ch, i) => `<li><a href="#/story/${ch.id}" ${i === index ? 'aria-current="step"' : ''} class="${i < index ? 'is-done' : ''}"><span class="visually-hidden">${ch.step}${i === index ? ' (current)' : ''}</span></a></li>`).join('')}
      </ol>
      <p class="story-step">${c.step}<span> · ${index + 1} of ${n}</span></p>
      ${index === 0 ? `<p class="story-question">${OPENING}</p>` : ''}
      <h1 class="story-title" id="story-title" tabindex="-1">${c.title(d)}</h1>
      <p class="story-text">${c.text(d)}</p>
      ${discovery ? `<div class="story-discovery"><p class="story-discovery-label">What the data shows</p><p>${discovery}</p></div>` : ''}
      ${c.actions ? `<div class="story-actions">${c.actions(d).map((a) => `<button type="button" class="btn btn-sm" data-act="action" data-id="${a.id}">${a.label}</button>`).join('')}</div>` : ''}
      ${c.next ? `<p class="story-next-q">${c.next}</p>` : ''}
      <div class="story-nav">
        <button type="button" class="btn" data-act="back" ${index === 0 ? 'disabled' : ''}>Back</button>
        ${c.final
          ? `<button type="button" class="btn btn-primary" data-act="final">${c.final.label}</button>`
          : `<button type="button" class="btn btn-primary" data-act="next">${c.nextLabel ?? (index === 0 ? 'Begin' : 'Next')}</button>`}
      </div>
      <button type="button" class="link-btn story-restart" data-act="restart" ${index === 0 ? 'hidden' : ''}>Restart story</button>`;
    panel.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'next') go(index + 1);
      if (act === 'back') go(index - 1);
      if (act === 'restart') go(0);
      if (act === 'exit') exit();
      if (act === 'final') finish();
      if (act === 'action') {
        const a = c.actions(d).find((x) => x.id === b.dataset.id);
        a?.run(api);
        b.setAttribute('aria-pressed', 'true');
      }
    }));
    panel.scrollTop = 0;
  }

  // Final action: leave the story (state restored) and hand over the map with the address search focused.
  function finish() {
    leave();
    app.navigate('#/explore');
    setTimeout(() => document.getElementById('search')?.focus(), 60);
  }

  // Chapter actions talk to the app through this small surface.
  const api = {
    setWard: (w) => { app.setWard(w); setTimeout(() => afterRender(CHAPTERS[index], data()), 400); },
    setXray: (patch) => { Object.assign(app.state.xray, patch); app.render(); },
  };

  // keyboard: ← / → between chapters
  document.addEventListener('keydown', (e) => {
    if (!active() || e.altKey || e.ctrlKey || e.metaKey || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    if (e.target.closest('input, select, textarea, [contenteditable], .leaflet-container, .xr-stage, .popover, [role=listbox]')) return;
    e.preventDefault();
    go(index + (e.key === 'ArrowRight' ? 1 : -1));
  });

  return {
    enter, leave, exit, active,
    focusTitle: () => document.getElementById('story-title')?.focus({ preventScroll: true }),
    data,
  };
}
