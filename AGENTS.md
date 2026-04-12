# AGENTS.md — Guida per Agenti AI su CartograPy

Questo file descrive l'architettura, i comandi, le convenzioni e le linee guida operative
per agenti AI (Copilot, Codex, ecc.) che lavorano su questo repository.

---

## 1. Panoramica del progetto

**CartograPy** è un'applicazione Python per visualizzare e stampare mappe topografiche
a scala fisica corretta con sovrimpressione di griglia di riferimento.

| Voce | Valore |
|---|---|
| Versione | `1.0.0` (in `cartograpy/__init__.py`) |
| Linguaggio | Python ≥ 3.10 |
| Dipendenze | `requests`, `Pillow`, `pyproj` (+ `tkinter` dalla stdlib) |
| Interfaccia principale | **Server web** su `http://127.0.0.1:8271` con UI Leaflet |
| Interfaccia alternativa | **GUI tkinter** (`cartograpy/app.py`) |

### Flusso principale

```
python run.py
  └─► server.py::run_server()
        ├─ avvia HTTPServer su 127.0.0.1:8271
        ├─ apre il browser automaticamente (threading.Timer)
        └─ serve static/index.html  +  endpoint API REST
```

---

## 2. Setup e installazione

```bash
# Clona o scarica il repository, poi:
cd cartogra-py
pip install -r requirements.txt
```

**Prerequisiti:**
- Python ≥ 3.10 (con `tkinter` incluso — di solito già presente)
- Connessione internet per scaricare le tile la prima volta
- Le tile scaricate vengono messe in cache su disco in `~/.cartograpy/tiles/`

**Dipendenze opzionali:**
```bash
pip install mgrs   # necessario solo per il sistema di griglia MGRS
```

---

## 3. Avvio e modalità operative

### Modalità web (principale)
```bash
python run.py
```
Avvia il server e apre automaticamente `http://127.0.0.1:8271` nel browser.
Premi `Ctrl+C` nel terminale per chiudere.

### Modalità tkinter (alternativa)
```python
from cartograpy.app import CartograPyApp
CartograPyApp().mainloop()
```
La GUI tkinter è un'interfaccia alternativa con le stesse funzionalità principali
(meno opzioni di griglia rispetto alla versione web).

### Test rapido (nessun browser)
```bash
python -c "from cartograpy.grid import compute_grid; print(compute_grid('utm', 45.0, 10.0, 10000, 8000, 500))"
python -c "from cartograpy.geocoder import geocode; print(geocode('Roma'))"
```

---

## 4. Endpoint HTTP (server web)

Tutti gli endpoint sono gestiti in `cartograpy/server.py` dalla classe `_Handler`.

### GET

| Endpoint | Parametri query | Risposta |
|---|---|---|
| `GET /` | — | `static/index.html` |
| `GET /lang/<code>.json` | — | File di traduzione JSON per la lingua richiesta |
| `GET /api/search` | `q=<testo>` | `[{name, lat, lon}, ...]` |
| `GET /api/grid` | `lat`, `lon`, `scale`, `paper`, `landscape` (0/1), `grid_type`, `full_labels` (0/1) | GeoJSON FeatureCollection + meta |
| `GET /api/constants` | — | `{scales, papers, grid_systems}` |
| `GET /api/coord2latlon` | `grid_type`, `coords=<stringa>` | `{lat, lon}` |
| `GET /api/config` | — | JSON configurazione salvata |
| `GET /api/waypoints/list` | — | `["nome1", "nome2", ...]` |
| `GET /api/waypoints/load` | `name=<nome>` | array waypoint |
| `GET /api/tools/list` | — | `["nome1", "nome2", ...]` |
| `GET /api/tools/load` | `name=<nome>` | array drawing |

### POST (body JSON)

| Endpoint | Campi body | Risposta |
|---|---|---|
| `POST /api/export` | `lat`, `lon`, `scale`, `paper`, `landscape`, `dpi`, `source`, `grid_type`, `grid_full_labels`, `grid_scale`, `map_text_scale`, `waypoints`, `drawings` | file PDF binario |
| `POST /api/config` | chiavi consentite: `scale`, `paper`, `landscape`, `source`, `dpi`, `mapTextScale`, `gridType`, `gridScale`, `fullLabels`, `lat`, `lon`, `zoom`, `language` | `{ok: true}` |
| `POST /api/waypoints/save` | `name`, `waypoints` (array) | `{ok: true, name}` |
| `POST /api/waypoints/delete` | `name` | `{ok: true}` |
| `POST /api/tools/save` | `name`, `drawings` (array) | `{ok: true, name}` |
| `POST /api/tools/delete` | `name` | `{ok: true}` |

---

## 5. Struttura del codice

```
cartogra-py/
├── run.py                    # Punto di ingresso — chiama run_server()
├── requirements.txt          # requests, Pillow, pyproj
├── data/
│   ├── config.json           # Configurazione UI persistente (auto-generato)
│   ├── waypoints/            # File JSON dei waypoint salvati (auto-generati)
│   └── tools/                # File JSON dei disegni strumenti salvati (auto-generati)
└── cartograpy/
    ├── __init__.py           # Versione: __version__ = "1.0.0"
    ├── app.py                # GUI tkinter — CartograPyApp(tk.Tk)
    ├── export.py             # export_map_pdf() — genera PDF a scala corretta
    ├── geocoder.py           # geocode() → List[GeoResult] — Nominatim/OSM
    ├── grid.py               # compute_grid() + 19 sistemi di griglia
    ├── map_widget.py         # MapWidget(tk.Canvas) — visualizzazione interattiva
    ├── server.py             # run_server() + _Handler(BaseHTTPRequestHandler)
    ├── tiles.py              # TileCache, TILE_SOURCES (26 sorgenti)
    ├── utils.py              # Costanti e funzioni matematiche
    └── static/
        ├── index.html        # Interfaccia Leaflet (single-page app)
        └── lang/             # File di traduzione JSON (en/it/zh)
            ├── en.json       # Inglese (default)
            ├── it.json       # Italiano
            └── zh.json       # Cinese
```

### Dettaglio moduli

#### `utils.py` — Costanti e matematica
| Simbolo | Tipo | Descrizione |
|---|---|---|
| `TILE_SIZE` | `int` | 256 px (tile OSM standard) |
| `EARTH_RADIUS` | `float` | 6378137.0 m (WGS-84) |
| `PAPER_SIZES` | `dict[str, tuple[int,int]]` | A4/A3/A2/A1/Letter/Legal in mm (portrait) |
| `SCALES` | `list[int]` | Scale standard: 2500…200000 |
| `deg2num()` | funzione | WGS-84 → coordinate tile frazionarie |
| `num2deg()` | funzione | Coordinate tile → WGS-84 |
| `ground_resolution()` | funzione | Metri/pixel a una data latitudine e zoom |
| `optimal_zoom()` | funzione | Zoom ottimale per scala/DPI — **NON modificare** |
| `auto_grid_spacing()` | funzione | Spaziatura griglia in metri per la scala |
| `latlon_to_pixel()` | funzione | Conversione approssimata WGS-84 → pixel immagine |

#### `tiles.py` — Download e cache tile
| Simbolo | Tipo | Descrizione |
|---|---|---|
| `TILE_SOURCES` | `dict[str, dict]` | 26 sorgenti tile (URL, attribution, max_zoom) |
| `TileCache` | classe | Cache a due livelli: memoria + disco |
| `TileCache.get_tile()` | metodo | Tile sincrona: memoria → disco → rete |
| `TileCache.get_tile_async()` | metodo | Tile asincrona con callback |
| `TileCache.get_area()` | metodo | Composita di tile per un'area rettangolare |

**Struttura cache su disco:** `~/.cartograpy/tiles/{source}/{z}/{x}/{y}.png`

**User-Agent richiesto da OSM:** `"CartograPy/1.0 (map-printing tool; educational)"` — **NON cambiare.**

#### `geocoder.py` — Geocoding
| Simbolo | Descrizione |
|---|---|
| `GeoResult` | `@dataclass(frozen=True, slots=True)` con `name`, `lat`, `lon` |
| `geocode(query)` | Chiama Nominatim, restituisce `list[GeoResult]` |

#### `grid.py` — Sistemi di griglia (19 sistemi)
| Simbolo | Descrizione |
|---|---|
| `GridLine` | `@dataclass(frozen=True, slots=True)` — singola linea in WGS-84 |
| `GridInfo` | `@dataclass(frozen=True, slots=True)` — risultato completo |
| `GRID_SYSTEMS` | `dict[str, str]` — mappa chiave→etichetta UI (19 voci) |
| `compute_grid()` | Dispatcher unificato — **punto di ingresso principale** |
| `compute_utm_grid()` | UTM (zona automatica) |
| `compute_mgrs_grid()` | MGRS (etichette stile militare) |
| `compute_latlon_dd_grid()` | Lat/Lon in gradi decimali |
| `compute_latlon_dm_grid()` | Lat/Lon in gradi + minuti decimali |
| `compute_gauss_boaga_grid()` | Gauss-Boaga Italia (EPSG 3003/3004) |
| `compute_swiss_grid()` | Swiss CH1903+ / LV95 (EPSG 2056) |
| `compute_bng_grid()` | British National Grid (EPSG 27700) |
| `_compute_projected_grid()` | Helper generico per CRS proiettati via EPSG |

I sistemi rimanenti (Dutch, Gauss-Krüger, Irish, EOV, KKJ, NZTM, SWEREF99, RT90,
South African, Taiwan, Qatar) usano tutti `_compute_projected_grid()` con il rispettivo
codice EPSG.

#### `export.py` — Generazione PDF
| Simbolo | Descrizione |
|---|---|
| `export_map_pdf()` | Funzione principale — genera PDF a scala fisica corretta |

**Firma (parametri principali):**
```python
export_map_pdf(
    tile_cache, source_name, center_lat, center_lon,
    scale, paper, landscape, dpi, output,
    grid_type="utm", grid_full_labels=False, grid_scale=50,
    map_text_scale=50, waypoints=None, progress_cb=None,
)
```

#### `server.py` — Server HTTP
| Simbolo | Descrizione |
|---|---|
| `run_server(host, port)` | Avvia HTTPServer su 127.0.0.1:8271 |
| `_Handler` | Sottoclasse di `BaseHTTPRequestHandler` |
| `_parse_coords()` | Converte coordinate proiettate → lat/lon |
| `_parse_latlon_auto()` | Auto-rileva e converte DD/DM/DMS con emisfero |

**Pattern factory handler** (necessario per condividere `tile_cache`):
```python
handler_cls = type("H", (_Handler,), {"tile_cache": tc})
```
**Non modificare questo pattern.**

#### `app.py` — GUI tkinter (alternativa)
| Simbolo | Descrizione |
|---|---|
| `CartograPyApp` | Finestra principale `tk.Tk` |

#### `map_widget.py` — Widget mappa tkinter
| Simbolo | Descrizione |
|---|---|
| `MapWidget` | `tk.Canvas` con pan, zoom, rettangolo di stampa, griglia UTM |

---

## 6. Sistemi di griglia disponibili

| Chiave `grid_type` | Descrizione | EPSG |
|---|---|---|
| `none` | Nessuna griglia | — |
| `utm` | UTM (zona automatica) | auto |
| `latlon` | Lat/Lon DD/DM auto | 4326 |
| `mgrs` | MGRS | auto |
| `gauss_boaga` | Gauss-Boaga Italia | 3003/3004 |
| `swiss` | Swiss CH1903+ / LV95 | 2056 |
| `bng` | British National Grid | 27700 |
| `dutch` | Dutch RD New | 28992 |
| `gauss_krueger` | German Gauss-Krüger | 31466-31469 |
| `irish_ig` | Irish Grid | 29902 |
| `irish_itm` | Irish Transverse Mercator | 2157 |
| `eov` | Hungarian EOV | 23700 |
| `kkj` | Finnish KKJ zone 3 | 2393 |
| `nztm` | New Zealand TM | 2193 |
| `sweref99` | Swedish SWEREF 99 TM | 3006 |
| `rt90` | Swedish RT90 | 3021 |
| `south_african` | South African Lo29 | 2054 |
| `taiwan` | Taiwan TWD97 / TM2 | 3826 |
| `qng` | Qatar National Grid | 28600 |

---

## 7. Convenzioni di codice

- **`from __future__ import annotations`** — obbligatorio in ogni modulo
- **Type hints** su tutte le funzioni pubbliche (parametri e valore di ritorno)
- **Docstring** stile Google/NumPy su classi e funzioni pubbliche
- **`@dataclass(frozen=True, slots=True)`** per DTO immutabili (`GridLine`, `GridInfo`, `GeoResult`)
- **Costanti** in `MAIUSCOLO`
- **Metodi privati** prefissati con `_`
- **Threading** con `daemon=True` per operazioni bloccanti (download, geocoding, export)
- **`Image.MAX_IMAGE_PIXELS = 400_000_000`** impostato in `export.py` — necessario per export ad alto DPI; non rimuovere
- Lunghezza riga: max 100 caratteri

---

## 8. Linee guida per agenti AI

### ✅ Dove aggiungere funzionalità

| Funzionalità | File/Simbolo da modificare |
|---|---|
| Nuova sorgente tile | `tiles.py` → aggiungere voce a `TILE_SOURCES` |
| Nuovo sistema di griglia | `grid.py` → aggiungere a `GRID_SYSTEMS` + aggiungere `compute_XXX_grid()` + aggiornare `compute_grid()` dispatcher |
| Nuovo formato foglio | `utils.py` → aggiungere a `PAPER_SIZES` |
| Nuovo endpoint HTTP | `server.py` → aggiungere handler `_handle_XXX()` in `_Handler` + routing in `do_GET`/`do_POST` |
| Nuova chiave config persistente | `server.py` → aggiungere alla whitelist `allowed` in `_handle_config_save()` |
| Nuova funzionalità waypoint | `server.py` → nuovi handler + `static/index.html` per la UI |
| Nuova lingua UI | `static/lang/` → creare `<code>.json` copiando `en.json` + aggiungere `<option>` in `index.html` nel `<select id="language">` |

### ⚠️ Invarianti critici — NON modificare

| Invariante | Posizione | Motivo |
|---|---|---|
| Formula scala fisica | `export.py` | `pixel * (25.4/dpi) * scale / 1000 = ground_m` — garantisce la correttezza della stampa |
| `optimal_zoom()` | `utils.py` | Determina la risoluzione tile; cambiarlo causerebbe immagini sfocate o sprecate |
| Cache su disco | `tiles.py` — `_disk_path()` | Struttura `{source}/{z}/{x}/{y}.png` condivisa tra server e GUI tkinter |
| `User-Agent` HTTP | `tiles.py` — `TileCache.__init__()` | Policy d'uso OSM/Nominatim — richiede identificazione |
| Pattern factory handler | `server.py` — `run_server()` | Necessario per condividere `tile_cache` senza variabili globali |

### 🔍 Avvertenze importanti

1. **`Image.MAX_IMAGE_PIXELS`** — impostato a `400_000_000` in `export.py`. Non abbassarlo.
2. **Threading obbligatorio** — download tile e geocoding devono stare in thread separati con `daemon=True`.
3. **Margini PDF** — il codice usa 10 mm di margine laterale e 20 mm in basso (spazio per legenda/scala). Questi valori appaiono sia in `export.py` che in `server.py::_handle_grid()`.
4. **`_parse_coords()` in `server.py`** — gestisce numerosi formati (UTM, MGRS, Gauss-Boaga, Gauss-Krüger, tutti i grid proiettati, lat/lon DD/DM/DMS). Aggiungere nuovi sistemi di griglia richiede di aggiornarla.
5. **Sorgenti tile overlay** — alcune sorgenti hanno `"overlay": True` (es. WaymarkedTrails, OpenRailwayMap): sono pensate per sovrapporsi a una mappa base; la UI web le gestisce separatamente.
6. **Dati persistenti** — `data/config.json` e `data/waypoints/*.json` sono auto-generati a runtime. Non includere nel controllo versione se contengono dati personali.

---

## 9. Dati persistenti

| File | Contenuto | Quando viene creato |
|---|---|---|
| `data/config.json` | Ultima configurazione UI (scala, carta, sorgente, lat/lon, zoom…) | Alla prima modifica nell'UI web |
| `data/waypoints/<nome>.json` | Array di waypoint salvati dall'utente | Alla prima operazione "Salva waypoint" |

---

## 10. Formula scala fisica (riferimento)

$$
1\,\text{mm sul foglio} = \frac{\text{scala}}{1000}\,\text{m al suolo}
$$

Equivalente in pixel:

$$
\text{pixel\_size\_m} = \frac{\text{scala} \times 25.4}{\text{dpi} \times 1000}
$$

**Esempio:** scala 1:10.000, DPI 300 → ogni pixel copre **0.847 m** al suolo.

> ⚠️ **Il PDF deve essere stampato al 100% (scala reale), senza "adatta alla pagina".**

---

## 11. Policy d'uso servizi esterni

| Servizio | Policy |
|---|---|
| **OpenStreetMap tile** | Cache aggressiva obbligatoria; User-Agent identificativo; no bulk download |
| **Nominatim** | Max 1 req/s; User-Agent identificativo; per uso non commerciale |
| **Esri / USGS / altri** | Consultare i singoli termini d'uso prima di distribuire output |

I dati mappa sono © OpenStreetMap contributors (ODbL).

