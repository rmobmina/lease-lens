# Data notes

How `shared/js/data.js` reads the two RentSafeTO CSVs in `data/`. (Kept from the retired Milestone 3 data explorer.)

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
- **The scoring method changed in 2023.** Scores from the two files are not directly comparable. The site shows one scoring system at a time.

## Transformations / calculated fields

The dashboard's About page lists the live counts of records left out.

- `yearEvaluated` comes from the date. The raw pre-2023 `YEAR_EVALUATED` is blank or inconsistent in about 3,900 rows, and one 2023+ row says `202510`.
- `age` is the evaluation year minus year built. `decade` is the decade built.
- Rating values are trimmed, because the 2023+ file has values like `" 3"`. `N/A` (not applicable) is kept separate from blank.
- "Rated poorly" is ≤2 on the 1–5 scale and ≤1 on the 0–3 scale.
- 446 rows have X/Y but no lat/lon. For these, lat/lon is estimated with an affine least-squares fit, and the rows are flagged `coords-derived`. 14 rows have no coordinates at all.
- `scorePctInEra` is the percentile rank of a score within its own period.
- Flags: `created-in-error` (7 pre-2023 rows), `no-ratings` (1 row with score 0), `duplicate-rsn-date`, `closed`, `year-built-missing`, `year-evaluated-mismatch`, `coords-derived`, `coords-missing`. The loader keeps every row; `dashboard/js/model.js` leaves out `created-in-error`, `no-ratings` and `duplicate-rsn-date` rows and rows with no score (`EXCLUDED_FLAGS`).
