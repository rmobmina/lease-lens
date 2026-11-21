// StoryController: runs "Beyond the Score" on top of the real atlas.
//
// Each chapter is a hash route (#/story/<id>), so Back/Forward and links work. Entering the story
// saves the reader's state; each chapter applies its own temporary state (current scoring system,
// citywide, its example building) and shows ONE visual focus: the map, the X-Ray, the comparison, or a
// full-stage chart. Leaving the story, by Exit or by any link out, puts the saved state back.
//
// The caption floats in one fixed safe area (bottom-left; a bottom sheet on phones) and holds only:
// a header (the step counter "2/7" and the story's ⓘ on the left, Exit on the right), the step's question as
// its heading, a short answer in a few one-purpose blocks, at most one step action, an optional "detail" view
// (one analysis layer, opened on request and closed back into the step), and Back / Next. Nothing in the
// caption scrolls; every visual is sized to the stage. The caption is anchored at its bottom edge, so Back /
// Next never move; it is as tall as the step's own copy (no empty band under a short answer) and eases to
// the new height between steps. The stage keeps clear of the tallest step (--cap-h), so it never reflows.
//
// Every move goes through app.present(), which drops stale work when the reader changes step
// mid-animation (a newer step always wins): a flight, a chart waiting to draw, a highlight waiting for the
// camera, and any fade still running on the stage. Keys: ← / → between steps, Esc closes a detail view.

import { CHAPTERS, chapterIndex } from './chapters.js';
import { drawVisual } from './visuals.js';
import { clearAnnotation } from './annotation.js';
import { animate, DUR, reducedMotion } from '../motion.js';
import * as S from './selectors.js';

const KEEP = ['period', 'ward', 'selected', 'mapShow', 'lens', 'placeTab', 'problems', 'changes', 'movers', 'fp', 'xray'];

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
    document.body.classList.remove('is-story', 'story-detail', 'story-zone', 'story-items');
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
    document.body.classList.remove('story-zone', 'story-items');
    Object.assign(app.state, structuredClone(saved.state));
    Object.assign(app.state, { period: 'cur', ward: '', selected: null, mapShow: 'all', lens: null, placeTab: 'summary' });
    c.apply?.(app.state, d);
    app.highlight = c.highlight ? c.highlight(d) : null;
    app.syncControls();
    renderPanel(c, d);
    visual.getAnimations().forEach((a) => a.cancel()); // a fade from an earlier step never finishes over this one
    if (c.visual) visual.innerHTML = ''; // the previous step's chart never lingers under the new one
    app.present({ depth: c.depth, mapTo: c.mapTo?.(d), via: c.via?.(d), after: () => {
      // the highlight arrives once its area is on screen (the camera has landed, the stage has opened)
      if (c.reveal) { c.reveal(app.state, d); app.render(); }
      if (!c.visual) return;
      drawVisual(c.visual, visual, d, api);
      if (!reducedMotion()) visual.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DUR.panel, easing: 'ease-out' });
    } });
  }

  function renderPanel(c, d) {
    const n = CHAPTERS.length;
    const fromH = panel.offsetHeight;
    const step = c.steps?.(d).find((s) => !done.has(s.id));
    panel.innerHTML = `
      <div class="sc-top">
        <div class="sc-lead">
          <p class="sc-count" aria-hidden="true"><b>${index + 1}</b>/${n}</p>
          <button type="button" class="info-btn" data-info="story" aria-label="About this story and its data">i</button>
        </div>
        <button type="button" class="sc-exit" data-act="exit">Exit story <span aria-hidden="true">×</span></button>
      </div>
      <div class="sc-copy">
        <h1 class="sc-title" id="story-title" tabindex="-1"><span class="visually-hidden">Step ${index + 1} of ${n}: </span>${c.title(d)}</h1>
        ${copyBlocks(c, d)}
      </div>
      <div class="sc-foot">
        <div class="sc-act">
          ${step ? `<button type="button" class="sc-action" data-act="step" data-id="${step.id}">${step.label} <span aria-hidden="true">→</span></button>` : ''}
          ${c.detail ? `<button type="button" class="sc-detail" data-act="detail" aria-expanded="${detailOpen(c)}">${c.detail.label}</button>` : ''}
        </div>
        <div class="sc-nav">
          <button type="button" class="btn sc-back" data-act="back" aria-label="Previous step" ${index === 0 ? 'disabled' : ''}><span aria-hidden="true">←</span></button>
          ${c.final
            ? `<button type="button" class="btn btn-primary" data-act="final">${c.final.label}</button>`
            : `<button type="button" class="btn btn-primary" data-act="next">${index === 0 ? 'Begin' : 'Next'} <span aria-hidden="true">→</span></button>`}
        </div>
      </div>`;
    reserveCopy(d);
    // the caption eases to its new height; its bottom edge (and so Back / Next) stays put
    const toH = panel.offsetHeight;
    panel.getAnimations().forEach((a) => a.cancel());
    if (fromH && Math.abs(fromH - toH) > 1 && !reducedMotion()) {
      panel.animate([{ height: `${fromH}px`, overflow: 'hidden' }, { height: `${toH}px`, overflow: 'hidden' }], { duration: DUR.panel, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
    }
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

  // The answer as short blocks, one purpose each (chapters.js).
  const copyBlocks = (c, d) => [].concat(c.text(d)).map((t) => `<p class="sc-text">${t}</p>`).join('');

  // The tallest step's question and answer at the current width, text size and font, measured off-screen with
  // the real styles (re-measured whenever the width or a Display setting changes). The caption itself fits its
  // own step; this only sizes the stage's safe area (--cap-h), so the visual never reflows between steps.
  let reserveKey = '', reserveH = 0, reserveActH = 0;

  function reserveCopy(d) {
    const copy = panel.querySelector('.sc-copy');
    const de = document.documentElement;
    const key = `${panel.clientWidth}|${de.dataset.text}|${de.dataset.font}|${getComputedStyle(de).fontSize}`;
    if (key !== reserveKey && panel.clientWidth) {
      const probe = copy.cloneNode(false);
      Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', left: '0', top: '0', width: `${copy.clientWidth}px`, minHeight: '0' });
      panel.append(probe);
      reserveH = Math.max(...CHAPTERS.map((ch) => {
        probe.innerHTML = `<h1 class="sc-title">${ch.title(d)}</h1>${copyBlocks(ch, d)}`;
        return probe.offsetHeight;
      }));
      probe.remove();
      // the action row too: a step with both a step action and a detail link stacks two lines there, so every
      // step keeps room for two (the caption's height, and so the counter and Back / Next, never change)
      // (measured with the real labels at the row's real width)
      const act = panel.querySelector('.sc-act');
      reserveActH = 0;
      if (act) {
        const pa = act.cloneNode(false);
        Object.assign(pa.style, { position: 'absolute', visibility: 'hidden', left: '0', top: '0', width: `${act.clientWidth}px`, minHeight: '0' });
        panel.append(pa);
        for (const ch of CHAPTERS) {
          const step = ch.steps?.(d)[0];
          pa.innerHTML = `${step ? `<button type="button" class="sc-action">${step.label} <span aria-hidden="true">→</span></button>` : ''}${ch.detail ? `<button type="button" class="sc-detail">${ch.detail.label}</button>` : ''}`;
          reserveActH = Math.max(reserveActH, pa.offsetHeight);
        }
        pa.remove();
      }
      reserveKey = key;
    }
    // the caption fits its own step (copy and action row); the stage keeps clear of the tallest one
    const act = panel.querySelector('.sc-act');
    capH = Math.round(panel.offsetHeight - copy.offsetHeight - (act?.offsetHeight ?? 0) + Math.max(reserveH, copy.offsetHeight) + Math.max(reserveActH, act?.offsetHeight ?? 0));
  }
  let capH = 0;

  // A detail is either one analysis layer (detail.lens) or a closer view of the chapter's own visual
  // (detail.toggle: a body class, e.g. the comparison's full item grids).
  const detailOpen = (c) => (c.detail.toggle ? document.body.classList.contains(c.detail.toggle) : app.state.lens === c.detail.lens);
  function toggleDetail(c) {
    // a closer view of the chapter's own visual: redraw it now that it has room (charts measure their box)
    if (c.detail.toggle) { document.body.classList.toggle(c.detail.toggle); app.render(); }
    else app.openDetail(app.state.lens === c.detail.lens ? null : c.detail.lens);
    panel.querySelector('[data-act=detail]')?.setAttribute('aria-expanded', String(detailOpen(c)));
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
    if (panel.querySelector('.sc-copy')) reserveCopy(data());
    document.body.style.setProperty('--cap-w', `${Math.round(panel.offsetWidth)}px`);
    document.body.style.setProperty('--cap-h', `${Math.max(capH, Math.round(panel.offsetHeight))}px`);
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
    if (e.key === 'Escape' && document.body.classList.contains('story-items')) { e.preventDefault(); document.body.classList.remove('story-items'); panel.querySelector('[data-act=detail]')?.setAttribute('aria-expanded', 'false'); panel.querySelector('[data-act=detail]')?.focus(); return; }
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
