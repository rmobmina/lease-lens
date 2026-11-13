// Regression tests for the final design pass: the rules behind what the new views claim, run against
// the real data where the claim is about the data.
//   - the paired inspection profile (Same score, different story): shares, one shared scale, and which
//     differences it emphasises
//   - theme start-up: the saved theme is applied before first paint, and bad or blocked storage is harmless
//   - every ⓘ button on the site has an accessible name and an explanation to show
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as d3 from 'd3';
import { loadData } from './load-data.mjs';

let pm, S, F, M, layout;
before(async () => {
  const data = await loadData();
  globalThis.d3 = d3;
  const { buildModel, itemLabel } = await import('../dashboard/js/model.js');
  S = await import('../dashboard/js/story/selectors.js');
  F = await import('../dashboard/js/fingerprint-model.js');
  M = buildModel(data);
  pm = M.byPeriod.cur;
  layout = F.itemStats(pm.latest, pm.cats, itemLabel);
});

const profileOf = (rec) => F.buildingProfile(rec, layout);

test('paired profile: each row is the share of that area’s rated items rated 0 or 1, recomputed from the raw ratings', () => {
  const { a, b } = S.examplePair(pm);
  const { rows, domain } = F.pairedProfile(profileOf(a.rec), profileOf(b.rec));
  assert.equal(rows.length, F.FP_GROUPS.length, 'one row per inspection area, the same rows for both buildings');
  for (const [i, g] of F.FP_GROUPS.entries()) {
    for (const [side, rec] of [['a', a.rec], ['b', b.rec]]) {
      const rated = g.items.filter((c) => rec.ratings[c] != null);
      const low = rated.filter((c) => rec.ratings[c] <= 1);
      const row = rows[i][side];
      assert.equal(row.rated, rated.length, `${g.key} ${side}: rated items`);
      assert.equal(row.low, low.length, `${g.key} ${side}: items rated 0 or 1`);
      assert.equal(row.share, rated.length ? low.length / rated.length : null, 'an unrated area is null, never 0');
    }
  }
  const max = d3.max(rows.flatMap((r) => [r.a.share ?? 0, r.b.share ?? 0]));
  assert.ok(F.PROFILE_DOMAINS.includes(domain) && domain >= max, 'one end of scale, shared by both sides, that fits every bar');
  assert.equal(a.rec.score, b.rec.score, 'the story pair has the same overall score');
});

test('paired profile: only real differences are emphasised, at most two, largest first', () => {
  const { a, b } = S.examplePair(pm);
  const { rows } = F.pairedProfile(profileOf(a.rec), profileOf(b.rec));
  const strong = rows.filter((r) => r.strong);
  assert.ok(strong.length <= 2);
  for (const r of strong) assert.notEqual(r.a.low, r.b.low, `${r.key}: emphasised rows differ in items rated low`);
  const gap = (r) => Math.abs((r.a.share ?? 0) - (r.b.share ?? 0));
  for (const r of rows.filter((x) => !x.strong && x.a.low !== x.b.low)) {
    for (const s of strong) assert.ok(gap(s) >= gap(r), `${s.key} is emphasised over a smaller gap (${r.key})`);
  }
  // the same building against itself: nothing to emphasise
  const same = F.pairedProfile(profileOf(a.rec), profileOf(a.rec));
  assert.equal(same.rows.filter((r) => r.strong).length, 0, 'identical profiles never look different');
});

test('paired profile: the scale end is the smallest round value that fits, across many real same-score pairs', () => {
  let checked = 0;
  for (const score of [70, 79, 85, 92, 96]) {
    for (const [x, y] of F.sameScorePairs(pm.latest, score, pm.cats).slice(0, 5)) {
      const { rows, domain } = F.pairedProfile(profileOf(x), profileOf(y));
      const max = d3.max(rows.flatMap((r) => [r.a.share ?? 0, r.b.share ?? 0]));
      assert.equal(domain, F.PROFILE_DOMAINS.find((d) => d >= max));
      checked++;
    }
  }
  assert.ok(checked >= 10, `checked ${checked} pairs`);
});

// The inline <head> script that applies the saved theme before the first paint (no flash on reload).
async function themeScript() {
  const html = await readFile(new URL('../dashboard/index.html', import.meta.url), 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  const m = /<script>([^<]*lease-lens-theme[^<]*)<\/script>/.exec(head);
  assert.ok(m, 'the theme script is inline in <head>');
  assert.ok(head.indexOf(m[0]) < head.indexOf('rel="stylesheet" href="css/tokens.css"'), 'it runs before the stylesheets');
  return m[1];
}
const runTheme = (src, storage) => {
  const documentElement = { dataset: {} };
  vm.runInNewContext(src, { localStorage: storage, document: { documentElement } });
  return documentElement.dataset.theme;
};

test('theme start-up: a saved choice is applied before paint; anything else falls back to the system setting', async () => {
  const src = await themeScript();
  const store = (v) => ({ getItem: (k) => (k === 'lease-lens-theme' ? v : null) });
  assert.equal(runTheme(src, store('dark')), 'dark');
  assert.equal(runTheme(src, store('light')), 'light');
  assert.equal(runTheme(src, store(null)), undefined, 'no choice: follow prefers-color-scheme');
  assert.equal(runTheme(src, store('purple')), undefined, 'unknown values are ignored');
  assert.equal(runTheme(src, { getItem: () => { throw new Error('blocked'); } }), undefined, 'blocked storage never breaks the page');
});

test('every ⓘ button has an accessible name and an explanation to open', async () => {
  const { INFO } = await import('../dashboard/js/content/info.js');
  const files = ['../dashboard/index.html', ...['main.js', 'sections/building.js', 'sections/xray.js', 'story/controller.js', 'sections/fingerprint.js', 'sections/xray-compare.js', 'sections/age.js']
    .map((f) => `../dashboard/js/${f}`)];
  const html = await readFile(new URL('../dashboard/index.html', import.meta.url), 'utf8');
  let n = 0;
  for (const f of files) {
    const src = await readFile(new URL(f, import.meta.url), 'utf8');
    for (const m of src.matchAll(/<button[^>]*class="info-btn[^"]*"[^>]*>/g)) {
      const tag = m[0];
      if (tag.includes('info-demo') || tag.includes('data-info="${')) continue; // demo, or a key chosen at run time
      n++;
      assert.match(tag, /aria-label="[^"]{6,}"/, `${f}: ${tag}`);
      const key = /data-info="([^"$]+)"/.exec(tag)?.[1];
      assert.ok(key, `${f}: an ⓘ button names its explanation: ${tag}`);
      // the body is written in content/info.js, or computed by the view into the element named by data-info-from
      const from = /data-info-from="([^"]+)"/.exec(tag)?.[1];
      if (from) assert.match(html, new RegExp(`id="${from}"`), `${f}: data-info-from="${from}" names an element on the page`);
      assert.ok(INFO[key]?.title && (INFO[key]?.body || from), `${f}: INFO["${key}"] has a title and a body`);
    }
  }
  assert.ok(n >= 12, `found ${n} ⓘ buttons`);
});

test('Building Explorer: three tabs, and the method lives in a dialog, not a tab', async () => {
  const html = await readFile(new URL('../dashboard/index.html', import.meta.url), 'utf8');
  const tabs = [...html.matchAll(/role="tab"[^>]*data-xr-tab="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tabs, ['model', 'compare', 'history']);
  assert.match(html, /<dialog class="bx-dialog" id="xr-method-dialog"/);
  assert.doesNotMatch(html, /How it works<\/button>/);
});

test('contextual help answers one question in 30–60 words', async () => {
  const { INFO } = await import('../dashboard/js/content/info.js');
  for (const k of ['xray-modes', 'xray-controls', 'xray-model', 'xray-ratings', 'compare-match', 'history-systems']) {
    const words = INFO[k].body.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).length;
    assert.ok(words >= 30 && words <= 60, `${k}: ${words} words`);
    assert.ok(INFO[k].title.length < 60, `${k}: a short title`);
  }
});

test('the ⓘ control is sized only by tokens: 16 px circle, 24 px button, 44 px hit area', async () => {
  const tokens = await readFile(new URL('../dashboard/css/tokens.css', import.meta.url), 'utf8');
  assert.match(tokens, /--info-size: 16px;/);
  assert.match(tokens, /--info-box: 24px;/);
  assert.match(tokens, /--info-hit: 44px;/);
  const css = await readFile(new URL('../dashboard/css/workspace.css', import.meta.url), 'utf8');
  const rule = /\.info-btn \{[^}]*\}/.exec(css)[0];
  assert.doesNotMatch(rule, /\d+px/, 'the button rule uses tokens, not literal sizes');
});

test('no native <select> popups remain in the dashboard: every select is enhanced', async () => {
  const html = await readFile(new URL('../dashboard/index.html', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/<select id="([^"]+)"/g)].map((m) => m[1]);
  const js = (await Promise.all(['main.js', 'sections/fingerprint.js', 'sections/xray-compare.js']
    .map((f) => readFile(new URL(`../dashboard/js/${f}`, import.meta.url), 'utf8')))).join('\n');
  for (const id of ids) assert.match(js, new RegExp(`enhanceSelect\\(\\$\\('${id}'\\)`), `#${id} uses the shared Select`);
  assert.match(js, /enhanceSelect\(sel,/, 'the comparison selector uses the shared Select');
});
