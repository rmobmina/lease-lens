# Building X-Ray

*A building's RentSafeTO score is only the surface. The X-Ray shows what lies underneath.*

Route: `#/xray/<RSN>`, the inspection level of the Explore map: select a building on the map (or search its address) and choose **Inspect building**. It opens over the map; **Back to map** returns to the same place and zoom.

The view has three parts, all driven by the same selected building and the scoring system chosen in Layers:

1. **3D Building X-Ray**: one inspection laid out by category on a 3D model of *that* building. The exterior comes from the City's 3D Massing data; the interior is illustrative.
2. **Same score. Different story.**: the building next to another building with the same (or a labelled near) score.
3. **Is this score still current?**: every evaluation of the building over time. Selecting a point loads that inspection into the X-Ray.

## Run it

```sh
python3 -m http.server 8000      # from the repo root
open http://localhost:8000/dashboard/#/xray/4152711
npm test                         # data tests against the real CSVs (node --test, no extra deps)
npm run check                    # parses every JS file the site loads
```

Three.js 0.160.0 comes from jsDelivr via the import map in `dashboard/index.html`. It is downloaded only when the X-Ray view opens, so it doesn't slow down the other views. Offline, the X-Ray falls back to the 2D diagram.

## Files

| File | Role |
|---|---|
| `dashboard/js/xray-model.js` | **Data only** (no DOM, no globals, runs in Node). Zone mapping, zone status, profiles, timeline points, matching. |
| `dashboard/js/xray/footprint.js` | **Pure 2D maths** (Node-tested): wall edges with outward normals (holes included), orientation buckets, the layout frame fitted inside a footprint, **wings** (largest inscribed rectangles along the dominant wall direction, so L-, T- and U-plans get a corridor per wing), storey layout. |
| `dashboard/js/xray/framing.js` | **Camera fitting** (Node-tested): exact camera position for a fixed view direction so every model point projects inside a padded safe area, for any field of view and aspect ratio. |
| `dashboard/js/xray/building.js` | Geometry for one building: façade wall panels per orientation bucket (outside/inside faces), through-wall glazing, floor bands, parapets, balconies, roof slabs, rooftop parts and plant; slabs (real outline) at the storeys the cutaway exposes; the records sheet; site; context. Builds each corner's room stack on demand. Everything repeated is instanced. |
| `dashboard/js/xray/cutaway.js` | **Pure** (Node-tested): where the cutaway notch goes and how big it is, which room sits on which storey, the four candidate corners and which face the street, the real façade line inside the notch (section lines), the share of the façade it opens, and which corner faces the camera (with hysteresis). |
| `dashboard/js/xray/rooms.js` | The illustrative rooms for one corner: corridor (doors, stair, handrails, lights), services room (elevator shaft and cab, air-handling unit and duct, electrical panels, pipes), ground-level parking and waste room; room outlines and section lines. |
| `dashboard/js/xray/materials.js` | Material registry and palette (from `--xr-*` CSS tokens), hatch and contact-shadow textures. |
| `dashboard/js/xray/annotations.js` | Screen-space labels: two collision-free columns beside the model, leader lines, occlusion and narrow-screen rules. `layoutLabels` is pure and tested. |
| `scripts/build_massing.py`, `scripts/massing_lib.py` | Repeatable preprocessing: matches every RentSafeTO building to the 3D Massing shapefile and writes `dashboard/data/massing/<RSN mod 64>.json` plus `docs/massing-matches.csv`. Python standard library only. |
| `dashboard/data/massing/` | Generated geometry shards (about 300 KB each; only the selected building's shard is fetched). `index.json` holds the source, licence and counts. |
| `docs/massing-matches.csv` | One row per building: provenance, confidence, method, distance, storeys, height, parts, reason. For review. |
| `tests/massing.test.mjs` | Checks the generated geometry: shards, provenance, height-vs-storeys, the named test buildings. |
| `tests/xray-geometry.test.mjs` | Outward normals (any ring orientation, courtyards), buckets, the layout frame inside irregular real footprints, storey layout, label layout (no overlaps, inside the canvas, beside the model). |
| `dashboard/js/xray/scene.js` | Three.js lifecycle: renderer, lights, shadows and fog, the six-plane cutaway clip and its open/close sweep, the corner that follows the camera, Exterior/Cutaway/Focus, room dimming and outlines, camera framing and focus, context fading, picking, hover summaries, disposal. Lazy-loaded. |
| `tests/xray-cutaway.test.mjs` | The cutaway plan on synthetic shapes and on the real test buildings: scenes for 1, 2 and 3+ storeys without overlap, the notch inside the real footprint at a street corner, ≤ 30% of the facing façades opened (a sliver for towers), section lines on the façade, corner switching with hysteresis. |
| `dashboard/js/sections/xray.js` | The view: which inspection to show, geometry loading and provenance, category list, detail panel, 2D fallback, lazy 3D loading. |
| `dashboard/js/sections/xray-compare.js` | Same score, different story (D3). |
| `dashboard/js/sections/xray-timeline.js` | Score history (D3). |
| `tests/xray-model.test.mjs`, `tests/load-data.mjs` | Tests. They load the CSVs through the site's own loader (`explorer/js/data.js`). |
| `scripts/check-syntax.mjs` | `npm run check` |

Changes outside these files: `dashboard/index.html` (import map, nav item, view markup), `dashboard/js/main.js` (route, state, disposal on leaving, search stays on the X-Ray), `dashboard/js/sections/building.js` (link), `dashboard/css/dashboard.css` (`--xr-*` tokens for light and dark, and an `xr-` component block), `package.json` (`type: module`, `test` and `check` scripts).

## Building geometry

**Source:** City of Toronto Open Data, [3D Massing](https://open.toronto.ca/dataset/3d-massing/), 2025 shapefile, Open Government Licence – Toronto. Each record is one building part: a footprint polygon (holes allowed) with heights above ground (`MIN_HEIGHT`, `MAX_HEIGHT`, `AVG_HEIGHT`) and their source (LiDAR, photogrammetry, 3D model). Despite its name, the "WGS84" shapefile stores Web Mercator metres; the pipeline converts to true ground metres (× cos latitude).

No Google Maps or Google Earth data is used, traced or measured.

**Rebuild:**

```sh
mkdir -p data/raw/massing_2025 && cd data/raw/massing_2025
curl -LO https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/387b2e3b-2a76-4199-8b3b-0b7d22e2ec10/resource/667237d6-4d3c-4cf3-8cb7-e91c48d59375/download/3dmassingshapefile_2025_wgs84.zip
unzip 3dmassingshapefile_2025_wgs84.zip && cd -
python3 scripts/build_massing.py     # ~10 s; writes dashboard/data/massing/ and docs/massing-matches.csv
npm test
```

`data/raw/` is git-ignored (the shapefile is several hundred MB).

### Matching rules

The closest footprint is **not** assumed to be correct. For each RSN (latest evaluation):

1. **Address point**: the RentSafeTO `LATITUDE`/`LONGITUDE` (or, if missing, derived from `X`/`Y` with the same affine fit the explorer uses).
2. **Seeds**: every ground-level massing part that contains the point. If none, the nearest substantial footprint (≥ 60 m², ≥ 4 m tall) within **15 m**. If another, separate footprint is within 4 m of that distance, the match is ambiguous: the registered storeys decide if exactly one fits, otherwise **no geometry is assigned**.
3. **Rooftop parts** (`MIN_HEIGHT` > 0: penthouses, mechanical rooms) resting on a seed are added on top.
4. **Height check**: tallest roof ÷ registered storeys must be 2.3–4.8 m. If the seeds are too low (the point fell in a podium or wing), touching parts are added (bounded) and the check repeated. A fit that only works if one registered storey is below grade is accepted at **medium** confidence.
5. Anything else is **not assigned**. The building is drawn as a hatched block sized from storeys and units, with no windows, labelled *Approximate model* and the reason.

Heights: `AVG_HEIGHT`, or `MAX_HEIGHT` where the average is 0; some parts sourced from 3D models have `MAX_HEIGHT` = 0 (e.g. 25 Selby St, 165.6 m).

### Results (2025 massing, 3,657 buildings)

| Provenance (shown under the model) | Buildings | Meaning |
|---|---|---|
| Actual 3D massing, high confidence | 3,042 | Point inside the footprint, height fits the storeys strictly |
| Actual 3D massing, medium confidence | 441 | Nearest footprint, connected parts merged, or one storey below grade |
| Approximate model | 170 | 100 heights don't fit the storeys, 48 no footprint within 15 m, 22 ambiguous |
| Geometry unavailable | 4 | No coordinates (33 Flamborough Dr units) |

The *Actual footprint, estimated height* level exists in the code for footprints without a height; the 2025 data has none among matched buildings.

| Test building | RSN | Result |
|---|---|---|
| 711 Bloor St W (3 storeys, attached row) | 4153170 | Massing, high: its own 244 m² part, 9.7 m; the attached neighbours are context, not merged |
| 1765 Victoria Park Ave (7 storeys) | 4152650 | Massing, high: two touching wings plus rooftop parts, 23.5 m |
| 25 Selby St (51 storeys, tallest) | 4575691 | Massing, high: 165.6 m tower |
| 2911 Bayview Ave (irregular, courtyard) | 4228864 | Massing, high: 164-vertex footprint with a hole |
| 3161 Eglinton Ave E (no footprint) | 4152791 | Approximate: no footprint within 15 m |

### What is real and what is illustrative

| Element | Status |
|---|---|
| Footprint shape, holes, building parts, rooftop parts, heights | Real (3D Massing), when provenance is *Actual 3D massing* |
| Neighbouring buildings within ~110 m | Real massing, drawn neutral |
| Windows, frames, sills and lintels, floor bands, pilasters, base course, entrance and canopy, garage door, parapets, balconies, stair bulkhead | **Illustrative**: a regular pattern spaced by storey along the real walls, scaled to the height class (≤ 4 storeys: wider bays and smaller windows, no balconies; 5–12: balconies on the two longest walls, pilasters; 13+: narrower bays, taller glazing). Rooftop plant is sized to the building (≤ 12% of its height, 1.4–2.6 m). Not surveyed. Not drawn on approximate blocks. |
| Presentation base, walkway, driveway, trees | **Neutral setting**, not the real lot: a base around the building, a walk from the illustrative entrance, a driveway to the illustrative garage door, and a few trees placed clear of the building, neighbours, paths and data layers, and never between the default camera and the façade. |
| Floor slabs (0.3 m) around the cutaway | Real outline, illustrative storey height (sourced height ÷ registered storeys) |
| The rooms in the cutaway: corridor with unit doors and a stair, services room, ground-level parking and waste room; rooftop plant | **Illustrative and generic**: the same rooms for every building, sized to fit the main wing (largest rectangle inscribed in the real outline). They are not the building's layout, and nothing in them shows damage. |
| Records sheet beside the building | **Abstract**: one tile per record item, coloured by its actual rating, with a leader line to the building. Paperwork has no physical location. |

The page states: *Exterior geometry is based on available building data. Interior spaces are illustrative and do not represent the actual floor plan.*

## Data

Source: City of Toronto Open Data, *Apartment Building Evaluations*, both files in `data/`. Records are cleaned by the shared loader, and the dashboard's usual exclusions apply (created in error, no ratings, duplicate RSN + date, no score).

| | 2023 – now | 2017 – 2023 |
|---|---|---|
| Building ID | `RSN` | `RSN` |
| Evaluation | one row (`_id`), date `EVALUATION COMPLETED ON` | one row (`_id`), date `EVALUATION_COMPLETED_ON` |
| Overall score | `CURRENT BUILDING EVAL SCORE` | `SCORE` |
| Items | 50 columns, `NUMBERING OF PROPERTY` … `TENANT SERVICE REQUEST LOG` | 20 columns, `ENTRANCE_LOBBY` … `OTHER_FACILITIES` |
| Scale | 0–3, 3 = top mark | 1–5, 5 = top mark |
| Rated poorly | 0 or 1 | 1 or 2 |
| Missing | `N/A` (doesn't apply) | `N/A`; blank only in one excluded no-ratings row |

"Rated poorly" uses `PERIODS[era].poorMax` from `model.js`, the same rule as the Common problems view. The tests check that both stay in sync and that these are the only values in the files.

**Every evaluation has item-level ratings**, so selecting any point in the history really does show that inspection's items.

### Item → zone mapping

The mapping is the `XRAY_ZONES` table in `dashboard/js/xray-model.js`. It is also printed on the page under *How the X-Ray works*. Every column of both files is assigned to exactly one zone; a test fails if a column is missing, duplicated or misspelled.

| Zone (on the model) | 2023 – now items | 2017 – 2023 items |
|---|---|---|
| **Exterior envelope** (façade, windows, balconies) | Building exterior, Windows, Exterior doors, Balcony guards | Exterior cladding, Entrance doors/windows, Water penetration (exterior), Balcony guards |
| **Building systems** (elevator core, rooftop mechanical) | Elevator maintenance, Elevator cosmetics, Lobby/hallway lighting, Stairwell lighting, Common area ventilation, Electrical services/outlets, Intercom | Elevators, Interior lighting levels, Security |
| **Shared spaces** (residential floors: corridor, stair, laundry) | Lobby walls/ceiling, Lobby floors, Mail receptacles, Hallway walls/ceiling, Hallway floors, Stairwell walls/ceiling, Stairwell landings/steps, Handrails/guards (safety), Handrails/guards (upkeep), Laundry room, Storage/lockers, Pools, Other amenities, Building cleanliness, Common area pests, Graffiti | Entrance lobby, Interior wall/ceiling/floor, Stairwells, Interior guards/handrails, Laundry rooms, Storage areas/lockers, Other facilities, Graffiti |
| **Safety and records** (ground-floor office) | Emergency contact sign, Tenant notification board, Numbering of property, Electrical safety plan, Vital service plan, State of good repair plan, Maintenance log, Cleaning log, Pest control log, Tenant service request log | *none: that system had no record items* |
| **Parking, grounds and waste** (underground parking, site) | Parking areas, Abandoned equipment/vehicles, Exterior grounds, Exterior walkways, Fencing, Retaining walls, Catch basins/storm drainage, Accessory buildings, Clothing drop boxes, Outdoor and indoor garbage storage, Garbage/compactor room, Chute rooms | Parking area, Exterior grounds, Exterior walkways, Garbage bin storage area, Garbage chute rooms |

Judgement calls: graffiti could be inside or outside and sits with Shared spaces (as in the fingerprint view); intercom and security are systems; garbage rooms and chutes are grouped with waste rather than with the floor they're on.

### Zone status

For each zone in one inspection: *applicable* = items with a rating (N/A and blank excluded), *share* = poorly rated ÷ applicable.

| Status | Rule | Look |
|---|---|---|
| No poor ratings | applicable > 0, poor = 0 | neutral |
| Some poor ratings | poor ≥ 1 | amber |
| Concentrated poor ratings | poor ≥ 2 **and** share ≥ 25% | coral |
| Not evaluated | applicable = 0 | grey, hatched; no percentage |

The count condition matters. The exterior zone has only 4 items, so one low mark is already 25%. On the latest 2023+ evaluations, a proportion-only rule would mark 897 of 3,590 exteriors "concentrated"; with both conditions it's 196. Status is always written in words next to the colour (list, labels, panel), so it never relies on colour alone.

## Comparison rules

`findMatches` in `xray-model.js`, all tested:

- Latest evaluations from the **same scoring system** only (the one chosen in Layers), the selected building excluded.
- Identical overall score first. If there is none, ±1, then ±2. The tolerance is stated on the page.
- With a ward filter on, matches come from that ward if there are any, otherwise all of Toronto (stated).
- Ordered from the most different category profile (sum of absolute share gaps) to the least, then by RSN, so every reader sees the same order. The reader can choose any match.

## Timeline rules

- One point per usable evaluation, both systems. The non-active system is drawn grey and dashed.
- Lines connect points **only within a system**. Change is measured only against the previous evaluation in the same system; the first 2023+ score is never compared with a 2017–2023 score.
- One evaluation: the point plus "not enough history". None in the active system: an empty-state sentence (other-system points still shown).

## Views and transitions

The previous X-Ray made the whole building transparent and exposed every floor at once; the Exploded view pulled floors apart. Both are gone. The X-Ray is now a **selective architectural cutaway**.

| View | What happens |
|---|---|
| **Exterior** | The sourced massing with the illustrative façade, roofs, parapets and rooftop plant; neighbouring massing in neutral grey. Nothing is cut. |
| **Cutaway** | One corner of the main wing is opened at street level: a box a few storeys high (`cutaway.js`). The façade, roof and silhouette are clipped there by six intersected clipping planes; slabs, rooms, site and context are never clipped, so the cut reads as solid floors with dark section edges. Inside is a short stack of rooms (3+ storeys: parking and waste on the ground floor, services room above, corridor above that; 2 storeys and 1 storey put rooms side by side). The cut sweeps in from the façade (~600 ms, ~260 ms to close; instant with reduced motion). The camera lowers to about 14° above the horizon, enough to see under the storey above the opening. While the reader orbits, the opening closes, moves to the street corner now facing them and reopens; corners that face another wing are never used. |
| **Focus** | One category. A room: its outline turns civic blue, the other rooms fade toward the background (they stay in place), and the camera frames the room at about 12° so the reader looks straight in. Exterior: the cutaway closes and the façade and silhouette are outlined. Records: the camera looks at the inspection sheet face-on from the street, with the façade it is linked to behind it (if that viewpoint would be inside the building's outline, it tries other headings, then falls back to the sheet with the lower storeys). |

**How much is opened** (measured on the test buildings, the two façades meeting at the corner): 1A Vermont Ave (3 storeys) 28%, 875 Kennedy Rd (6) 11%, 200 Jameson Ave (12) 10%, 1 Antrim Cres (12) 4%, 10 Glen Everest Rd (17) 6%, 25 Selby St (51) 1%. Low-rise buildings show their whole height opened at one corner; mid-rise and towers keep their silhouette and show the stack at the base, with Focus as the enlarged view. The rooms are deliberately shallow (3.4–4.2 m) because they are seen under the storey above; a deeper room would hide its back wall behind its own ceiling.

Structure and data stay separate. The architecture is never recoloured; the data appears only as:

| Where | Encoding |
|---|---|
| Each room's floor finish | a light tint of the category's status (blue-grey for no poor ratings, soft red for some, a stronger red for concentrated, hatched grey for not evaluated) |
| The selected room | a civic-blue outline; the others dimmed |
| Records sheet | one tile per item in its actual rating colour |
| Labels and the side panel | status words and exact counts |

The finding line under the toolbar always states the key result in words: the selected category's poor ratings, or the inspection's total and where most poor ratings fall.

## Controls

- **Exterior / Cutaway / Focus** (segmented control). Focus with nothing selected opens the category that needs the most attention (concentrated, then some poor ratings, then the largest share).
- **Drag** to orbit (15–84° from vertical), **right-drag / two fingers** to pan (kept near the building), **scroll / pinch** to zoom (limited), **double-click** to fly to that point.
- **The camera never enters the building.** The building is treated as a solid: the convex hull of its real footprint, grown by about 0.7 storey heights, up to the roof and rooftop plant. If zooming, panning, a double-click, a category focus or an animated move would put the camera inside, it backs out along its own line of sight, so the view keeps pointing the same way and simply stops at the wall. (`pushOutside` in `framing.js`, tested in Node and checked in the browser by trying to zoom, orbit, pan and double-click into several buildings.)
- **Reset view** (always visible) returns to the default three-quarter view facing the long, street-side façade, fitted as described under *Camera framing*. In Focus it re-frames the selected category. The compact **Camera** menu holds the advanced controls: **Frame [category]**, **Show whole building** (clears the selection and returns to Cutaway), and **Turn 45° left / right** (in Cutaway the opening follows to the facing corner). The ⓘ beside it explains orbit, pan and zoom. A new building always gets its own fitted view.
- **Model → panel**: hover shows a summary chip; click a room, the façade, the records sheet or a label to select the category: the view switches to Focus, the camera frames it, and the panel lists every applicable item with its actual rating. Clipped geometry inside the opening is never picked.
- **Panel → model**: clicking a category in the list does the same. Click again, **Show whole building** or **Esc** to return to the Cutaway.
- **Labels**: projected 3D anchors, laid out in two columns beside the model so they never overlap or clip; leader lines connect them; anchors behind standing walls or off-screen hide their label. Cutaway with nothing selected: a short title for each of the three rooms. Focus: only the selected (and hovered) label. Exterior: only on hover. Under 560 px wide only the selected or hovered label is shown.
- **Keyboard**: the *Inspection categories* list is the accessible equivalent of the model (Tab, ↑/↓, Home/End, Enter). All buttons are native controls. Timeline points are focusable. Each item in the panel expands with Enter.

## Camera framing

The default view of every mode is computed, not hard-coded (`framing.js`):

1. The visible model becomes a set of points: the convex hull of the real footprint from the ground to the highest point (parapets, rooftop parts and plant), the site elements beside it and, in Cutaway, the records sheet. Neighbouring buildings are excluded. Focus uses the selected room's box plus about half a storey above and below (or the sheet and the lower storeys).
2. With the view direction fixed (Exterior: a three-quarter view onto the street façade, 60° from vertical, 66° for towers; Cutaway: looking into the open corner, 76°; Focus: straight into the room's long side, 78°), each screen-edge constraint is linear in the camera position and the two screen axes separate, so the closest camera that keeps every point inside the safe area is solved exactly, then centred.
3. The safe area keeps about 10% of the canvas free at top and bottom, 7% at the sides, and room for the label columns in Cutaway (17%, none under 560 px).

It runs when a building opens, on every mode change, on every Focus, and when the canvas resizes (`ResizeObserver`), as long as the reader hasn't taken over the camera. **Reset view** always returns to it. Tests check that the fit is inside the safe area and tight, for tall, wide and low shapes at aspect ratios from 0.46 to 2.4, and the app records the projected extent on the canvas (`data-fit`) so browser checks can confirm nothing is cropped.

## Rendering

ACES tone mapping; hemisphere sky light, a key sun with 2048² soft shadows fitted to each building, a weak cool fill from the opposite side, and a room environment map for glazing reflections. A soft contact shadow sits under the building, which stands on a 35 cm presentation base. Neighbouring massing is tinted toward the background (more so in Focus) so it never competes with the selected building. Fog in the background colour fades the surrounding city into the horizon; context buildings between the camera and the selected building fade out as the camera moves. The rooms in the cutaway neither cast nor receive shadows, so they read like a lit section drawing instead of a dark hole under the storey above. No post-processing pass: SSAO was considered but costs a full extra render per frame for little gain at this scale.

## Fallbacks and performance

- 3D renders automatically on any browser with WebGL, at any width (the earlier < 640 px 2D-first rule was the reason many laptops saw a flat diagram; it is removed). Below 1100 px the panel stacks under the model.
- WebGL unavailable, the 3D module failing to load, a geometry error, or a lost WebGL context → the 2D section diagram, labelled as generic.
- Geometry: only the selected building's shard is fetched (cached per session). Repeated parts (wall panels, windows, bands, slabs, room parts) are `InstancedMesh`: roughly 60–90 draw calls for the building plus one per context building. A corner's room stack is built the first time the opening reaches it and kept.
- Rendering is on demand: frames only during input, damping or a transition. (OrbitControls 0.160 re-clamps its target on every update, and for some coordinates that rounding never settles, so it would report a change forever; motion below a micrometre is ignored.) Measured: 0 animation frames over 3 s idle, before and after a transition.
- The canvas follows its container with a `ResizeObserver`. Leaving the route, or changing building, disposes geometries, materials, textures, the environment map, the shadow map, listeners, the observer and the renderer (`forceContextLoss`).

## Limitations

- **Exterior accuracy is limited to the massing data**: flat roofs at the average height, no setbacks finer than the City's parts, no façade detail. Matching uses the RentSafeTO address point, which can sit on a neighbouring lot; the height check catches most but not all wrong matches. Medium-confidence matches say why.
- **The interior is illustrative.** The rooms are the same generic spaces for every building, and ground-level parking and a services room are drawn whether or not the building has them. Storeys are evenly spaced (sourced height ÷ registered storeys); real storey heights and ground-floor uses are unknown. A tinted floor shows how a *category* was rated, never where damage is, and no result is assigned to a floor, unit or room. Category status is not a certified safety-risk score.
- **The cut façade has no caps**: the clipped façade walls show their thin inner faces at the cut; the room walls and slab edges carry the section.
- **Curved or very irregular façades**: the opening follows the fitted rectangle of the main wing, so on a curved façade the cut edge can sit a little behind the wall line. Corners whose façade is more than 6 m from that rectangle are not used.
- **Very large complexes** (hundreds of metres across) are framed whole, so their storeys read small; zoom in or focus a category.
- **No heating, plumbing or water-supply items** exist in the open data, so the "building systems" zone covers elevators, lighting, ventilation, electrical and intercom only.
- The 2017–2023 system had **no record/plan items**, so "Safety and records" is always *Not evaluated* for those inspections.
- The City publishes **no text descriptions** for item ratings. The panel shows the City's item name, the number, the previous rating and the citywide share, and nothing invented.
- Overall scores from the two systems are **not normalised** and are never compared or connected.
- The comparison shows the **latest** evaluations only. To compare historical inspections, use the timeline on each building.
- The 3D view needs network access to jsDelivr the first time it opens; offline it shows the 2D diagram.
- The geometry is a 2025 snapshot; buildings demolished or built since then may be missing or wrong. Rerun the pipeline with a newer release.
