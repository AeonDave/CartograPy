# CartograPy Theme Contract

A **theme is a complete frontend**: markup, stylesheet, optional script and
assets. The application **engine** (the `app.js` bundle built from
`static/src/`, plus `static/lang/`) is shared by all themes and never
duplicated. A theme supplies the DOM; the engine supplies the behaviour.

```
cartograpy/themes/<id>/
  theme.json     required — metadata (see below)
  index.html     required — full page providing the DOM contract
  style.css      required by convention — referenced as /theme/style.css
  theme.js       optional — theme-only chrome (clocks, boot screens, readouts)
  ...assets      optional — png/svg/woff2/… referenced as /theme/<file>
```

## Serving model

| URL | Serves |
|---|---|
| `/` | `themes/<active>/index.html` (active = `theme` key in `data/config.json`, fallback `classic`) |
| `/theme/<path>` | any file inside the **active** theme directory (traversal-safe, whitelist of extensions) |
| `/app.js` | shared engine bundle (`static/app.js`) |
| `/lang/<code>.json` | shared translations |
| `/api/themes` | `{"themes": [{id, name, description, version, author}], "active": "<id>"}` |

`theme.json` fields: `name` (display), `description`, `version`, `author`.
The folder name is the theme id (`[a-z0-9_-]{1,40}`).

A minimal `index.html` skeleton:

```html
<link rel="stylesheet" href="/theme/style.css"/>
... DOM contract elements ...
<script src="/app.js"></script>
<script src="/theme/theme.js"></script>   <!-- optional, AFTER app.js -->
```

Leaflet 1.9.4 + leaflet-rotate 0.2.8 + Font Awesome 6 must be loaded by the
theme `<head>` **before** `app.js` (the engine assumes the `L` global and FA
icon classes).

## Theme switching

Provide `<select id="theme">`. The engine populates it from `/api/themes`,
persists the choice on change (config key `theme`) and reloads the page.

---

# 1. Backend REST API (what the server provides)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/constants` | GET | `scales`, `papers`, `grid_systems`, `sources` (base layers grouped + overlays) — single source of truth from `tiles.py` |
| `/api/search?q=` | GET | Nominatim geocoding → `[{name, lat, lon}]` |
| `/api/suggest?q=&lang=` | GET | Photon autocomplete → same shape |
| `/api/grid?lat&lon&scale&paper&landscape&grid_type&full_labels&sheets` | GET | grid GeoJSON + `zone`, `epsg`, `spacing`, `ground_w/h` |
| `/api/coord2latlon?grid_type=&coords=` | GET | parse projected/DMS coords → `{lat, lon}` |
| `/api/declination?lat&lon[&epsg]` | GET | `{declination, convergence, grid_magnetic, model, year}` |
| `/api/elevation` | POST | `{points: [[lat,lon],…]}` → `{profile, stats}` |
| `/api/route` | POST | `{profile, points}` → BRouter route `{coords, distance, duration, ascend}` |
| `/api/osm_snap?s&w&n&e&types=` | GET | Overpass snap features `{peaks, trails}` |
| `/api/weather?lat&lon[&date]` | GET | Open-Meteo hourly forecast proxy |
| `/api/live_traffic?provider&s&w&n&e` | GET | normalized live markers (aircraft/vessel/train) |
| `/api/export` | POST | full print spec → PDF download |
| `/api/config` | GET/POST | UI state persistence (allowlisted keys incl. `theme`) |
| `/api/waypoints/list|load|save|delete` | GET/POST | named waypoint sets |
| `/api/tools/list|load|save|delete` | GET/POST | named tool-drawing sets |
| `/api/themes` | GET | available themes + active id |
| `/api/tile/<source>/{z}/{x}/{y}.png` | GET | WMS/XYZ proxy through the shared tile cache |
| `/gpx/import`, `/gpx/export` (under `/api/`) | POST | GPX ⇆ waypoints/drawings |

Themes normally never call these directly — the engine does. A `theme.js`
MAY call read-only endpoints (e.g. `/api/declination`) for its own chrome.

# 2. DOM contract (what a theme MUST provide)

The engine queries these at import time; **a missing required element breaks
the whole app** (TypeError during bootstrap). Copy the structure from
`themes/classic/index.html` when in doubt.

## 2.1 Shell & map
| ID | Element | Notes |
|---|---|---|
| `map` | div | Leaflet container. May contain `<div id="crosshair">` |
| `sidebar` | div | gets class `collapsed` toggled |
| `toggleSidebar` | button | opens/closes sidebar; body gets `sidebar-hidden` |
| `closeSidebar` | button | |
| `sidebarBackdrop` | div | mobile backdrop |
| `status` | div | status line (textContent) |
| `mobileToolBar` | div | gets class `visible` |
| `mtbDone`, `mtbUndo`, `mtbCancel` | buttons | mobile tool actions |

## 2.2 Settings / print spec
`language` (select with en/it/zh), `theme` (select, empty — engine fills),
`scale` (number input), `paper` (select), `sheets` (number), `landscape`
(checkbox), `source` (select, empty — engine fills with optgroups),
`dpi` (select), `mapTextScale` (number), `bearing` (number),
`chkMagBadge` (checkbox), `btnExport` (button).

## 2.3 Search
`search` (text input), `btnSearch`, `searchSuggestions` (div, engine fills
`.sg-item` rows), `results` (wrapper) + `resultsList` (select),
`historySection` (wrapper) + `histList` (div, engine fills `.hist-item`
rows with `.hist-name`/`.hist-del`).

## 2.4 Grid
`gridType` (select with the 19 grid keys), `gridScale` (number),
`fullLabels` (checkbox), `gridScaleGroup` + `fullLabelsGroup` (wrappers —
engine toggles `style.display` between `none` and `flex`).

## 2.5 Overlays & traffic
`overlayList` (div — engine fills `label.overlay-row` rows, adds class
`disabled` when an OWM key is missing), `overlayMsg` (div),
`chkTrafficAircraft/Vessels/Trains` (checkboxes),
`trafficAircraftProvider/VesselProvider/TrainProvider` (selects),
`trafficRefreshSec` (number), `trafficMsg` (div).

## 2.6 API keys
`owmApiKey` (hidden input — value store), `owmKeyInput` (wrapper),
`owmKeyField` (text), `owmKeyConfirm`, `owmKeyError`, `owmKeyBadge`
(wrapper), `owmKeyDelete`, `aishubUsername` (text), `gtfsRealtimeUrl` (text).

## 2.7 Tools
`btnRuler`, `btnProtractor`, `btnLine`, `btnCompass`, `btnRoute` (get class
`active`), `btnLineUndo`; per-tool info blocks `rulerInfo/protractorInfo/
lineInfo/compassInfo/routeInfo` with result divs `rulerResult/…/routeResult`
(engine toggles `display`); `routeProfile` (select), `routeDraftPoints`
(div), `btnRouteDone`, `btnRouteCancel`; histories `rulerHistory,
protractorHistory, lineHistory, compassHistory, routeHistory` (divs, engine
fills `.tool-hist-row` with `.tool-hist-text/.tool-hist-elev/.tool-hist-del`
and `.elev-panel` charts), `toolHistorySep`; snap checkboxes `chkSnapWp,
chkSnapPeaks, chkSnapTrails, chkToolsInPdf`; file panel `btnToolSave,
btnToolLoad, btnToolClearAll, toolFilePanel, toolSavePanel, toolFileName,
btnToolSaveConfirm, toolLoadPanel, toolFileList` (engine fills `.tf-item`).

## 2.8 Waypoints
`waypointSection` (**`<details>` element** — engine sets `.open = true`),
`btnWpAddOnMap` (gets `active`), `iconGrid` + `colorGrid` (divs — engine
fills pickers; selection uses class `selected`), `wpDatumLabel` (span),
`wpCoordInput`, `btnWpAdd`, `wpBulkInput` (textarea), `btnWpBulk`,
`wpList` (engine fills `.wp-item` rows with `.wp-name[contenteditable]`,
`.wp-del`), `btnWpClearAll`, `btnWpSave`, `btnWpLoad`, `wpFilePanel`,
`wpSavePanel`, `wpFileName`, `btnWpSaveConfirm`, `wpLoadPanel`,
`wpFileList` (engine fills `.wpf-item` with `.wpf-name`/`.wpf-del`).

## 2.9 Weather widget
`weatherCard` (gets class `visible`), `weatherClose`, `weatherDate` (date
input), `weatherNow`, `weatherIcon`, `weatherTemp`, `weatherFeelsLike`,
`weatherLabel`, `weatherStats` (engine fills `.ws-item`/`.ws-val`),
`weatherBar`, `weatherNowIndicator`, `weatherHourIndicator`,
`weatherLegend` (engine fills `.wleg-dot` rows).

# 3. CSS contract (classes the engine toggles or generates)

**State classes (style them):** `collapsed` (sidebar), `sidebar-hidden`
(body), `active` (tool buttons), `visible` (weatherCard, mobileToolBar),
`selected` (icon/color pickers, wp rows), `disabled` (overlay rows),
`rotating` (compass control), `ruler-cursor` (map container).

**Generated markup (style them):** `.sg-item`, `.hist-item/.hist-name/
.hist-del`, `.overlay-row`, `.wp-item/.wp-name/.wp-del`, `.wpf-item/
.wpf-name/.wpf-del`, `.tf-item/.tf-name/.tf-del/.tf-empty/.tf-error`,
`.tool-hist-row/.tool-hist-text/.tool-hist-elev/.tool-hist-del`,
`.elev-panel/.elev-note/.elev-error`, `.route-draft-list/.route-draft-row`,
`.mag-badge`, `.grid-label` (Leaflet tooltip for grid labels),
`.wp-label` (waypoint name tooltip), `.compass-control/.compass-btn/
.compass-svg`, `.traffic-marker*/.traffic-popup*`, `.ws-item/.ws-val/
.wleg-dot`, plus Leaflet's own `.leaflet-*` controls/popups.

**i18n:** put `data-i18n="key"` on text nodes, `data-i18n-title` /
`data-i18n-placeholder` for attributes; the engine re-translates on
language switch. Keys live in `static/lang/*.json` (shared by all themes).

# 4. JS hook for themes (`theme.js`)

Loaded after `app.js`, a theme script can use:

```js
const { map } = window.CartograPy;       // live Leaflet map instance
map.on('mousemove', e => { /* e.latlng */ });
map.on('moveend',  () => { /* center, zoom */ });
window.CartograPy.onStatus = msg => { /* mirror status text */ };
```

Keep `theme.js` presentational only: readouts, clocks, decorations,
collapse behaviours. Never re-implement engine features in a theme.

# 5. Checklist for a new theme

1. Copy `themes/classic/` to `themes/<id>/`, edit `theme.json`.
2. Restructure `index.html` freely — keep **every** required ID
   (section 2) and the `<details id="waypointSection">` element type.
3. Rewrite `style.css`; cover the generated classes in section 3.
4. Optional `theme.js` for chrome (section 4).
5. Start the server, switch theme from the UI, exercise: search,
   grid, tools (all five), waypoints (add/save/load), overlays,
   weather, traffic panel, export.
