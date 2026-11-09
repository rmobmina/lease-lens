# Building X-Ray

*A building's RentSafeTO score is only the surface. The X-Ray shows what lies underneath.*

Route: `#/xray/<RSN>` in the dashboard (sidebar: **Building X-Ray**, the **X-Ray** button in the selected-building bar, or **Open its Building X-Ray →** on a building report).

The view has three parts, all driven by the same selected building and the sidebar filters:

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
| `dashboard/js/xray/building.js` | Geometry for one building: extruded massing (holes, multiple parts, rooftop parts), roofs, illustrative windows/balconies, context buildings, and the illustrative interior fitted inside the real footprint. Instanced meshes for repeated parts. |
| `scripts/build_massing.py`, `scripts/massing_lib.py` | Repeatable preprocessing: matches every RentSafeTO building to the 3D Massing shapefile and writes `dashboard/data/massing/<RSN mod 64>.json` plus `docs/massing-matches.csv`. Python standard library only. |
| `dashboard/data/massing/` | Generated geometry shards (about 300 KB each; only the selected building's shard is fetched). `index.json` holds the source, licence and counts. |
| `docs/massing-matches.csv` | One row per building: provenance, confidence, method, distance, storeys, height, parts, reason. For review. |
| `tests/massing.test.mjs` | Checks the generated geometry: shards, provenance, height-vs-storeys, the named test buildings. |
| `dashboard/js/xray/scene.js` | Three.js lifecycle: renderer, lights and shadows, camera framing, orbit/pan/zoom limits, picking, hover summaries, transitions, labels, disposal. Lazy-loaded. |
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
| Windows and balconies | **Illustrative**: a regular pattern spaced by storey along the real walls. Not surveyed. Not drawn on approximate blocks. |
| Floor plates | Real outline, illustrative storey height (height ÷ registered storeys) |
| Corridor, doors, stair, elevator core, risers, rooftop plant, parking level, waste enclosure | **Illustrative**, fitted inside the real footprint |
| Records tiles beside the building | **Abstract**: one tile per record item, coloured by its actual rating. Paperwork has no physical location. |

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

- Latest evaluations from the **same scoring system** only (the sidebar's), the selected building excluded.
- Identical overall score first. If there is none, ±1, then ±2. The tolerance is stated on the page.
- With a ward filter on, matches come from that ward if there are any, otherwise all of Toronto (stated).
- Ordered from the most different category profile (sum of absolute share gaps) to the least, then by RSN, so every reader sees the same order. The reader can choose any match.

## Timeline rules

- One point per usable evaluation, both systems. The non-active system is drawn grey and dashed.
- Lines connect points **only within a system**. Change is measured only against the previous evaluation in the same system; the first 2023+ score is never compared with a 2017–2023 score.
- One evaluation: the point plus "not enough history". None in the active system: an empty-state sentence (other-system points still shown).

## Controls

- **Exterior / X-Ray**: in X-Ray the façade fades to a ghost (windows disappear), context buildings fade, and the floor plates, corridor, stair, core, rooftop plant, parking level and records tiles appear; the camera reframes to include the parking level (≈450 ms; instant with reduced motion).
- **Drag** to orbit (vertical angle 12–84°, never under the ground), **right-drag / two fingers** to pan (kept near the building), **scroll / pinch** to zoom (limited), **double-click** to fly to that point.
- **↺ / ↻** turn 45°. **Reset view** returns to the default three-quarter view, which is fitted to each building's bounds and chosen to face its long façade from the south. Changing building re-frames automatically.
- **Hover** a part: subtle accent plus a summary chip (category, status, items rated poorly). **Click**: selects the category, dims the others, moves the camera to it and updates the panel. Click again, **← Whole building**, or **Esc** to return.
- **Keyboard**: the *Inspection categories* list is the accessible equivalent of clicking the model (Tab, ↑/↓, Home/End, Enter). Timeline points are focusable (Enter shows that inspection). Each item in the panel expands with Enter.

## Fallbacks and performance

- 3D renders automatically on any browser with WebGL, at any width (the earlier < 640 px 2D-first rule was the reason many laptops saw a flat diagram; it is removed). Below 1100 px the panel stacks under the model.
- WebGL unavailable, the 3D module failing to load, a geometry error, or a lost WebGL context → the 2D section diagram, labelled as generic.
- Geometry: only the selected building's shard is fetched (cached per session). Repeated parts (windows, balconies, steps, columns, cars, pipes) are `InstancedMesh`; shells, roofs, floor plates and context are merged into single meshes.
- Rendering is on demand: frames only during input, damping or a transition. Measured: 0 animation frames over 3 s idle, before and after a transition.
- The canvas follows its container with a `ResizeObserver`. Leaving the route, or changing building, disposes geometries, materials, textures, the environment map, the shadow map, listeners, the observer and the renderer (`forceContextLoss`).

## Limitations

- **Exterior accuracy is limited to the massing data**: flat roofs at the average height, no setbacks finer than the City's parts, no façade detail. Matching uses the RentSafeTO address point, which can sit on a neighbouring lot; the height check catches most but not all wrong matches. Medium-confidence matches say why.
- **The interior is illustrative.** Corridors, stairs, the core, parking and plant are not the real floor plan, and the parking level is drawn for every building whether or not it has one. A tinted part shows how a *category* was rated, never where damage is. Category status is not a certified safety-risk score.
- **No heating, plumbing or water-supply items** exist in the open data, so the "building systems" zone covers elevators, lighting, ventilation, electrical and intercom only.
- The 2017–2023 system had **no record/plan items**, so "Safety and records" is always *Not evaluated* for those inspections.
- The City publishes **no text descriptions** for item ratings. The panel shows the City's item name, the number, the previous rating and the citywide share, and nothing invented.
- Overall scores from the two systems are **not normalised** and are never compared or connected.
- The comparison shows the **latest** evaluations only. To compare historical inspections, use the timeline on each building.
- The 3D view needs network access to jsDelivr the first time it opens; offline it shows the 2D diagram.
- The geometry is a 2025 snapshot; buildings demolished or built since then may be missing or wrong. Rerun the pipeline with a newer release.
