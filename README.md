# CartograPy

![CartograPy banner](img/banner.png)

Print topographic maps at physically correct scale — usable in the field with
compass, ruler, and UTM/MGRS coordinates.

## Why

Hikers, orienteers, and outdoor professionals need paper maps where 1 mm on the
sheet is exactly a known distance on the ground. CartograPy generates such maps
as PDF — with reference grid, waypoints, and measurement tools — printable at
100 % from any printer.

![Main interface](img/main.png)

## Features

- **Physically correct scale** — 1:2 500 to 1:200 000 (or any custom value)
- **41 map sources** — 32 base maps + 9 overlays from OpenStreetMap, Esri, USGS,
  Swisstopo, IGN España, Kartverket, CartoDB, EMODnet/GEBCO, and more
- **19 grid systems** — UTM, MGRS, Lat/Lon, Gauss-Boaga, Swiss LV95, BNG, Dutch
  RD, Gauss-Krüger, Irish, EOV, KKJ, NZTM, SWEREF99, RT90, and others
- **Multi-sheet output** — 1–20 sheets with overlap markers and a position
  diagram, one PDF page per sheet
- **Waypoints** — click, type coordinates (UTM, MGRS, Lat/Lon DD/DM/DMS), bulk
  import; named sets stored as JSON
- **Measurement tools** — ruler, protractor, polyline, compass; live readings
  and rendered on the PDF
- **Smart search** — Photon autocomplete while typing, full Nominatim geocoding
  on Enter, last 10 searches persisted
- **Weather widget** — Open-Meteo hourly forecast; optional RainViewer radar
  and OpenWeatherMap overlays (free key)
- **Tile cache** — disk cache shared by web UI, tkinter GUI, and PDF exporter;
  XYZ and OGC WMS handled identically
- **Multi-language UI** — English, Italian, Chinese; add a language by dropping
  a JSON file into [cartograpy/static/lang/](cartograpy/static/lang)
- **Two interfaces** — Leaflet web app (default) and an alternative tkinter GUI

![Tools](img/tools.png)

## Requirements

- Python ≥ 3.10 (with `tkinter`, normally bundled)
- Internet on first use; tiles are cached in `~/.cartograpy/tiles/`

## Quick start

```bash
git clone https://github.com/AeonDave/cartogra-py.git
cd cartogra-py
pip install -r requirements.txt
python run.py
```

The browser opens at `http://127.0.0.1:8271`. Press `Ctrl+C` to stop.

Optional, for the MGRS grid:

```bash
pip install mgrs
```

The alternative tkinter GUI:

```python
from cartograpy.app import CartograPyApp
CartograPyApp().mainloop()
```

## Workflow

1. Search for a place or pan/zoom the map
2. Set the **scale** (e.g. `10000` for 1:10 000)
3. Choose **paper size**, **orientation**, and **number of sheets**
4. The red dashed rectangle shows the print area; multi-sheet mode adds inner
   page boundaries
5. Pick a **grid system** — labels and lines update live
6. Add **waypoints** and use the **ruler / protractor / polyline / compass**
7. Click **Export PDF** and **print at 100 %** (no "fit to page")

> [!IMPORTANT]
> Printing with "fit to page" breaks the physical correspondence between paper
> and ground. Always print at actual size.

## Scale formula

```
1 mm on paper  =  scale / 1000  metres on the ground
```

At 1:10 000 and 300 DPI each pixel covers ≈ 0.85 m.

## Map sources

| Group | Sources |
|---|---|
| Global | OpenTopoMap, OpenStreetMap, CyclOSM, OSM DE, OSM France, OSM HOT, OPNVKarte |
| Esri | Streets, Topo, Satellite, NatGeo, Ocean Basemap |
| CartoDB | Positron, Voyager, Voyager NoLabels, Dark |
| Marine | EMODnet Bathymetry, GEBCO (WMS) |
| Regional | TopPlusOpen / BaseMap DE, Géoportail FR + Ortho, Swisstopo + Satellite, BasemapAT + Ortho, NL Kadaster, Kartverket Topo + Greyscale (NO), IGN España MTN, USGS Topo + Imagery |
| Overlays | Esri World Hillshade, OpenSeaMap Seamarks, OpenSnowMap Pistes, OpenRailwayMap, WaymarkedTrails Hiking · MTB · Cycling · Slopes · Riding |

WMS sources are proxied locally via `/api/tile/<source>/{z}/{x}/{y}.png` so they
share the same disk cache as XYZ tiles. Full list in
[cartograpy/tiles.py](cartograpy/tiles.py) (`TILE_SOURCES`).

## Grid systems

UTM · MGRS · Lat/Lon (auto DD / DM / DMS) · Gauss-Boaga (IT) · Swiss CH1903+ /
LV95 · British National Grid · Dutch RD New · German Gauss-Krüger · Irish Grid
+ ITM · Hungarian EOV · Finnish KKJ · NZTM · Swedish SWEREF 99 TM + RT90 ·
South African Lo29 · Taiwan TWD97 / TM2 · Qatar National Grid

## Configuration

CartograPy uses two separate JSON files:

| File | Purpose |
|---|---|
| `cartograpy-server.json` | Bootstrap: HTTP port, browser auto-open. Created beside `run.py` (or `CartograPy.exe`) on first launch. |
| `data/config.json` | Last-used UI state (scale, paper, source, position, language, search history…). Updated automatically. |

Saved waypoints and tool drawings live in `data/waypoints/*.json` and
`data/tools/*.json`.

## Windows executable

Build a portable launcher with tray icon and dedicated controller window:

```bash
pip install -r requirements-build.txt
python build_windows_exe.py
```

Outputs `dist/CartograPy/CartograPy.exe` plus the required `_internal/` folder.

Package the release archive (PowerShell):

```powershell
Compress-Archive -Path 'dist/CartograPy/*' -DestinationPath 'dist/CartograPy-windows-x64.zip'
```

The `.exe` alone is not enough — `_internal/` must travel with it.

To preview the launcher without building:

```bash
pip install -r requirements-build.txt
python -m cartograpy.launcher
```

## Adding a language

1. Copy [cartograpy/static/lang/en.json](cartograpy/static/lang/en.json) →
   `cartograpy/static/lang/<code>.json`
2. Translate the values; keep the keys
3. Add `<option value="<code>">Name</option>` to the language `<select>` in
   [cartograpy/static/index.html](cartograpy/static/index.html)

## Frontend development

The web UI ships as a single bundled file ([cartograpy/static/app.js](cartograpy/static/app.js))
generated from the ES modules in [cartograpy/static/src/](cartograpy/static/src).
The bundle is committed so the project runs out of the box without Node.js.

If you want to modify the frontend you need [Node.js](https://nodejs.org) once:

```bash
npm install            # installs esbuild locally (devDependency)
npm run build          # one-shot rebuild
npm run watch          # rebuild on every save
```

Edit the modules under `cartograpy/static/src/` only — never `app.js` directly
(it gets overwritten on every build). After committing changes, commit the
rebuilt `app.js` together with the source edits so users without Node.js still
get the up-to-date UI.

## Project layout

```
cartograpy/
  server.py        HTTP server + REST API (default interface)
  app.py           tkinter alternative GUI
  launcher.py      Desktop controller window for the Windows build
  tiles.py         TileCache + TILE_SOURCES (XYZ and WMS)
  grid.py          19 grid systems via pyproj
  geocoder.py      Nominatim + Photon clients
  export.py        PDF generator (true-scale)
  utils.py         Shared math and constants
  static/
    index.html     Single-page Leaflet UI
    app.js         esbuild bundle (generated)
    style.css      UI styles
    lang/          Translation JSON files
    src/           ES modules — edit these, then `npm run build`
```

For an in-depth contributor guide see [AGENTS.md](AGENTS.md).

## License

Personal use. Map data © OpenStreetMap contributors (ODbL); other sources retain
their own licences (see attributions in the UI).
