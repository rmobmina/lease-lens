# Lease Lens — data explorer (Milestone 3)

This is an internal exploration dashboard for the two RentSafeTO CSVs in `../data/`. We use it to inspect the data before hand-sketching. It is **not** the final visualization.

## How to run it

You only need Python 3 (already installed on macOS) and an internet connection. There is nothing to install.

1. Open a terminal (on a Mac: Terminal app).
2. Go into the project folder:
   ```sh
   cd path/to/lease-lens
   ```
   For example: `cd ~/lease-lens`
3. Start a small local web server:
   ```sh
   python3 -m http.server 8000
   ```
   Leave this terminal window open while you use the explorer. (On Windows, use `python` instead of `python3`.)
4. In your browser, go to: **http://localhost:8000/explorer/**
5. When you're done, go back to the terminal and press **Ctrl + C** to stop the server.

**Troubleshooting**

- **The page says "Could not load the CSV files".** You probably double-clicked `index.html`. Browsers block a page opened straight from disk from reading the CSVs. Use the server steps above instead.
- **You get "Address already in use".** Port 8000 is busy, so pick another number: run `python3 -m http.server 8080` and open `http://localhost:8080/explorer/`.
- **The page is blank or the map has no background.** Check your internet connection. The charting libraries (D3, Leaflet) and the map tiles load from the web.
- **The page is blank even with internet.** Make sure you started the server from the **repo root** (the folder that contains both `data/` and `explorer/`), not from inside `explorer/`.

## Files

- `js/data.js` loads both CSVs and normalizes them into one list of evaluations. No rows are dropped. Anomalies get flags instead.
- `js/charts.js` has the shared D3 helpers: histogram, scatter, box plot, heatmap, tooltip, and the "marks & channels" legend.
- `js/views.js` holds the 10 views and the Data notes tab.
- `js/app.js` handles the filters, summary stats, sketch ideas, and tabs.

## Key facts about the data (verified against the CSVs)

| | Pre-2023 | 2023–current |
|---|---|---|
| Rows / buildings | 11,760 / 3,513 RSNs | 6,806 / 3,590 RSNs |
| Dates | 2017-09-13 – 2023-05-30 | 2023-06-05 – 2026-09-28 |
| Score column | `SCORE` (mean 73.8, median 74) | `CURRENT BUILDING EVAL SCORE` = `PROACTIVE BUILDING SCORE` + `CURRENT REACTIVE SCORE` (mean 88.9, median 91) |
| Categories | 20, rated 1–5 | 50, rated 0–3 |
| Evaluations per building | mostly 3–4 | mostly 2 |

- **Column names differ** in style: `YEAR_BUILT` in one file, `YEAR BUILT` in the other. The descriptive fields mean the same thing in both files. The inspection categories are completely different.
- **Identifier:** `RSN`. 3,445 RSNs appear in both files. Building attributes stay the same for a given RSN. Address text changes for 4 RSNs, so evaluations are matched by RSN, never by address.
- **The scoring method changed in 2023.** Scores from the two files are not directly comparable. The tool shows each period in its own panel and warns you when they are mixed.

## Transformations / calculated fields

The **Data notes** tab in the app has the full list and live counts.

- `yearEvaluated` comes from the date. The raw pre-2023 `YEAR_EVALUATED` is blank or inconsistent in about 3,900 rows, and one 2023+ row says `202510`.
- `age` is the evaluation year minus year built. `decade` is the decade built.
- Rating values are trimmed, because the 2023+ file has values like `" 3"`. `N/A` (not applicable) is kept separate from blank.
- "Poor" is configurable in the sidebar. The defaults are ≤2 on the 1–5 scale and ≤1 on the 0–3 scale.
- 446 rows have X/Y but no lat/lon. For these, lat/lon is estimated with an affine least-squares fit, and the rows are flagged `coords-derived`. 14 rows have no coordinates at all.
- `scorePctInEra` is the percentile rank of a score within its own period.
- Flags: `created-in-error` (7 pre-2023 rows), `no-ratings` (1 row with score 0), `duplicate-rsn-date`, `closed`, `year-built-missing`, `year-evaluated-mismatch`, `coords-derived`, `coords-missing`. Flagged rows are included by default.
