# LeaseLens data: files and fields

LeaseLens uses two CSV files from the City of Toronto's
[Apartment Building Evaluations (RentSafeTO)](https://open.toronto.ca/dataset/apartment-building-evaluation/) dataset,
published under the [Open Government Licence – Toronto](https://open.toronto.ca/open-data-licence/).
Each row is **one inspection (evaluation) of one building**. A building can appear many times, once per inspection.

| File | Inspections (rows) | Buildings | Dates | Scoring system |
|---|---|---|---|---|
| `apartment_building_evaluations_pre_2023.csv` | 11,760 | 3,513 | Sep 2017 – May 2023 | Old system: 20 categories, each rated 1–5 |
| `apartment_building_evaluations_2023_current.csv` | 6,806 | 3,590 | Jun 2023 – Sep 2026 | Current system: up to 50 items, each rated 1–3 |

The two systems score different things on different scales. **Their scores should not be compared with each other.**

How LeaseLens reads and cleans these files, and which rows it leaves out, is described in [docs/data-notes.md](../docs/data-notes.md).
The code that does it is [shared/js/data.js](../shared/js/data.js).

## Fields in both files

The two files use the same fields with slightly different spellings: underscores in the old file (`YEAR_BUILT`), spaces in the current one (`YEAR BUILT`).

| Field | Meaning |
|---|---|
| `_id` | Row number in the City's file. |
| `RSN` | The building's registration number. It is the same across both files and is how LeaseLens links a building's inspections together. |
| `YEAR_REGISTERED` | Year the building first registered with RentSafeTO. |
| `YEAR_EVALUATED` | Year of the evaluation. Often blank or inconsistent in the old file, so LeaseLens takes the year from the inspection date instead. |
| `YEAR_BUILT` | Year the building was built, as reported by the owner or manager. |
| `PROPERTY_TYPE` | Who owns the building: `PRIVATE`, `TCHC` (Toronto Community Housing) or `SOCIAL HOUSING`. |
| `WARD`, `WARDNAME` | Ward number and name, using Toronto's 25-ward system. |
| `SITE_ADDRESS` | Building address. A few old rows start with `** CREATED IN ERROR **`; LeaseLens leaves those out. |
| `CONFIRMED_STOREYS`, `CONFIRMED_UNITS` | Number of storeys and of apartment units. |
| `EVALUATION_COMPLETED_ON` | Date of the inspection (YYYY-MM-DD). |
| `NO_OF_AREAS_EVALUATED` | How many categories (old file) or items (current file) were rated. |
| `GRID` | Bylaw enforcement area the building is in. |
| `LATITUDE`, `LONGITUDE` | Building location. |
| `X`, `Y` | Building location in projected map coordinates (metres). LeaseLens uses these to place the 446 rows that are missing a latitude and longitude. |

## Score fields

| Field | File | Meaning |
|---|---|---|
| `SCORE` | Old | Overall score out of 100. |
| `RESULTS_OF_SCORE` | Old | What the score meant for the next inspection: "Evaluation needs to be conducted in 1 / 2 / 3 years", or "Building Audit". |
| `CURRENT BUILDING EVAL SCORE` | Current | **The overall score out of 100** that LeaseLens shows. It is the proactive score plus the reactive score. |
| `PROACTIVE BUILDING SCORE` | Current | Score from the routine inspection of the common areas: a weighted score of all the items that apply. |
| `CURRENT REACTIVE SCORE` | Current | Deduction for open Orders or Notices of Violation. It is 0 for most rows and between -1 and -9 for the rest. |

## Rating fields (one column per inspected item)

Each of these columns holds one rating from the inspection.

- **Old file, 1–5:** 5 is the best. LeaseLens counts 1 or 2 as "rated low".
- **Current file, 1–3:** 3 is the best. A 0 means the item couldn't be inspected, for example because it was blocked or access was refused. LeaseLens counts 0 or 1 as "rated low".
- **`N/A` or blank** means the item doesn't apply to that building. LeaseLens never counts these as a pass or a problem.

**Old file: 20 categories.**
`ENTRANCE_LOBBY`, `ENTRANCE_DOORS_WINDOWS`, `SECURITY`, `STAIRWELLS`, `LAUNDRY_ROOMS`, `INTERNAL_GUARDS_HANDRAILS`,
`GARBAGE_CHUTE_ROOMS`, `GARBAGE_BIN_STORAGE_AREA`, `ELEVATORS`, `STORAGE_AREAS_LOCKERS`, `INTERIOR_WALL_CEILING_FLOOR`,
`INTERIOR_LIGHTING_LEVELS`, `GRAFFITI`, `EXTERIOR_CLADDING`, `EXTERIOR_GROUNDS`, `EXTERIOR_WALKWAYS`, `BALCONY_GUARDS`,
`WATER_PEN_EXT_BLDG_ELEMENTS` (water getting in through exterior building elements), `PARKING_AREA`, `OTHER_FACILITIES`.

**Current file: 50 items,** grouped here the way LeaseLens's Building X-Ray groups them. The City's full definition of each item is on the
[dataset page](https://open.toronto.ca/dataset/apartment-building-evaluation/) under *Data Features*.

| Group | Items |
|---|---|
| Exterior envelope | `BUILDING EXTERIOR`, `BALCONY GUARDS`, `WINDOWS`, `EXTERIOR DOORS` |
| Shared spaces | Lobby (`LOBBY - WALLS AND CEILING`, `LOBBY FLOORS`), hallways (`INT. HALLWAY - WALLS / CEILING`, `INTERIOR HALLWAY FLOORS`), stairwells (`STAIRWELL - WALLS AND CEILING`, `STAIRWELL - LANDING AND STEPS`), handrails (`INT. HANDRAIL / GUARD - SAFETY`, `INT. HANDRAIL / GUARD - MAINT.`), `MAIL RECEPTACLES`, `LAUNDRY ROOM`, `STORAGE AREAS/LOCKERS MAINT.`, `POOLS`, `OTHER AMENITIES`, `GRAFFITI`, `BUILDING CLEANLINESS`, `COMMON AREA PESTS` |
| Building systems | `ELEVATOR MAINTENANCE`, `ELEVATOR COSMETICS`, `INT. LOBBY / HALLWAY LIGHTING`, `STAIRWELL LIGHTING`, `COMMON AREA VENTILATION`, `ELECTRICAL SERVICES / OUTLETS`, `INTERCOM` |
| Parking, grounds and waste | `EXTERIOR GROUNDS`, `FENCING`, `RETAINING WALLS`, `CATCH BASINS / STORM DRAINAGE`, `EXTERIOR WALKWAYS`, `PARKING AREAS`, `ABANDONED EQUIP./DERELICT VEH.`, `ACCESSORY BUILDINGS`, `CLOTHING DROP BOXES`, `EXT. RECEPTACLE STORAGE AREA`, `INT. RECEPTACLE STORAGE AREA`, `GARBAGE/COMPACTOR ROOM`, `CHUTE ROOMS - MAINTENANCE` |
| Safety and records | `NUMBERING OF PROPERTY`, `EMERGENCY CONTACT SIGN`, `TENANT NOTIFICATION BOARD`, `PEST CONTROL LOG`, `MAINTENANCE LOG`, `CLEANING LOG`, `VITAL SERVICE PLAN`, `ELECTRICAL SAFETY PLAN`, `STATE OF GOOD REPAIR PLAN`, `TENANT SERVICE REQUEST LOG` |

## Other data the site uses

These are already processed and saved in `dashboard/data/`. You only need the original files (kept in `data/raw/`, which is not committed) to rebuild them.

| Folder | What it holds | Source |
|---|---|---|
| `dashboard/data/massing/` | Building footprints and heights for the 3D X-Ray | [3D Massing](https://open.toronto.ca/dataset/3d-massing/) |
| `dashboard/data/wards/` | Simplified ward boundaries for the map | [City Wards](https://open.toronto.ca/dataset/city-wards/) |
| `dashboard/data/hero/` | The homepage drawing of downtown | 3D Massing and [Toronto Centreline](https://open.toronto.ca/dataset/toronto-centreline-tcl/) |
