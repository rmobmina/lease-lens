# lease-lens
Lease Lens helps first-time renters explore and compare Toronto apartment building quality using RentSafeTO evaluation data.

## Dashboard

The renter-facing dashboard: look up any building, or step through our five research questions one screen at a time. To open it, start a local server from this folder:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000/dashboard/ in your browser.

- `dashboard/js/model.js` derives everything from the data (one scoring period at a time, latest evaluation per building, re-inspection pairs).
- `dashboard/js/main.js` handles navigation (`#/`, `#/building/<RSN>`, `#/q1`…`#/q5`), filters and the selected building.
- `dashboard/js/sections/` holds one file per view: `building.js` (building report), `map.js` (Q1), `age.js` (Q2), `problems.js` (Q3), `changes.js` (Q4), `movers.js` (Q5).
- **Building X-Ray** (`#/xray/<RSN>`): one inspection laid out by category on an interactive 3D model of that building (real footprint and height from the City of Toronto 3D Massing data where a reliable match exists; illustrative interior; Three.js, lazy-loaded), plus *Same score. Different story.* and the building's score history. Data in `dashboard/js/xray-model.js`, scene in `dashboard/js/xray/`, view in `dashboard/js/sections/xray*.js`. Architecture, item-to-category mapping, rules, controls and limitations: [docs/building-xray.md](docs/building-xray.md).
- **Inspection fingerprint** (`#/fingerprint`, the novel view): `dashboard/js/fingerprint-model.js` (data) and `dashboard/js/sections/fingerprint.js` (drawing). The process-book write-up is in [docs/process-book/inspection-fingerprint.md](docs/process-book/inspection-fingerprint.md).
- `dashboard/css/dashboard.css` holds the design tokens (light and dark) and shared components.
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
npm test        # X-Ray data layer and building geometry, checked against the real data
python3 scripts/build_massing.py   # rebuild dashboard/data/massing (needs the 3D Massing shapefile in data/raw/, see docs/building-xray.md)
npm run check   # parses every JavaScript file the site loads
```
