# LeaseLens: civic experience redesign

**Principle:** show the discovery, and hide the complexity until the reader asks for it.

## Two layers

| Layer | Route | What it is |
|---|---|---|
| A. Homepage | `#/` | Headline, one supporting line and two actions, beside the downtown drawing on a faint blueprint grid. No eyebrow, captions or disclaimer: the drawing's ⓘ and About carry those, and the footer keeps only the licence attribution. The drawing has no street labels; line weight follows building height, and the far side fades for depth. |
| B. Atlas | everything else | One map of Toronto, explored by zooming in. Deeper levels open over it and close back onto it. |

## The atlas: semantic zoom

Detail grows with scale and intent: **Toronto → neighbourhood → building → inspection**, as one continuous view rather than separate pages.

| Level | When | What the map shows | Beside it |
|---|---|---|---|
| City | zoom < 12 | Ward choropleth (25-ward model, real City boundaries). No building dots. | Title, legend |
| Neighbourhood | 12 – 14 | Groups of nearby buildings on a screen-space grid (88 px cells at the whole zoom level below) that nests between zoom levels, plus a pass that merges any discs that would overlap: about 100 groups citywide at zoom 12 (was ~330), none overlapping. Groups of 1–2 show as a plain dot. Number = buildings; red arc = share in the lowest 10%. Ward fill fades to a wash. | Ward card when a ward is selected, “Buildings in view” list |
| Building | ≥ 14 | One canvas mark per building (citywide band colour and size). The selection gets a ring, one label and its real 3D Massing footprint. Other marks dim. | Place panel: address, score, date, characteristics, **Inspect building · Compare nearby · View history** |
| Inspection | `#/xray/<RSN>` | The Building X-Ray opens over the map (crossfade), with **Back to map** and a breadcrumb | — |

**The choropleth.** Each ward's value is the share of its evaluated buildings (latest evaluation, chosen scoring system) whose score is in the citywide lowest 10%. That is the project's existing definition (`model.js`, ties included). Classes are relative to the citywide share (below 0.5×, 0.5–0.85×, 0.85–1.15×, 1.15–1.5×, 1.5× or more): blue below the city, grey about the same, red above. The legend prints the actual percentages. Wards with fewer than 30 evaluated buildings get a dashed outline and are left out of the ward-comparison headline.

**No flicker.** Level changes use separate zoom-in and zoom-out thresholds (in at 12 and 14, out only below 11.5 and 13.5; `atlas/logic.js levelFor`). Layers cross-fade by pane opacity, and the ward fill fades continuously with zoom.

**Why Leaflet, not a WebGL map.** The data are about 3,600 points and 25 polygons. Leaflet's canvas renderer draws the buildings in a few milliseconds. After viewport culling, the groups are a few dozen keyboard-focusable DOM markers. Tiles, attribution and existing interactions stay as they were. MapLibre GL would add a large dependency and a rewrite without changing what the reader can see. Revisit it only if the map needs every footprint citywide (vector tiles).

**Analysis layers.** The existing D3 views are no longer destinations. One opens at a time in a drawer beside the map (**Analysis** in the top-right), scoped to the selected ward or all of Toronto. The menu suggests the citywide group (score distribution, ward comparison, re-inspection changes) or the neighbourhood group (age and score, common problems, biggest score changes), depending on zoom. All of them stay available.

**Addresses and history.** `#/explore?at=<lat>,<lon>,<zoom>&ward=<code>&b=<RSN>&lens=<id>&sys=pre&show=low10` (only non-defaults are written). Panning and zooming replace the current history entry. Selecting a ward or a building, and going down a level, push one. The map is never torn down under a deeper level, so Back to map (or the browser's Back) lands on the same place and zoom. Other routes: `#/xray/<RSN>`, `#/compare/<RSN>`, `#/story/<chapter>`, `#/about`, `#/approach`, `#/help`. The old `#/q1…q5`, `#/building/<RSN>`, `#/explore/<tab>`, `#/trends/<tab>`, `#/fingerprint` and `#/home` redirect (`legacyRoute`).

**Keyboard and text routes to every building.** Address search (ARIA combobox, both scoring systems), the ward card's lowest-scoring list, the “Buildings in view” list, focusable groups, the ward-comparison list, and “Describe this map” (plus a live text summary for screen readers).

## Files

| Concern | File |
|---|---|
| Tokens: colour, type, shape (light and dark) | `dashboard/css/tokens.css`, the only place colours are defined (`--ch-*` = choropleth) |
| App shell, routing, state, selection, depth levels | `dashboard/js/main.js`; styles in `dashboard/css/atlas.css` |
| Map (Leaflet, levels of detail) | `dashboard/js/atlas/map.js` |
| Pure atlas rules (levels, choropleth, clusters, nearby, addresses, footprints) | `dashboard/js/atlas/logic.js`, tested in `tests/atlas.test.mjs` |
| Address search | `dashboard/js/atlas/search.js` |
| Place panel (building / ward card) | `dashboard/js/sections/building.js` |
| Ward comparison layer | `dashboard/js/sections/map.js` |
| Ward boundaries | `dashboard/data/wards/toronto-wards.json`, built by `scripts/build_wards.py` from City Wards (simplified to 12 m) |
| HomePage | `dashboard/js/home/home.js`, `dashboard/css/home.css` |
| TorontoWireframeHero | `dashboard/js/home/hero-atlas.js`; data from `scripts/build_hero.py` |
| InfoPopover | `dashboard/js/components/info-popover.js`; text in `dashboard/js/content/info.js` |
| Story controller, chapters, selectors, visuals | `dashboard/js/story/`; layout in `dashboard/css/story.css` |

## Colour

The City specifies the Toronto flag's blue as Pantone 287 and its red as Pantone 186. It publishes no screen values, so the screen colours here are approximations:

| Token | Value | Use |
|---|---|---|
| `--civic-blue` | `#29458F` | Interaction, navigation and selection |
| `--civic-red` | `#FF0000` | Defined, but not used for text: it measures about 4:1 on white, below the AA requirement for normal text |
| `--civic-red-ink` | `#C8102E` | Close to Pantone 186 C. Used for red text and thin marks |

Neutral greys carry context. Red is reserved for low scores, declines and low ratings. Item ratings use one light-to-dark red ramp, so the order reads without relying on hue. Red is never the only cue:

- map bands also differ in dot size;
- score changes also differ by side of zero and by ▲/▼ glyphs;
- statuses also differ by text label and hatching.

## Type

Two sans-serif faces, both open source and loaded from Google Fonts. There is no serif anywhere.

- **Display:** Space Grotesk, a geometric grotesque, for headlines, panel titles and large numbers. Large text is tightened (`--tracking-display`, −0.035em) with kerning on; small text keeps default tracking.
- **Interface:** Inter, for everything read at small sizes. Scores and other compared numbers use tabular figures.
- **Scale** (`tokens.css`): 12 / 13 / 14 / 16 / 18 / 22 / 32 px, and the hero at `clamp(44px, 5.3vw, 84px)`. Every stylesheet uses these tokens; only the large score numerals sit above the scale.
- The homepage headline breaks deliberately, one phrase per line, with the last phrase in civic blue.

## Design system: spacing, borders, radii

All defined once in `tokens.css` and used everywhere (a script mapped every older one-off value onto them):

| Token | Values | Rule |
|---|---|---|
| `--space-1` … `--space-8` | 4, 8, 12, 16, 24, 32, 48, 64 px | Every margin, gap and padding. |
| `--border-width` / `--border-width-strong` | 1 px / 2 px | 1 px for grouping and controls; 2 px only for state (current page, selected item). |
| `--border-color` / `--border-control` | `--line` / `--axis` | Structure vs. interactive controls. In dark mode they are translucent white (12% / 24%). |
| `--radius-sm` / `--radius-md` | 4 / 6 px | Controls and swatches / floating panels. No pill shapes. |
| `--header-h` | 60 px | One header height on every route. |

A border has to mean grouping, focus or interaction. Inner separators, note boxes and the score “pill” were removed from the map panels; whitespace and type separate content instead.

**One header.** A single `<header class="site-bar">` sits above both layers: wordmark, address search (map routes only), Explore · Guided story · About, and the theme toggle. Same height, spacing, active state (2 px underline) and focus ring everywhere. “Our approach” was merged into About (`#/approach` redirects).

## Motion

`dashboard/js/motion.js` coordinates all scripted UI motion: one rAF loop per keyed animation, timestamp-based, cancellable, with reduced motion jumping to the end state. Starting an animation with the same key cancels the running one, so new intent always wins and nothing queues.

- **Groups split and merge** (`map.js drawClusters`): on zoom in, each new group grows out of where its parent was; on zoom out, the old groups slide into their new parent and fade. Moves over 320 px aren't animated. If you zoom again mid-way, the next draw starts from where the groups visibly are.
- **Camera:** Leaflet `flyTo`, with 0.35–0.7 s depending on distance. Any new flight, drag, wheel or touch replaces the current one where it is.
- **Place panel:** opens scaling out of the selected building (or ward) on the map and closes back into it. Focus returns to whatever opened it (search box, list), or to the map.
- **Home → map:** View Transition; the header stays put and the drawing settles into the map's box.
- Durations: micro 160 ms, panels 260 ms, group splits 340 ms, flights 350–700 ms.

## Homepage atlas: what is accurate and what is simplified

`scripts/build_hero.py` uses only City of Toronto Open Data (Open Government Licence – Toronto). Nothing is traced from map imagery.

**Accurate:**

- Footprints and heights come from **3D Massing (2025)**.
- Streets (expressways, arterials, collectors, locals) and the Lake Ontario shoreline come from the **Toronto Centreline (TCL)**.
- Street labels sit on their own centreline.
- Highlighted buildings are RentSafeTO buildings whose footprint was matched reliably by `build_massing.py`. That means the "massing" provenance only; approximate matches are left out.

**Simplified:**

- footprints under 140 m² and buildings under 4 m are dropped;
- outlines are simplified with Douglas–Peucker at 1.6 m;
- heights are rounded to 1 m;
- laneways, trails and minor features are omitted;
- the view is cropped to Bathurst St – the Don River, the Toronto Islands – Bloor St.

The page states this in the ⓘ beside the drawing, and the About page has a table of what is real and what is drawn.

Performance:

- **No Three.js on the homepage.** The atlas is a single 2D canvas, with painter-ordered hidden-line removal.
- **No animation frames when idle.** The canvas redraws only while animating or while following the pointer.
- **Lazy loading.** The data is fetched after the page is idle: 622 KB, about 210 KB gzipped.
- **Fallback.** A static SVG (about 65 KB gzipped) uses the same projection and frame. It paints first and stays if the canvas or data is unavailable, and the two line up exactly.
- **Intro.** The reveal (grid, then buildings rise, then the camera settles) takes about 1.9 s. It is skipped under `prefers-reduced-motion`, and also when frames are slow.
- **Layout.** The atlas box has a fixed size, so nothing shifts.

**Entering the workspace:** "Let's explore" uses the View Transitions API where it is available. It crossfades the page and moves the drawing into the map panel's box (shared `view-transition-name`). This is a shared-box transition, not a geographic camera move, because the two views use different projections. It is skipped under reduced motion.

## Beyond the Score

A full-screen, zero-scroll guided story that runs on the real map and views. It moves down the same levels as free exploration: distribution → wards → categories → X-Ray → comparison → history. Each chapter is a route (`#/story/<id>`, with `#/story/aha` kept as an alias of `resolution`), so Back and Forward work.

- **Entering** saves the reader's state: route, scoring system, ward, selection, view settings, compare pair and X-Ray state.
- **Each chapter** applies temporary state: the current system, all of Toronto, then its own example.
- **Leaving** restores the saved state, whether by Exit or by following any link out.

**One shell, no page scroll.** The shared header, then a stage that fills the rest of the viewport. Each chapter has one visual focus: the map, the X-Ray, the comparison, or a full-stage chart. A compact caption floats in one fixed safe area, bottom-left on desktop and a bottom sheet on phones. It holds:

- "02 / 07";
- the headline;
- one short narration with the finding;
- at most one chapter action;
- an optional detail view;
- Back / Next / Exit.

The caption's measured size (`--cap-w`, `--cap-h`) is the area every visual keeps clear of, and the map's framing treats it as an obstruction. In the story, tools, the place card and the depth bar are hidden, and the legend moves bottom-right. Only an opened detail view (an analysis layer) may scroll, inside itself. Styles are in `dashboard/css/story.css`.

**Motion.** Every move goes through `app.present()`, which carries a sequence token. Work still pending from an earlier chapter is dropped, such as a flight meant to end in the X-Ray or a chart waiting to draw, so rapid Next/Back/Exit never stacks up. The building chapter flies to the building on the map, then goes down into the X-Ray. Under reduced motion it opens directly.

**Controls.** Back, Next (primary), Exit story, ←/→ keys (ignored while typing, in the map or in the 3D model), and Esc to close a detail view. Focus moves to the chapter title. A detail view focuses its own title and returns focus to its button when closed.

| # | Chapter | Visual focus | Finding (computed when the page loads) | Action / detail |
|---|---|---|---|---|
| 01 | Prologue | Score distribution (full stage) | Median latest score **92** (3,590 buildings, current system); middle half 87–96 | none |
| 02 | Location | Ward map, the top ward centred among its neighbours | Highest lowest-10% share among wards with ≥ 50 buildings: **Davenport, 24 of 92 (26%)**, against 11% citywide | Detail: ward comparison layer |
| 03 | Problems | Category bar chart (full stage) | **42%** of buildings had at least one shared-space item rated 0 or 1, the highest category; parking, grounds and waste next | Detail: common-problems layer |
| 04 | Building | Building X-Ray (real 3D massing) | **200 Jameson Ave**, score 92: 6 of 45 rated items low, 5 in safety and records | Steps: open the cutaway, then focus on that category |
| 05 | Compare | The two inspection profiles side by side | 200 Jameson Ave vs **77 Quebec Ave**: both 92, both in Parkdale–High Park; 6 items rated low vs none | none |
| 06 | History | Evaluation timeline (full stage) | 77 Quebec Ave: 85 → 92 in the current system. The 2017–2023 scores are shown separately and never compared. Citywide: 64% of 3,216 re-inspections scored higher, 29% lower. | Detail: re-inspection changes layer |
| 07 | Resolution | Three checks | "Explore a building yourself" leaves the story and focuses the address search on the map | none |

In the X-Ray chapter, the "Actual 3D massing" provenance and the caveat that interiors are illustrative always stay visible. The story never mixes the two scoring systems.

**How examples are chosen.** Nothing is hand-picked. The rule:

1. Take the median latest score.
2. Take `sameScorePairs(…)[0]` at that score, from `fingerprint-model.js`: the building with the most low marks, next to the one with the fewest.
3. Chapter 06 follows the second building, unless it has fewer than two evaluations in the current system.

`tests/story.test.mjs` recomputes every number above from the raw ratings. The test also fails if the median moves away from 92, as a prompt to re-read the copy.

## Information hierarchy

- **Level 1: visible.** A short title, one sentence, the chart, its legend and axes, and the key finding.
- **Level 2: ⓘ.** One reusable popover: a non-modal dialog that opens by click, tap or keyboard, never on hover alone.
  - It closes on Escape, on an outside click, or on a second press, and focus returns to its button.
  - It flips above or below and is clamped to the viewport.
  - Its buttons have a 40 px touch target.
- **Level 3: method.** The existing "How this is calculated" disclosures, the X-Ray method notes, and the About and Help pages.

## Accessibility notes

What is in place:

- semantic landmarks and one `h1` per layer or area;
- skip links;
- focus moves to the new heading after navigating from the shell;
- the story progress is a list of labelled links;
- the popover is announced as a dialog and labelled by its title;
- the canvas atlas is `aria-hidden`, with a text caption, and every action it offers is also a button;
- the X-Ray keeps its 2D diagram fallback and its keyboard category list.

This has been checked with automated keyboard and focus tests and visual review. It has **not** been audited manually with a screen reader, so no WCAG conformance is claimed.

## Limitations

- The homepage drawing covers downtown only. A full-city drawing would be several megabytes.
- On the Explore map, only the selected building's footprint is drawn (from its massing shard). Every other building is a mark at its address point.
- A group sits at the mean position of its buildings, so a group that merged two cells can sit between two clumps of buildings.
- Buildings without coordinates count in their ward's share, but can't be placed on the map.
- The hero hover (RentSafeTO addresses) needs a fine pointer. On touch, the drawing is not interactive; the same buildings are reachable through search.
- The transition into the workspace is a crossfade of boxes, not a continuous geographic camera.
- Without network access to Google Fonts, the pages fall back to Georgia and the system sans-serif.
- Story text is written for the current data. Numbers update automatically, but the editorial framing ("more than twice", "highest category") is computed by rules that could choose a different ward or category if the data changes.
