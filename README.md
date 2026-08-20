# Secondary Rail Freight Market Dashboard

A self-contained web dashboard tracking secondary railcar auction market bids
(BNSF, Union Pacific, and CPKC grain shuttle / non-shuttle service) against
historical seasonal patterns, a forward-market outlook, and an integrated
correlation model combining 10 external inputs — PNW export volume, rail
car dwell, train speed, corridor weather (temperature/snowfall at 4
stations), and ND+SD+MN row-crop production (corn/soybeans/wheat) —
selectable individually (simple correlation) or in any combination
(multiple linear regression), with a one-click search for the best-fitting
combination.

No build step, no framework, no dependencies. Plain HTML/CSS/JS, hand-rolled
SVG charts, data loaded from static JSON files via `fetch()`.

## Quick start

Because the app loads its data with `fetch()`, it must be served over HTTP —
opening `index.html` directly via `file://` will fail silently (or show a
console error) due to browser CORS restrictions on local file reads.

From this folder, run any static file server, e.g.:

```bash
python3 -m http.server 8080
# then open http://localhost:8080/index.html
```

or, with Node:

```bash
npx serve .
```

## File structure

```
index.html   — markup shell: header, filter row, 6 tab buttons, 6 empty panel divs, tooltip div
styles.css   — all styling, incl. light/dark theme via CSS custom properties on :root
app.js       — all logic: data loading, chart rendering, tab rendering, filters, theme toggle,
               live "Check for new data" API refresh, OLS regression for the correlation model
data/
  secondary_railcar_bids.json      — cleaned columnar rail-bid dataset (core dataset, all tabs)
  pnw_bulk_export_monthly.json     — monthly PNW bulk-export tonnage by port (Correlation model tab)
  rail_origin_dwell_monthly.json   — monthly grain-shuttle origin dwell hours by railroad (Correlation model tab)
  rail_terminal_dwell_monthly.json — monthly system-wide terminal dwell hours by railroad (Correlation model tab)
  rail_train_speed_monthly.json    — monthly train speed (mph), grain & system-wide, by railroad (Correlation model tab)
  weather_stations_monthly.json    — monthly avg temp (°F) & snowfall (in) at 4 corridor stations (Correlation model tab)
  row_crop_production_annual.json  — annual corn/soybean/wheat production, ND+SD+MN summed (Correlation model tab)
```

### `secondary_railcar_bids.json` shape

Columnar (parallel arrays, one entry per row):

```json
{
  "companies": ["BNSF", "UP", "CPKC"],
  "types": ["Non_Shuttle", "Shuttle"],
  "date":  ["2026-07-23", ...],
  "c":     [0, 0, 1, ...],   // index into companies
  "t":     [0, 1, 0, ...],   // index into types
  "near":  [true, false, ...],  // near-month (spot) indicator
  "horizon": [0, 2, ...],       // months out this bid targets, from date
  "bid":   [193.75, -50, ...]   // $ premium (+) / discount (–) per car vs. tariff
}
```

`app.js` expands this into a `ROWS` array of row objects (`{date, t, company,
type, near, horizon, bid}`) on load, and derives `targetYearMonth(date,
horizon)` client-side to reconstruct which contract month/year each bid
applies to (this is how the forward-curve / outlook projection is built —
there's no separate "month_bid_on" field retained in the trimmed JSON).

### `pnw_bulk_export_monthly.json` shape

```json
{ "month": ["2010-01", ...], "mt": [1234567.8, ...] }
```

Monthly bulk (non-container) export tonnage summed across 8 Pacific Northwest
ports: Seattle, Tacoma, Portland OR, Vancouver WA, Longview, Kalama, Aberdeen
WA, Astoria.

### `rail_origin_dwell_monthly.json` / `rail_terminal_dwell_monthly.json` shape

Both files share the same columnar shape:

```json
{ "railroads": ["BNSF", "UP", "CPKC"], "month": ["2014-10", ...], "r": [0, ...], "hours": [14.3, ...] }
```

`r` indexes into `railroads`. Origin is monthly-averaged from weekly STB
dwell-at-origin hours filtered to `commodity='Grain'` (grain shuttle trains
specifically). Terminal is monthly-averaged from weekly system-wide dwell
hours (`yard='System Average'`, all commodities — the STB doesn't break
terminal dwell out by commodity, so it's a coarser proxy than origin dwell
when compared against grain shuttle bids).

### `rail_train_speed_monthly.json` shape

```json
{ "railroads": ["BNSF", "UP", "CPKC"], "commodities": ["Grain", "System"], "month": ["2014-10", ...], "r": [0, ...], "c": [0, ...], "mph": [19.6, ...] }
```

`r` indexes into `railroads`, `c` into `commodities`. Same STB Rail Service
Metrics collection and cadence as the dwell files above — `commodity='Grain'`
is grain-train-specific, `commodity='System'` is each railroad's overall
average across all commodities (the speed analog of dwell's "System
Average" terminal).

### `weather_stations_monthly.json` shape

```json
{
  "stations": [
    {"id": "USW00094012", "name": "Havre Airport ASOS, MT US"},
    {"id": "USC00325993", "name": "Minot Experimental Station, ND US"},
    {"id": "USW00014929", "name": "Aberdeen Regional Airport, SD US"},
    {"id": "USC00244558", "name": "Kalispell Glacier Airport, MT US"}
  ],
  "month": ["1990-01", ...], "s": [0, ...], "tavg_f": [26.5, ...], "snow_in": [3, ...]
}
```

`s` indexes into `stations`. Monthly average temperature (°F) and total
snowfall (inches) from NOAA NCEI's Global Summary of the Month,
`units=standard`, for 4 stations along the BNSF/CPKC Hi-Line grain
corridor, all now spanning essentially the full 1990-01 through 2026-07 (or
-06) window with only minor gaps — see the substitution history below for
why Minot and the Whitefish-area station aren't the towns' own airports.
`app.js` handles each null independently per calculation rather than
dropping the whole month, and the "combined" station option averages only
whichever stations report a value for a given month rather than requiring
all 4.

**Station substitution history**: the original picks (Minot International
Airport, and the actual in-town Whitefish, MT station) turned out to have
data problems that surfaced as "not enough overlapping months" errors in
the Correlation model tab — Minot's airport is missing `SNOW` for ~58% of
months, and Whitefish's own station stops reporting in 2014-06 entirely
(zero overlap with the 2014-10+ dwell/speed data). Both were swapped for
better-covered nearby alternatives: Minot Experimental Station (`SNOW`
missing only ~30% of months) and Kalispell Glacier Airport (~15 mi from
Whitefish, continuous through 2026, same general valley climate).

### `row_crop_production_annual.json` shape

```json
{ "states": ["ND", "SD", "MN"], "year": [1995, ...], "corn_bu": [965690000, ...], "soybeans_bu": [...], "wheat_bu": [...] }
```

One row per year, 1995–2025, each crop's production (bushels) already
summed across ND+SD+MN. Kept as 3 separate variables in the model rather
than one combined "row crop" total — a bushel of corn (56 lb), soybeans
(60 lb), and wheat (60 lb) are different physical weights, so summing raw
bushels across crop types wouldn't be a meaningful quantity; summing the
*same* crop's bushels across 3 states is fine. `app.js` broadcasts each
annual value across that year's 12 months (`annualToMonthly()`) to fit
into the otherwise-monthly model — a step function, not a real monthly
series, since NASS only publishes this once a year.

## Data sources & refresh

All datasets come from USDA AMS's AgTransport open data portal
(agtransport.usda.gov), a Socrata platform.

**Secondary railcar bids** — dataset `cvu8-kpyk`.
**PNW port exports** — dataset `v58g-swkr`.
**Rail origin dwell times** — dataset `34cn-rk65` (STB Rail Service Metrics).
**Rail terminal (destination) dwell times** — dataset `9z94-b4fw` (STB Rail Service Metrics).
**Rail train speeds** — dataset `2wy9-nmz4` (STB Rail Service Metrics). Note:
this was initially mistaken for a dwell-time dataset since it's from the
same STB Rail Service Metrics collection — it's actually speed in mph,
broken out by commodity (`Grain`, `System`, plus others not used here).

**Weather** comes from a separate agency/portal: NOAA NCEI's Data Service
API (`https://www.ncei.noaa.gov/access/services/data/v1`), no API key
required. Dataset `global-summary-of-the-month`, `dataTypes=TAVG,SNOW`,
`units=standard`, one station at a time via `stations=<id>`.
`startDate`/`endDate` are required query params even though NOAA's own docs
list them as optional — omitting either returns a 400. Station discovery
used NCEI's search endpoint (`https://www.ncei.noaa.gov/access/services/search/v1/data?bbox=North,West,South,East&dataset=global-summary-of-the-month`),
since the CDO v2 API's station search requires a separate token.

Stations: `USW00094012` (Havre Airport ASOS, MT), `USC00325993` (Minot
Experimental Station, ND), `USW00014929` (Aberdeen Regional Airport, SD),
`USC00244558` (Kalispell Glacier Airport, MT — a Whitefish-area
substitute). All were picked by searching a small bbox around the target
town/area and comparing GSOM completeness for `TAVG`/`SNOW`; see "Station
substitution history" above for why 2 of the 4 aren't the towns' own
airports.

**Row-crop production** comes from a third agency: USDA NASS's Quick Stats
API (`https://quickstats.nass.usda.gov/api/api_GET/`). Unlike AgTransport
and NOAA, this one **requires a free API key** — register at
`https://quickstats.nass.usda.gov/api` (email only, key arrives instantly
by email, no password/account). Query shape: `commodity_desc=CORN` (or
`SOYBEANS`/`WHEAT`), `statisticcat_desc=PRODUCTION`,
`agg_level_desc=STATE`, `state_alpha=ND|SD|MN`, `unit_desc=BU`,
`reference_period_desc=YEAR` (excludes in-season Aug/Oct/Nov forecast
rows), `class_desc=ALL CLASSES` (for wheat, collapses
winter/spring/durum into one total), `util_practice_desc=GRAIN` for corn
or `ALL UTILIZATION PRACTICES` for soybeans/wheat, `domain_desc=TOTAL` and
`source_desc=SURVEY` (both required to exclude Census of Agriculture
years — 2012/2017/2022 — from returning a second, differently-sourced
total alongside the annual survey estimate), and
`prodn_practice_desc=ALL PRODUCTION PRACTICES` (required for wheat in
1995–2003, which otherwise also returns irrigated/non-irrigated/fallow
sub-totals as separate rows — this exact combination of filters took
several iterations to land on cleanly; skipping any one of them
reintroduces duplicate or wrong rows for at least one crop/year range).

To refresh either dataset, use the classic Socrata SODA resource endpoint —
**not** the `/api/v3/views/{id}/query.json` endpoint, which ignores
query-string parameters and always returns the entire dataset:

```
https://agtransport.usda.gov/resource/{dataset-id}.json?$limit=...&$select=...&$where=...&$order=...
```

Useful SoQL params: `$limit` / `$offset` for pagination, `$select` for column
projection or server-side aggregation (`sum(mt)`, `count(*)`), `$where` for
filtering, `$order` for sorting.

Notes learned the hard way while building v1, worth keeping in mind for any
refresh tooling:

- The `bid` field comes back as a JSON **string** (sometimes comma-formatted,
  e.g. `"1,000"`), not a number — cast/clean it on ingest.
- For the PNW dataset, filter to `conflag='Bulk'` to exclude container
  cargo (containers were explicitly excluded from this dashboard's scope).
- Prefer **OR-chained conditions** (`port='A' OR port='B' OR ...`) over SoQL
  `IN(...)` clauses when querying multiple values — `IN()` was observed to
  silently return wrong/incomplete results in this dataset via some fetch
  tooling. Keep queries simple, fetch one dimension (e.g. one port) at a
  time, and cross-validate sums (e.g. two ports' individual sums should
  exceed either alone) before trusting an aggregated result.
- Row counts as of the last manual refresh (2026-08-05): 16,299 rows for
  `cvu8-kpyk` (1997-05-03 through 2026-07-23), 197 months of aggregated PNW
  bulk export data (2010-01 through 2026-05) from `v58g-swkr`, 299
  railroad×month rows of origin dwell (2014-10 onward) from `34cn-rk65`, 241
  railroad×month rows of terminal dwell (2017-03 onward, CPKC only from
  2025-05) from `9z94-b4fw`, 540 railroad×commodity×month rows of train
  speed (2014-10 onward) from `2wy9-nmz4`, 1,752 station×month weather rows
  across the 4 stations (see coverage notes above) from NOAA NCEI, and 31
  crop-year rows (1995–2025, each already summed across ND+SD+MN) per
  commodity from USDA NASS.

The header's **"Check for new data"** button live-fetches any bid/PNW rows
published since the bundled snapshot (via `refreshFromApi()` in `app.js`)
and updates the current session in place, with links to download refreshed
JSON to overwrite `data/`. It does not yet cover the dwell, speed, weather,
or crop datasets — to refresh dwell/speed, re-query the endpoints above
(`commodity='Grain'` for origin dwell & grain speed, `yard='System Average'`
/ `commodity='System'` for terminal dwell & system speed, OR-chained across
the 3 railroads); to refresh weather, re-query each station individually
from NOAA NCEI (one `stations=<id>` per request); to refresh crop
production, re-query NASS once per commodity with `year__GE=<last year on
file>` (the state/domain/source/practice filter combination documented
above); re-aggregate to monthly averages (or annual sums, for crops) and
overwrite the files in `data/`.

## Dashboard tabs & methodology

1. **Current snapshot** — latest bid + delta vs. prior report + sparkline
   per railroad×service combination, plus the current forward curve (bid vs.
   months-out horizon).
2. **Full history** — 1997–2026 multi-line time series (near-month/spot bids
   only), with a table view toggle.
3. **Seasonal comparison** — current year plotted against all prior years by
   week-of-year, one combination at a time, with the current year's line
   extended past today using the forward-curve projection (see below).
4. **Trailing average** — weekly bid vs. a 52-week rolling average.
5. **Correlation model** — an integrated model combining every correlation
   factor explored in this project into one tab, replacing what were
   originally 3 separate tabs (PNW exports, dwell & speed, weather). 10
   checkable inputs: PNW export volume, dwell (origin/destination), train
   speed (grain/system-wide), weather (avg temp/snowfall, itself backed
   by a Havre / Minot-area / Aberdeen / Whitefish-area / combined station
   selector), and ND+SD+MN row-crop production (corn/soybeans/wheat,
   annual — see below). A **time frame** control (two range sliders, From/To year,
   plus "All history" / "Last 3 years" / "Last 5 years" / "2021–present"
   preset chips) restricts the whole model to a date range, to test whether
   correlations are stronger in recent years than over the full history.
   Checking **exactly one** input shows a simple Pearson-r correlation with
   the same time-series-plus-scatter layout the old individual tabs used.
   Checking **two or more** fits a multiple linear regression (OLS, solved
   via Gaussian elimination in `app.js` — no external stats library)
   predicting bid from all checked inputs at once, reporting R² (variance
   explained), adjusted R² (penalized for input count, to flag
   overfitting), each input's dollar-coefficient and standardized-β (for
   comparing influence across inputs on different scales), and a
   predicted-vs-actual scatter with a 45°-reference least-squares line.
   Only months with **complete data across every checked input, within the
   selected time frame,** are used (multiple regression can't tolerate
   per-predictor holes the way pairwise correlation could), so checking
   more inputs, narrowing the time frame, or picking a short-history
   station shrinks the usable window; the UI surfaces "rows used" and the
   date range so this is never silent.
   Crop production is annual (USDA NASS), not monthly like everything
   else — `annualToMonthly()` broadcasts each year's total across its 12
   months as a step function, so it plugs into the same monthly model
   without a separate code path, but it means every month of a given year
   carries an identical value for that input.
   A **"Find best combination"** button (`findBestCombination()` in
   `app.js`) brute-forces all 1,023 non-empty subsets of the 10 inputs × 5
   weather-station choices (≈4,100 fits, ~1.5s) *within whatever time frame
   is currently set* — it deliberately never changes the Time frame sliders
   itself, so a search run against "2021–present" stays scoped to
   2021–present rather than silently jumping to a different window. It
   ranks by **adjusted** R² (not raw R², which can only increase as inputs
   are added) among candidates with at least 30 complete-case months, then
   auto-checks the winning inputs/station and shows a caption with the
   R², adjusted R², row count, and a standing caveat that an exhaustive
   ~4,000-way search can still surface a lucky-looking result — treat it as
   a lead, not a proven relationship.
   **Findings, consolidated from the individual factors this replaces:**
   dwell is the strongest single input (origin dwell vs. UP · Shuttle bids,
   r ≈ 0.57 over the full 1997–2026 history, 142 months) — and it gets
   *stronger* restricted to recent years (r ≈ 0.67 over 2021–2026 alone);
   the full 7-input model for UP · Shuttle likewise improves from R² ≈ 0.47
   (full history) to R² ≈ 0.56 (2021–present), consistent with the market's
   structure having shifted since the CPKC merger and post-2020 rail
   service disruptions. Train speed is directionally sensible but
   weak (r ≈ -0.22 to -0.25 for BNSF/UP Shuttle grain speed — faster
   service, lower premium — as expected, just not strongly so); PNW export
   volume and corridor weather are both weak everywhere checked (|r| under
   ~0.25). The full 7-input model run across all 5 combinations lands
   R² ≈ 0.26–0.47 for BNSF/UP, but hits R² ≈ 0.82 (adjusted R² ≈ 0.58) for
   CPKC on only 13 complete-case rows against 7 predictors — a small-sample
   overfitting flag the adjusted-R² column is specifically there to catch,
   not a real signal that CPKC's market is that much more predictable.
   System-wide dwell/speed are weaker than their grain-specific
   counterparts throughout, consistent with being commodity-agnostic.
   ND+SD+MN crop production is weak on its own too (BNSF · Shuttle:
   soybeans r ≈ 0.22, corn r ≈ 0.13, wheat r ≈ 0.03), but running "Find
   best combination" with all 10 inputs turned up a 5-input combination
   (PNW + dwell origin + system-wide speed + snowfall + wheat production)
   at R² ≈ 0.42 — one data point suggesting crop production may contribute
   as part of a broader combination rather than alone, though per the
   overfitting caveat above this is a lead to verify, not a settled finding.
6. **2026 outlook** — spot (solid) vs. forward-quoted (dashed) bid by month
   for the current year, plus every prior year in gray (individually
   toggleable via the legend) for context. A **"Run best-fit scenario"**
   button (`computeModelScenario()` in `app.js`) runs the same best-fit
   search as the Correlation model tab for whichever combination is
   selected, over its full history, then predicts the bid under a
   **seasonal** high/average/low: for each of the 12 calendar months,
   every winning input is pinned to *that month's own* historical 90th
   percentile / mean / 10th percentile (`monthlySeasonalStats()` —
   January's typical snowfall, not the annual figure), run through the
   one fitted equation — 3 twelve-point lines, not 3 flat numbers, so a
   seasonal input (snowfall, PNW exports, temperature) produces a
   seasonal-looking scenario line instead of a flat annual guess. Each
   variable's seasonal profile is drawn from its own full history, not
   the (usually much thinner) multi-variable intersection used to fit the
   coefficients — e.g. a 38-row intersection split 12 ways would only
   average ~3 rows/month, too few for a stable percentile. Plotted as 3
   dashed reference lines (green/blue/red for high/average/low) directly
   on the month-by-month chart, overlaid with the gray historical years
   and the current year's actual/forward-quoted lines — but only from the
   first month with **no actual data yet** onward (the same boundary
   where the forward-quoted dashed line already starts); a "forecast"
   drawn back over already-reported months would just be redundant with
   the solid actual line. The 3 stat tiles average only those same
   remaining months, labeled with the exact range (e.g. "avg, Aug–Dec");
   if the year is fully reported already, the tiles say so instead of
   showing a number. Also shows a variable breakdown table — but unlike
   the Correlation model tab's fixed-per-search table, **every** one of
   the 10 model inputs gets its own row and checkbox here (`fitScenarioForSubset()`
   in `app.js`), not just whichever subset the search happened to pick.
   Checking or unchecking a row **re-fits the regression live** with
   whatever's currently checked (no re-running the search), instantly
   updating R²/adjusted R², the coefficients, and all 3 chart lines —
   letting you manually remove an auto-selected input or add one the
   search skipped. Unchecked rows still show that input's own historical
   low/average/high (`standaloneVarStats()`) for reference, just no
   coefficient, since it isn't part of the current fit. A safety floor
   keeps at least one input checked at all times (unchecking the last one
   just reverts), and if a manually-built combination doesn't have enough
   overlapping data, that one checkbox change is rejected with an inline
   note rather than leaving the model in a broken state. The caption
   reads "Best-fit inputs" after running the button, or "Current inputs
   (manually adjusted...)" once you've touched a checkbox — click "Re-run
   scenario" any time to throw away manual changes and go back to the
   auto-detected best fit. Carries the same overfitting and
   multicollinearity caveats as the Correlation model tab — this is a
   scenario to compare against, not a forecast.
   A 4th **"Custom"** line lets each checked input independently use its
   own low/average/high instead of all inputs moving together like the 3
   scenarios above. Each included row in the variable table gets a
   **"Level"** column with Low/Avg/High radio buttons (unchecked rows show
   "—", since they have no coefficient to apply a level to); picking a
   level updates `state.outlookVarLevel[key]` and recomputes the custom
   line live via `customMonthlyFor()`, which walks the same seasonal
   percentiles as the other 3 lines but looks up each variable's *own*
   selected level (defaulting to average for anything not yet touched)
   rather than one level for all. A 4th stat tile ("Custom scenario")
   averages it over the same remaining months as the other 3, and it gets
   its own dashed line and legend entry on the chart (orange, matching
   `--series-2`). Levels reset to average whenever "Re-run scenario" is
   clicked (a fresh search should start from a neutral mix) but persist
   through checkbox toggles, so unchecking/rechecking an input keeps
   whatever level you'd set for it.
   Below the chart, a **"Chart zoom"** section adds 4 range sliders — X
   from/to (month 1–12) and Y min/max ($, bounds computed from the same
   auto-scale math `drawLineChart()` already uses, so the sliders' default
   positions exactly reproduce the unzoomed view) — plus a "Reset zoom"
   button. `drawLineChart()` now accepts explicit `yMin`/`yMax` overrides
   the same way it already accepted `xMin`/`xMax`, so zooming is just
   passing the slider values through instead of letting the chart
   auto-fit; SVG's default `overflow:hidden` on the root element clips
   anything scaled outside the visible range for free, so no separate
   point-filtering is needed. Zoom persists through incidental changes on
   the same combination (toggling a year in the legend, running the
   scenario) but resets to the new natural range when switching
   railroad/service, since the $ scale differs a lot between them. The
   same slider row markup (`makeRangeSliderRow()`) also backs the
   Correlation model tab's Time frame sliders, extracted out of that tab
   to avoid the two copies drifting apart.

**Forward-curve / outlook methodology**: rather than a statistical
extrapolation, both the Outlook tab and the Seasonal Comparison tab's
current-year projection use the market's *own* forward bids — for each
month with no actual (near-month) bid yet, the most recently quoted forward
bid whose target contract month/year matches is used. Gaps (months the
market hasn't quoted yet — forward horizon rarely exceeds ~7 months) are
rendered as real breaks in the dashed line rather than interpolated over,
via a "run splitting" helper (`getYearProjection` / `projectedRuns` in
`app.js`) that groups projected points into contiguous month runs so a
missing month shows as a visible gap.

## Design notes

Built against a validated categorical palette (5 series colors: blue,
orange, aqua, yellow, magenta) with checked contrast/CVD-safety, light and
dark themes via CSS custom properties, crosshair+tooltip on all line charts,
legend toggle-to-isolate, and an accessible table view alongside every
chart. No external charting library — all SVG is hand-rolled in `app.js`
(`drawLineChart`, `drawSparkline`, `drawScatterChart`). No external stats
library either — the Correlation model tab's multiple regression is a
from-scratch OLS solve (`fitOLS` / `solveLinearSystem` in `app.js`) via
Gaussian elimination with partial pivoting on the normal equations.

## Known limitations / open items

- The live "Check for new data" refresh covers the bid and PNW export
  datasets only; the dwell, speed, weather, and crop production datasets
  still require a manual refresh — see "Data sources & refresh" above.
- Five correlation factors are in the model (PNW export volume, dwell
  times, train speed, corridor weather, row-crop production); dwell is the
  standout (up to r ≈ 0.57), the rest are weak individually (weather tops
  out at |r| ≈ 0.24, checked exhaustively; crop production similarly weak
  alone, see the Correlation model findings above). Untried candidates:
  grain futures/basis, diesel fuel prices, or lagged (rather than
  contemporaneous) versions of any existing comparison.
- Row-crop production is the only NASS-sourced dataset and the only one
  requiring an API key (free, email-only, no account/password) — a
  different registration model than AgTransport (keyless Socrata) and
  NOAA NCEI (keyless REST). It's also the only *annual* input in an
  otherwise-monthly model; `annualToMonthly()` broadcasts one value across
  all 12 months of its year, which mechanically inflates the apparent
  "resolution" of this input relative to how often it's actually measured.
- The multiple-regression model has no protection against multicollinearity
  beyond the adjusted-R² penalty and a hard failure when the design matrix
  is exactly singular — checking two inputs that are strongly correlated
  with each other (e.g. grain and system-wide speed) can still produce
  large, unstable coefficients that don't mean what they'd mean in a
  cleanly-specified model. Treat coefficients as directionally suggestive,
  not as precise dollar-per-unit effects, especially with many inputs
  checked at once or on CPKC's short data window.
- Minot and the Whitefish-area weather station are proxies (Minot
  Experimental Station rather than Minot's airport; Kalispell Glacier
  Airport, ~15 mi away, rather than an in-town Whitefish station) — see
  "Station substitution history" above. Both were swapped in after their
  original picks produced "not enough overlapping months" errors.
- No test suite — verification so far has been manual/visual (Playwright
  screenshot checks during development).
