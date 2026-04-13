# CartograPy

![CartograPy](img/banner.png)

Print topographic maps at physically correct scale — ready for real-world use
with compass, protractor, and UTM/MGRS coordinates in the field.

## Why

Hikers, orienteers, and outdoor professionals need paper maps where
1 mm on the sheet corresponds exactly to a known distance on the ground.
CartograPy generates those maps as PDF, complete with a reference grid,
waypoints, and measurement tools — all exportable and printable at 100 %.

![CartograPy](img/main.png)

## Features

- **Physically correct scale** — from 1:2 500 to 1:200 000; custom values supported
- **26 map sources** — OpenTopoMap, CyclOSM, Esri, Swisstopo, USGS, CartoDB and more
- **19 grid systems** — UTM, MGRS, Lat/Lon, Gauss-Boaga, Swiss LV95, British National Grid, and others
- **Multi-sheet printing** — choose 1–20 sheets to cover a larger area; the PDF contains one page per sheet with overlap indicators and a position diagram
- **Waypoints** — place on map or enter coordinates (UTM, MGRS, Lat/Lon…), assign name/colour/icon, bulk import, save/load sets, snap-to-waypoint
- **Measurement tools** — ruler (distance), protractor (angle), polyline (cumulative distance), compass (radius); results displayed live and drawn on the PDF
- **Tool & waypoint files** — save and load sets of drawings and waypoints as named JSON files
- **PDF export** — paper formats A4, A3, A2, A1, Letter, Legal; portrait or landscape; 150–600 DPI; grid, waypoints and tools rendered on every page
- **Weather widget** — hourly forecast from Open-Meteo with clickable 24 h bar, temperature, precipitation, wind, humidity, cloud cover, and "Now" indicator
- **Weather overlays** — real-time radar via RainViewer (no key required); clouds, precipitation, temperature, wind, and pressure tiles via OpenWeatherMap (free API key)
- **Multi-language UI** — English, Italian, Chinese; add new languages by dropping a JSON file
- **Tile cache** — downloaded tiles stored on disk; no repeated network requests
- **Smart search** — prefix autocomplete via Photon while typing; full geocoding via Nominatim on Enter; last 10 searches persisted across sessions

![CartograPy](img/tools.png)

## Requirements

- Python ≥ 3.10 (with `tkinter` — usually included)
- Internet connection (tiles are fetched once and cached in `~/.cartograpy/tiles/`)

## Installation

```bash
git clone https://github.com/AeonDave/cartogra-py.git
cd cartogra-py
pip install -r requirements.txt
```

Optional — needed only for MGRS grid support:

```bash
pip install mgrs
```

## Usage

```bash
python run.py
```

Opens `http://127.0.0.1:8271` in the default browser. Press `Ctrl+C` to stop.

An alternative tkinter GUI is available via `cartograpy.app.CartograPyApp`.

## Workflow

1. Search for a place or pan/zoom the map
2. Set **scale** (e.g. `10000` for 1:10 000)
3. Choose **paper size**, **orientation**, and **number of sheets**
4. The red dashed rectangle shows the print area; with multiple sheets the inner dividers show each page boundary
5. Select a **grid system** (UTM, MGRS, …) — lines and labels update live on the map
6. Add **waypoints** by clicking the map, entering coordinates, or bulk-importing a list
7. Use the **ruler**, **protractor**, **polyline**, or **compass** tools to measure and annotate
8. Click **Export PDF**
9. Print at **100 %** — do not use "fit to page"

> [!IMPORTANT]
> The PDF must be printed at actual size (100 %). Scaling to fit the page
> breaks the physical correspondence between paper and ground distances.

## Scale formula

```
1 mm on paper  =  scale / 1000  metres on the ground
```

At 1:10 000 and 300 DPI each pixel covers ≈ 0.85 m.

## Map sources

26 tile sources grouped by region:

| Group | Sources |
|---|---|
| Global | OpenTopoMap, OpenStreetMap, CyclOSM, OSM DE, OSM France, OSM HOT, OPNVKarte |
| Esri | Streets, Topo, Satellite |
| CartoDB | Positron, Voyager, Dark |
| Regional | TopPlusOpen (DE), BaseMap DE, Géoportail (FR), Géoportail Ortho, Swisstopo, Swisstopo Satellite, BasemapAT, BasemapAT Ortho, NL Kadaster, USGS Topo, USGS Imagery |

Full list in `TILE_SOURCES` inside [cartograpy/tiles.py](cartograpy/tiles.py).

## Grid systems

UTM · MGRS · Lat/Lon (auto DD / DM / DMS) · Gauss-Boaga (IT) · Swiss CH1903+ / LV95 · British National Grid · Dutch RD New · German Gauss-Krüger · Irish Grid · Irish TM · Hungarian EOV · Finnish KKJ · New Zealand TM · Swedish SWEREF 99 TM · Swedish RT90 · South African Lo29 · Taiwan TWD97 / TM2 · Qatar National Grid

## Adding a language

1. Copy `cartograpy/static/lang/en.json` → `cartograpy/static/lang/<code>.json`
2. Translate the values (keys stay the same)
3. Add `<option value="<code>">Name</option>` to the language `<select>` in `index.html`

## License

Personal use. Map data © OpenStreetMap contributors (ODbL).
