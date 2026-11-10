// HomePage: the public entry layer. The copy and actions are plain HTML (usable immediately);
// the Toronto atlas is lazy: the static SVG fallback paints first, then the canvas version loads
// after the page is idle and replaces it without changing the layout.

import { cssVar } from '../ui.js';

let atlas = null, mounting = false, onPickCb = null;

const colors = () => ({
  bg: cssVar('--atlas-bg'), road: cssVar('--atlas-road'), shore: cssVar('--atlas-shore'),
  line: cssVar('--atlas-line'), fill: cssVar('--atlas-fill'),
  rental: cssVar('--atlas-rental'), rentalFill: cssVar('--atlas-rental-fill'), rentalFillHover: cssVar('--atlas-rental-hover'),
  labelInk: cssVar('--atlas-label'), font: cssVar('--font-ui') || 'system-ui',
});

export function initHome({ onPick } = {}) {
  onPickCb = onPick;
  const btn = document.getElementById('site-menu-btn');
  const nav = document.getElementById('site-nav');
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('open', open);
  });
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) { btn.setAttribute('aria-expanded', 'false'); nav.classList.remove('open'); } });
  document.addEventListener('themechange', () => atlas?.restyle());
}

export function showHome() {
  if (atlas || mounting) return;
  mounting = true;
  const host = document.getElementById('atlas-stage');
  const start = async () => {
    try {
      const canvas = document.createElement('canvas');
      if (!canvas.getContext || !canvas.getContext('2d')) throw new Error('no canvas');
      const { mountHeroAtlas } = await import('./hero-atlas.js');
      atlas = await mountHeroAtlas(host, {
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        colors,
        onPick: (r) => onPickCb?.(r),
        onReady: () => host.classList.add('is-live'),
      });
    } catch (err) {
      // The static drawing stays: same projection, fewer buildings.
      console.warn('Hero atlas unavailable, showing the static drawing.', err);
      host.classList.add('is-static');
    }
  };
  if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 600 }); else setTimeout(start, 120);
}
