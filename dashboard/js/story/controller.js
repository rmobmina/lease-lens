// StoryController: runs "Beyond the Score" on top of the real atlas.
//
// Each chapter is a hash route (#/story/<id>), so Back/Forward and links work. Entering the story
// saves the reader's state; each chapter applies its own temporary state (current scoring system,
// citywide, its example building) and shows ONE visual focus: the map, the X-Ray, the comparison, or a
// full-stage chart. Leaving the story, by Exit or by any link out, puts the saved state back.
//
// The caption floats in one fixed safe area (bottom-left; a bottom sheet on phones) and holds only:
// "02 / 07", the headline, a 30–50-word narration with the one finding, at most one chapter action,
// an optional "detail" view (one analysis layer, opened on request and closed back into the chapter),
// and Back / Next / Exit. Nothing in the caption scrolls; every visual is sized to the stage.
//
// Every move goes through app.present(), which drops stale work when the reader changes chapter
// mid-animation (a newer chapter always wins). Keys: ← / → between chapters, Esc closes a detail view.

import { CHAPTERS, chapterIndex } from './chapters.js';
import { drawVisual } from './visuals.js';
import { clearAnnotation } from './annotation.js';
import { animate, DUR } from '../motion.js';
import * as S from './selectors.js';

const KEEP = ['period', 'ward', 'selected', 'mapShow', 'lens', 'placeTab', 'problems', 'changes', 'movers', 'fp', 'xray'];
const pad = (n) => String(n).padStart(2, '0');

export function createStory(app) {
  let D = null;           // computed once per load (always the current scoring system, citywide)
  let saved = null;       // reader's state before the story
  let index = 0;
  let done = new Set();   // chapter steps already taken (they reveal the next one)
  const panel = document.getElementById('story-panel');
  const visual = document.getElementById('story-visual');

  function data() {
    if (D) return D;
    const pm = app.M.byPeriod.cur;
    const pair = S.examplePair(pm);
    // The history chapter follows the low-flag building of the pair; if it has fewer than two
    // evaluations in the current system, the other one (rule documented in selectors.js).
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
    document.body.classList.remove('is-story', 'story-detail', 'story-zone');
    panel.hidden = true;
    panel.innerHTML = '';
    app.highlight = null;
    app.syncControls();
  }

  function exit() {
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
    done = new Set();
    document.body.classList.remove('story-zone');
    Object.assign(app.state, structuredClone(saved.state));
    Object.assign(app.state, { period: 'cur', ward: '', selected: null, mapShow: 'all', lens: null, placeTab: 'summary' });
    c.apply?.(app.state, d);
    app.highlight = c.highlight ? c.highlight(d) : null;
    app.syncControls();
    renderPanel(c, d);
    if (c.visual) visual.innerHTML = ''; // the previous chapter's chart never lingers under the new one
    app.present({ depth: c.depth, mapTo: c.mapTo?.(d), via: c.via?.(d), after: () => { if (c.visual) drawVisual(c.visual, visual, d, api); } });
  }

  function renderPanel(c, d) {
    const n = CHAPTERS.length;
    const step = c.steps?.(d).find((s) => !done.has(s.id));
    panel.innerHTML = `
      <div class="sc-top">
        <p class="sc-count"><span class="visually-hidden">Chapter </span>${pad(index + 1)}<span aria-hidden="true"> / </span><span class="visually-hidden"> of </span>${pad(n)}</p>
        <p class="sc-name">Beyond the Score <button type="button" class="info-btn" data-info="story" aria-label="About this story and its data">i</button></p>
        <button type="button" class="sc-exit" data-act="exit">Exit story <span aria-hidden="true">×</span></button>
      </div>
      <h1 class="sc-title" id="story-title" tabindex="-1">${c.title(d)}</h1>
      <p class="sc-text">${c.text(d)}</p>
      <div class="sc-foot">
        <div class="sc-act">
          ${step ? `<button type="button" class="sc-action" data-act="step" data-id="${step.id}">${step.label} <span aria-hidden="true">→</span></button>` : ''}
          ${c.detail ? `<button type="button" class="sc-detail" data-act="detail" aria-expanded="${app.state.lens === c.detail.lens}">${c.detail.label}</button>` : ''}
        </div>
        <div class="sc-nav">
          <button type="button" class="btn sc-back" data-act="back" aria-label="Previous chapter" ${index === 0 ? 'disabled' : ''}><span aria-hidden="true">←</span></button>
          ${c.final
            ? `<button type="button" class="btn btn-primary" data-act="final">${c.final.label}</button>`
            : `<button type="button" class="btn btn-primary" data-act="next">${index === 0 ? 'Begin' : 'Next'} <span aria-hidden="true">→</span></button>`}
        </div>
      </div>`;
    panel.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'next') go(index + 1);
      if (act === 'back') go(index - 1);
      if (act === 'exit') exit();
      if (act === 'final') finish();
      if (act === 'detail') toggleDetail(c);
      if (act === 'step') {
        const s = c.steps(d).find((x) => x.id === b.dataset.id);
        s?.run(api);
        done.add(s.id);
        renderPanel(c, d);
        panel.querySelector('[data-act=step], [data-act=next], [data-act=final]')?.focus({ preventScroll: true });
      }
    }));
    // the caption's content settles in place (its box never moves, so nothing shifts)
    const body = [...panel.children];
    animate('caption', {
      duration: DUR.panel,
      step: (e) => body.forEach((el, i) => { el.style.opacity = String(Math.min(1, e * 1.4 - i * 0.08)); el.style.transform = `translateY(${(1 - e) * 6}px)`; }),
      done: () => body.forEach((el) => { el.style.opacity = ''; el.style.transform = ''; }),
    });
  }

  function toggleDetail(c) {
    app.openDetail(app.state.lens === c.detail.lens ? null : c.detail.lens);
    panel.querySelector('[data-act=detail]')?.setAttribute('aria-expanded', String(app.state.lens === c.detail.lens));
  }

  // Final action: leave the story (state restored) and hand over the map with the address search focused.
  function finish() {
    leave();
    app.navigate('#/explore');
    requestAnimationFrame(() => document.getElementById('search')?.focus());
  }

  // Chapter actions talk to the app through this small surface.
  const api = {
    setXray: (patch) => { Object.assign(app.state.xray, patch); document.body.classList.toggle('story-zone', !!app.state.xray.zone); app.render(); },
    inspect: (rsn, uid) => app.inspect(rsn, uid),
  };

  // The caption's real size is the safe area every visual keeps clear of (story.css --cap-w / --cap-h).
  new ResizeObserver(() => {
    if (panel.hidden) return;
    document.body.style.setProperty('--cap-w', `${Math.round(panel.offsetWidth)}px`);
    document.body.style.setProperty('--cap-h', `${Math.round(panel.offsetHeight)}px`);
  }).observe(panel);

  // Full-stage visuals follow the size of the stage (window resize, rotation, zoom).
  let rt = 0, lastSize = '';
  new ResizeObserver(() => {
    const size = `${visual.clientWidth}x${visual.clientHeight}`;
    if (!active() || size === lastSize || !visual.clientWidth) return;
    lastSize = size;
    cancelAnimationFrame(rt);
    rt = requestAnimationFrame(() => { const c = CHAPTERS[index]; if (c.visual && app.state.depth === 'story') drawVisual(c.visual, visual, data(), api); });
  }).observe(visual);

  document.addEventListener('keydown', (e) => {
    if (!active() || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape' && app.state.lens) { e.preventDefault(); app.openDetail(null); panel.querySelector('[data-act=detail]')?.focus(); return; }
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    if (e.target.closest('input, select, textarea, [contenteditable], .leaflet-container, .xr-stage, .popover, [role=listbox], .lens')) return;
    e.preventDefault();
    go(index + (e.key === 'ArrowRight' ? 1 : -1));
  });

  return {
    enter, leave, exit, active,
    focusTitle: () => document.getElementById('story-title')?.focus({ preventScroll: true }),
    data,
  };
}
