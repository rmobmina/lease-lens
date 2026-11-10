# lease-lens
Lease Lens helps first-time renters explore and compare Toronto apartment building quality using RentSafeTO evaluation data.

## LeaseLens site (dashboard/)

A public homepage (an architectural atlas of downtown Toronto drawn from City data) and a map-first **Explore** atlas:
Toronto's wards, then groups of buildings, then individual buildings as you zoom in. Select one to see its score and open its
Building X-Ray, compare it with nearby buildings or see its history. There is also an optional guided data story, *Beyond the Score*.
Design, architecture and data rules: [docs/civic-redesign.md](docs/civic-redesign.md).
To open it, start a local server from this folder:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000/dashboard/ in your browser.

- `dashboard/js/model.js` derives everything from the data (one scoring period at a time, latest evaluation per building, re-inspection pairs).
- `dashboard/js/main.js` is the app shell: routes (`#/`, `#/explore?at=…&ward=…&b=…&lens=…`, `#/xray/<RSN>`, `#/compare/<RSN>`, `#/story/<chapter>`, `#/approach`, `#/about`, `#/help`; old addresses redirect), shared state, the place panel, analysis layers and the depth levels.
- `dashboard/js/atlas/` is the Explore map: `map.js` (Leaflet, semantic zoom), `logic.js` (levels, ward choropleth, clusters, addresses; pure and tested), `search.js` (address combobox).
- `dashboard/js/home/` is the homepage and its lightweight canvas atlas; `dashboard/js/story/` is the guided story; `dashboard/js/components/info-popover.js` + `dashboard/js/content/info.js` are the ⓘ explanations.
- `dashboard/js/sections/` holds the views the map opens: `building.js` (place panel), `map.js` (ward comparison), `age.js`, `problems.js`, `changes.js`, `movers.js` (analysis layers), `fingerprint.js` (comparison), `xray*.js` (X-Ray).
- **Building X-Ray** (`#/xray/<RSN>`): one inspection laid out by category on an interactive 3D model of that building (real footprint and height from the City of Toronto 3D Massing data where a reliable match exists; illustrative interior; Three.js, lazy-loaded), plus *Same score. Different story.* and the building's score history. Data in `dashboard/js/xray-model.js`, scene in `dashboard/js/xray/`, view in `dashboard/js/sections/xray*.js`. Architecture, item-to-category mapping, rules, controls and limitations: [docs/building-xray.md](docs/building-xray.md).
- **Inspection fingerprint** (`#/fingerprint`, the novel view): `dashboard/js/fingerprint-model.js` (data) and `dashboard/js/sections/fingerprint.js` (drawing). The process-book write-up is in [docs/process-book/inspection-fingerprint.md](docs/process-book/inspection-fingerprint.md).
- `dashboard/css/tokens.css` holds every colour, type and shape token (light and dark, Toronto flag-inspired); `atlas.css` is the map shell; `dashboard.css`, `home.css` and `workspace.css` hold the components.
- Data loading and normalization are shared with the explorer (`explorer/js/data.js`), so both views use the same cleaned records.

## Data explorer (Milestone 3)

To open the data exploration dashboard, run these from this folder:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000/explorer/ in your browser. Press Ctrl + C in the terminal to stop the server. See [explorer/README.md](explorer/README.md) for details.

## Story: temporal chapter (Prototype V1)

With the server above running, open http://localhost:8000/story/temporal.html. The design notes, interaction spec and copy are in [docs/temporal-chapter.md](docs/temporal-chapter.md). To re-check the quoted numbers, run `python3 scripts/validate_temporal.py`.

## Tests

```sh
npm install     # d3 only, used by the tests
npm test        # X-Ray data layer, building geometry, story numbers, homepage and Explore atlas, checked against the real data
python3 scripts/build_massing.py   # rebuild dashboard/data/massing (needs the 3D Massing shapefile in data/raw/, see docs/building-xray.md)
python3 scripts/build_wards.py     # rebuild the ward boundaries (needs City Wards GeoJSON in data/raw/wards/, see scripts/build_wards.py)
python3 scripts/build_hero.py      # rebuild the homepage atlas (needs 3D Massing + the Toronto Centreline CSV in data/raw/, see docs/civic-redesign.md)
npm run check   # parses every JavaScript file the site loads
```
