"""Lightweight HTTP server — serves the Leaflet UI and API endpoints.

Endpoints
---------
GET  /                         → index.html
GET  /api/search?q=...         → geocoding results (JSON)
GET  /api/grid?lat=&lon=&scale=&paper=&landscape=  → UTM grid as GeoJSON
POST /api/export               → PDF file download
"""
from __future__ import annotations

import json
import os
import re
import tempfile
import threading
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import urllib.request
from io import BytesIO

from .export import export_map_pdf
from .geocoder import autocomplete, geocode
from .grid import GRID_SYSTEMS, compute_grid, parse_coords
from .runtime import get_data_dir
from .tiles import TileCache, TILE_SOURCES
from .utils import PAPER_SIZES, SCALES, auto_grid_spacing, compute_sheet_layout

_HERE = Path(__file__).resolve().parent
_STATIC = _HERE / "static"
_DATA = get_data_dir()
_CONFIG_FILE = _DATA / "config.json"
_WP_DIR = _DATA / "waypoints"
_WP_DIR.mkdir(exist_ok=True)
_TOOLS_DIR = _DATA / "tools"
_TOOLS_DIR.mkdir(exist_ok=True)

_SAFE_NAME_RE = re.compile(r'[^a-zA-Z0-9_àèéìòùÀÈÉÌÒÙçÇñÑ -]')


def _sanitize_filename(name: str) -> str:
    """Sanitize a user-provided name for use as a file stem."""
    return _SAFE_NAME_RE.sub('_', name)[:80]


def create_server(host: str = "127.0.0.1", port: int = 8271) -> tuple[HTTPServer, str]:
    """Create the configured HTTP server and return it with its local URL."""
    tc = TileCache()
    handler_cls = type("H", (_Handler,), {"tile_cache": tc})
    try:
        server = HTTPServer((host, port), handler_cls)
    except OSError as exc:
        raise OSError(
            f"Could not start CartograPy on {host}:{port}. "
            "Update cartograpy-server.json or free that port and retry."
        ) from exc

    return server, f"http://{host}:{port}"


def open_browser_later(url: str, delay_sec: float = 0.8) -> threading.Timer:
    """Open *url* in the default browser after a short delay."""
    opener = threading.Timer(delay_sec, lambda: webbrowser.open(url))
    opener.daemon = True
    opener.start()
    return opener


class _Handler(BaseHTTPRequestHandler):
    """Request handler with access to shared ``tile_cache``."""

    tile_cache: TileCache  # set via class attribute by the factory

    def log_message(self, fmt, *args):
        # quieter logs
        pass

    # ------------------------------------------------------------------
    # Routing
    # ------------------------------------------------------------------

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == "/" or path == "/index.html":
            self._serve_file(_STATIC / "index.html", "text/html; charset=utf-8")
        elif path == "/api/search":
            self._handle_search(qs)
        elif path == "/api/suggest":
            self._handle_suggest(qs)
        elif path == "/api/grid":
            self._handle_grid(qs)
        elif path == "/api/constants":
            self._handle_constants()
        elif path == "/api/coord2latlon":
            self._handle_coord2latlon(qs)
        elif path == "/api/config":
            self._handle_config_get()
        elif path == "/api/waypoints/list":
            self._handle_wp_list()
        elif path.startswith("/api/waypoints/load"):
            self._handle_wp_load(qs)
        elif path == "/api/tools/list":
            self._handle_tools_list()
        elif path.startswith("/api/tools/load"):
            self._handle_tools_load(qs)
        elif path == "/api/weather":
            self._handle_weather(qs)
        elif path.startswith("/api/tile/"):
            self._handle_tile_proxy(path)
        elif path.startswith("/lang/") and path.endswith(".json"):
            lang_file = _STATIC / "lang" / Path(path[6:]).name
            self._serve_file(lang_file, "application/json; charset=utf-8")
        elif path == "/style.css":
            self._serve_file(_STATIC / "style.css", "text/css; charset=utf-8")
        elif path == "/app.js":
            self._serve_file(_STATIC / "app.js", "application/javascript; charset=utf-8")
        else:
            self._404()

    def do_POST(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"
        params = json.loads(body)
        if parsed.path == "/api/export":
            self._handle_export(params)
        elif parsed.path == "/api/config":
            self._handle_config_save(params)
        elif parsed.path == "/api/waypoints/save":
            self._handle_wp_save(params)
        elif parsed.path == "/api/waypoints/delete":
            self._handle_wp_delete(params)
        elif parsed.path == "/api/tools/save":
            self._handle_tools_save(params)
        elif parsed.path == "/api/tools/delete":
            self._handle_tools_delete(params)
        else:
            self._404()

    # ------------------------------------------------------------------
    # API handlers
    # ------------------------------------------------------------------

    def _handle_tile_proxy(self, path: str):
        """Serve any TILE_SOURCES entry (XYZ or WMS) as a PNG tile.

        Path format: ``/api/tile/<source>/<z>/<x>/<y>.png`` where ``<source>``
        is URL-encoded. Goes through :class:`TileCache` so the disk cache is
        shared with the PDF exporter and the in-memory cache is shared with
        the rest of the server.
        """
        # Strip prefix and trim ".png"
        rel = path[len("/api/tile/"):]
        if rel.endswith(".png"):
            rel = rel[:-4]
        parts = rel.split("/")
        if len(parts) != 4:
            self._404()
            return
        try:
            source = unquote(parts[0])
            z = int(parts[1]); x = int(parts[2]); y = int(parts[3])
        except (ValueError, AttributeError):
            self._404()
            return
        if source not in TILE_SOURCES:
            self._404()
            return
        try:
            img = self.tile_cache.get_tile(source, z, x, y)
        except Exception:
            self._404()
            return
        buf = BytesIO()
        img.save(buf, format="PNG")
        data = buf.getvalue()
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(data)))
        # Long-lived cache: tiles are immutable per (source, z, x, y).
        self.send_header("Cache-Control", "public, max-age=604800")
        self.end_headers()
        self.wfile.write(data)

    def _handle_search(self, qs):
        q = qs.get("q", [""])[0]
        if not q:
            self._json({"error": "missing q"}, 400)
            return
        try:
            results = geocode(q)
            self._json([{"name": r.name, "lat": r.lat, "lon": r.lon} for r in results])
        except Exception as exc:
            self._json({"error": str(exc)}, 502)

    def _handle_suggest(self, qs):
        q = qs.get("q", [""])[0]
        lang = qs.get("lang", ["en"])[0]
        if not q:
            self._json({"error": "missing q"}, 400)
            return
        try:
            results = autocomplete(q, lang=lang)
            self._json([{"name": r.name, "lat": r.lat, "lon": r.lon} for r in results])
        except Exception as exc:
            self._json({"error": str(exc)}, 502)

    def _handle_grid(self, qs):
        try:
            lat = float(qs["lat"][0])
            lon = float(qs["lon"][0])
            scale = int(qs["scale"][0])
            paper = qs.get("paper", ["A4"])[0]
            landscape = qs.get("landscape", ["0"])[0] == "1"
            grid_type = qs.get("grid_type", ["utm"])[0]
            full_labels = qs.get("full_labels", ["0"])[0] == "1"
            sheets = max(1, int(qs.get("sheets", ["1"])[0]))
        except (KeyError, ValueError, IndexError) as exc:
            self._json({"error": f"bad params: {exc}"}, 400)
            return

        if grid_type == "none" or grid_type not in GRID_SYSTEMS:
            self._json({"type": "FeatureCollection", "features": [],
                        "zone": "", "epsg": 0, "spacing": 0,
                        "ground_w": 0, "ground_h": 0, "system": grid_type})
            return

        pw, ph = PAPER_SIZES.get(paper, (210, 297))
        if landscape:
            pw, ph = ph, pw
        margins = 10
        sheet_w_m = (pw - 2 * margins) * scale / 1000.0
        sheet_h_m = (ph - 2 * margins - 20) * scale / 1000.0

        cols, rows = compute_sheet_layout(sheets, landscape)
        overlap_mm = 10
        step_w = (pw - 2 * margins - overlap_mm) * scale / 1000.0
        step_h = (ph - 2 * margins - 20 - overlap_mm) * scale / 1000.0
        w_m = sheet_w_m + (cols - 1) * step_w
        h_m = sheet_h_m + (rows - 1) * step_h
        spacing = auto_grid_spacing(scale)

        try:
            gi = compute_grid(grid_type, lat, lon, w_m, h_m, spacing, scale,
                              full_labels=full_labels)
        except Exception as exc:
            self._json({"error": str(exc)}, 500)
            return

        if gi is None:
            self._json({"type": "FeatureCollection", "features": [],
                        "zone": "", "epsg": 0, "spacing": 0,
                        "ground_w": w_m, "ground_h": h_m, "system": grid_type})
            return

        features = []
        for gl in gi.lines:
            features.append({
                "type": "Feature",
                "properties": {"label": gl.label, "direction": gl.direction,
                               "full_value": gl.full_value},
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[gl.lon1, gl.lat1], [gl.lon2, gl.lat2]],
                },
            })

        self._json({
            "type": "FeatureCollection",
            "features": features,
            "zone": gi.zone,
            "epsg": gi.epsg,
            "spacing": spacing,
            "system": gi.system,
            "ground_w": w_m,
            "ground_h": h_m,
        })

    def _handle_constants(self):
        self._json({
            "scales": SCALES,
            "papers": {k: list(v) for k, v in PAPER_SIZES.items()},
            "grid_systems": GRID_SYSTEMS,
        })

    def _handle_coord2latlon(self, qs):
        """Convert projected coordinates to lat/lon."""
        grid_type = qs.get("grid_type", [""])[0]
        coords_raw = qs.get("coords", [""])[0].strip()
        if not grid_type or not coords_raw:
            self._json({"error": "missing grid_type or coords"}, 400)
            return
        try:
            lat, lon = parse_coords(grid_type, coords_raw)
            self._json({"lat": lat, "lon": lon})
        except Exception as exc:
            self._json({"error": str(exc)}, 400)

    def _handle_weather(self, qs):
        """Proxy hourly weather forecast from Open-Meteo (free, no API key)."""
        try:
            lat = float(qs["lat"][0])
            lon = float(qs["lon"][0])
            date = qs.get("date", [""])[0].strip()
        except (KeyError, ValueError, IndexError):
            self._json({"error": "missing lat/lon"}, 400)
            return

        # Build Open-Meteo URL
        params = (
            f"latitude={lat}&longitude={lon}"
            f"&hourly=temperature_2m,apparent_temperature,weathercode"
            f",relativehumidity_2m,precipitation_probability"
            f",precipitation,windspeed_10m,windgusts_10m"
            f",winddirection_10m,uv_index"
            f"&timezone=auto"
        )
        if date:
            params += f"&start_date={date}&end_date={date}"
        else:
            params += "&forecast_days=1"

        url = f"https://api.open-meteo.com/v1/forecast?{params}"
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "CartograPy/1.0 (weather-widget)"},
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())
            self._json(data)
        except Exception as exc:
            self._json({"error": str(exc)}, 502)

    # -- Config persistence -----------------------------------------------

    def _handle_config_get(self):
        if _CONFIG_FILE.is_file():
            self._json(json.loads(_CONFIG_FILE.read_text("utf-8")))
        else:
            self._json({})

    def _handle_config_save(self, params):
        # sanitize: only accept known keys
        allowed = {"scale", "paper", "landscape", "source", "dpi",
                   "mapTextScale", "gridType", "gridScale", "fullLabels",
                   "lat", "lon", "zoom", "language", "sheets",
                   "owmApiKey", "searchHistory", "overlays"}
        clean = {k: v for k, v in params.items() if k in allowed}
        _CONFIG_FILE.write_text(json.dumps(clean, ensure_ascii=False, indent=2), "utf-8")
        self._json({"ok": True})

    # -- Waypoint files ---------------------------------------------------

    def _handle_wp_list(self):
        files = sorted(p.stem for p in _WP_DIR.glob("*.json"))
        self._json(files)

    def _handle_wp_save(self, params):
        name = params.get("name", "").strip()
        wps = params.get("waypoints", [])
        if not name:
            self._json({"error": "name required"}, 400)
            return
        safe = _sanitize_filename(name)
        path = _WP_DIR / f"{safe}.json"
        path.write_text(json.dumps(wps, ensure_ascii=False, indent=2), "utf-8")
        self._json({"ok": True, "name": safe})

    def _handle_wp_load(self, qs):
        name = qs.get("name", [""])[0].strip()
        if not name:
            self._json({"error": "name required"}, 400)
            return
        safe = _sanitize_filename(name)
        path = _WP_DIR / f"{safe}.json"
        if not path.is_file():
            self._json({"error": "not found"}, 404)
            return
        self._json(json.loads(path.read_text("utf-8")))

    def _handle_wp_delete(self, params):
        name = params.get("name", "").strip()
        if not name:
            self._json({"error": "name required"}, 400)
            return
        safe = _sanitize_filename(name)
        path = _WP_DIR / f"{safe}.json"
        if path.is_file():
            path.unlink()
        self._json({"ok": True})

    # -- Tool drawing files -----------------------------------------------

    def _handle_tools_list(self):
        files = sorted(p.stem for p in _TOOLS_DIR.glob("*.json"))
        self._json(files)

    def _handle_tools_save(self, params):
        name = params.get("name", "").strip()
        drawings = params.get("drawings", [])
        if not name:
            self._json({"error": "name required"}, 400)
            return
        safe = _sanitize_filename(name)
        path = _TOOLS_DIR / f"{safe}.json"
        path.write_text(json.dumps(drawings, ensure_ascii=False, indent=2), "utf-8")
        self._json({"ok": True, "name": safe})

    def _handle_tools_load(self, qs):
        name = qs.get("name", [""])[0].strip()
        if not name:
            self._json({"error": "name required"}, 400)
            return
        safe = _sanitize_filename(name)
        path = _TOOLS_DIR / f"{safe}.json"
        if not path.is_file():
            self._json({"error": "not found"}, 404)
            return
        self._json(json.loads(path.read_text("utf-8")))

    def _handle_tools_delete(self, params):
        name = params.get("name", "").strip()
        if not name:
            self._json({"error": "name required"}, 400)
            return
        safe = _sanitize_filename(name)
        path = _TOOLS_DIR / f"{safe}.json"
        if path.is_file():
            path.unlink()
        self._json({"ok": True})

    def _handle_export(self, params):
        try:
            lat = float(params["lat"])
            lon = float(params["lon"])
            scale = int(params["scale"])
            paper = params.get("paper", "A4")
            landscape = bool(params.get("landscape", False))
            dpi = int(params.get("dpi", 300))
            source = params.get("source", "OpenTopoMap")
            grid_type = params.get("grid_type", "utm")
            grid_full_labels = bool(params.get("grid_full_labels", False))
            grid_scale = int(params.get("grid_scale", 50))
            map_text_scale = int(params.get("map_text_scale", 50))
            sheets = max(1, int(params.get("sheets", 1)))
            waypoints_raw = params.get("waypoints", [])
            drawings_raw = params.get("drawings", [])
        except (KeyError, ValueError) as exc:
            self._json({"error": str(exc)}, 400)
            return

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp_path = tmp.name

        try:
            export_map_pdf(
                tile_cache=self.tile_cache,
                source_name=source,
                center_lat=lat,
                center_lon=lon,
                scale=scale,
                paper=paper,
                landscape=landscape,
                dpi=dpi,
                output=tmp_path,
                grid_type=grid_type,
                grid_full_labels=grid_full_labels,
                grid_scale=grid_scale,
                map_text_scale=map_text_scale,
                sheets=sheets,
                waypoints=waypoints_raw,
                drawings=drawings_raw,
            )

            data = Path(tmp_path).read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Disposition",
                             f'attachment; filename="map_{scale}_{paper}.pdf"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as exc:
            self._json({"error": str(exc)}, 500)
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    # ------------------------------------------------------------------
    # Response helpers
    # ------------------------------------------------------------------

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_file(self, path: Path, content_type: str):
        if not path.is_file():
            self._404()
            return
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _404(self):
        self.send_response(404)
        self.end_headers()


def run_server(
    host: str = "127.0.0.1",
    port: int = 8271,
    *,
    open_browser: bool = True,
    browser_delay_sec: float = 0.8,
) -> None:
    """Start the CartograPy web server and optionally open the browser."""
    server, url = create_server(host=host, port=port)
    print(f"CartograPy server: {url}")
    print("Press Ctrl+C to stop.\n")
    if open_browser:
        open_browser_later(url, browser_delay_sec)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()
