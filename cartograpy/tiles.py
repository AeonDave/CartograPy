"""Tile downloading with on-disk cache and multiple sources.

Sources are dictionaries in :data:`TILE_SOURCES` keyed by display name.
Each source has a ``type`` field that selects the fetch strategy:

* ``"xyz"`` (default): plain ``{z}/{x}/{y}`` URL template.
* ``"wms"``: an OGC WMS endpoint queried per tile in EPSG:3857.

Adding a new protocol means adding a new ``type`` and a corresponding
``_download_<type>`` method on :class:`TileCache`. Frontends can then
consume any source through the unified ``GET /api/tile/...`` proxy.
"""
from __future__ import annotations

import math
import threading
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from urllib.parse import urlencode

import requests
from PIL import Image

from .utils import TILE_SIZE

# Web Mercator (EPSG:3857) world half-extent in metres.
_WEB_MERCATOR_HALF = 20037508.342789244

# ---------------------------------------------------------------------------
# Public tile servers (respect usage policies — cache aggressively)
# ---------------------------------------------------------------------------
TILE_SOURCES: dict[str, dict] = {
    # ----- Base maps: Global -----
    "OpenTopoMap": {
        "url": "https://tile.opentopomap.org/{z}/{x}/{y}.png",
        "attribution": "© OpenTopoMap (CC-BY-SA)",
        "max_zoom": 17,
        "group": "global",
    },
    "OpenStreetMap": {
        "url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        "attribution": "© OpenStreetMap contributors",
        "max_zoom": 19,
        "group": "global",
    },
    "CyclOSM": {
        "url": "https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
        "attribution": "© CyclOSM — © OSM contributors",
        "max_zoom": 19,
        "group": "global",
    },
    "OSM DE": {
        "url": "https://tile.openstreetmap.de/{z}/{x}/{y}.png",
        "attribution": "© OpenStreetMap contributors",
        "max_zoom": 18,
        "group": "global",
    },
    "OSM France": {
        "url": "https://a.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png",
        "attribution": "© OpenStreetMap France — © OSM contributors",
        "max_zoom": 20,
        "group": "global",
    },
    "OSM HOT": {
        "url": "https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
        "attribution": "© Humanitarian OSM Team — © OSM contributors",
        "max_zoom": 19,
        "group": "global",
        "label_key": "source.osmHot",
    },
    "OPNVKarte": {
        "url": "https://tileserver.memomaps.de/tilegen/{z}/{x}/{y}.png",
        "attribution": "© memomaps.de (CC-BY-SA)",
        "max_zoom": 18,
        "group": "global",
        "label_key": "source.opnvkarte",
    },
    # ----- Base maps: Esri -----
    "Esri WorldStreetMap": {
        "url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
        "attribution": "© Esri",
        "max_zoom": 19,
        "group": "esri",
        "label_key": "source.esriStreets",
    },
    "Esri WorldTopoMap": {
        "url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
        "attribution": "© Esri",
        "max_zoom": 19,
        "group": "esri",
        "label_key": "source.esriTopo",
    },
    "Esri WorldImagery": {
        "url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "attribution": "© Esri",
        "max_zoom": 19,
        "group": "esri",
        "label_key": "source.esriSatellite",
    },
    "Esri NatGeo World Map": {
        "url": "https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}",
        "attribution": "© Esri / National Geographic",
        "max_zoom": 16,
        "group": "esri",
        "display_name": "Esri NatGeo",
    },
    "Esri Ocean Basemap": {
        "url": "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}",
        "attribution": "© Esri / GEBCO / NOAA",
        "max_zoom": 13,
        "group": "esri",
    },
    # ----- Base maps: CartoDB -----
    "CartoDB Positron": {
        "url": "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "attribution": "© OSM contributors © CARTO",
        "max_zoom": 20,
        "group": "cartodb",
        "label_key": "source.cartodbLight",
    },
    "CartoDB Voyager": {
        "url": "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        "attribution": "© OSM contributors © CARTO",
        "max_zoom": 20,
        "group": "cartodb",
    },
    "CartoDB Voyager NoLabels": {
        "url": "https://a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png",
        "attribution": "© OSM contributors © CARTO",
        "max_zoom": 20,
        "group": "cartodb",
        "display_name": "CartoDB Voyager (no labels)",
    },
    "CartoDB Dark": {
        "url": "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "attribution": "© OSM contributors © CARTO",
        "max_zoom": 20,
        "group": "cartodb",
    },
    # ----- Base maps: Marine -----
    "EMODnet Bathymetry": {
        "url": "https://tiles.emodnet-bathymetry.eu/2020/baselayer/web_mercator/{z}/{x}/{y}.png",
        "attribution": "© EMODnet Bathymetry Consortium",
        "max_zoom": 12,
        "group": "marine",
        "label_key": "source.emodnet",
    },
    "GEBCO": {
        "type": "wms",
        "wms_url": "https://wms.gebco.net/mapserv",
        "wms_layers": "GEBCO_LATEST",
        "wms_version": "1.3.0",
        "wms_format": "image/png",
        "wms_styles": "",
        "wms_transparent": False,
        "attribution": "GEBCO Compilation Group (© GEBCO)",
        "max_zoom": 9,
        "group": "marine",
        "label_key": "source.gebco",
    },
    # ----- Base maps: Regional -----
    "TopPlusOpen": {
        "url": "https://sgx.geodatenzentrum.de/wmts_topplus_open/tile/1.0.0/web/default/WEBMERCATOR/{z}/{y}/{x}.png",
        "attribution": "© dl-de/by-2-0",
        "max_zoom": 18,
        "group": "regional",
        "display_name": "TopPlusOpen (DE)",
    },
    "BaseMap DE": {
        "url": "https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_farbe/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png",
        "attribution": "© dl-de/by-2-0",
        "max_zoom": 18,
        "group": "regional",
    },
    "GeoportailFrance": {
        "url": "https://data.geopf.fr/wmts?REQUEST=GetTile&SERVICE=WMTS&VERSION=1.0.0&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
        "attribution": "© Geoportail France",
        "max_zoom": 18,
        "group": "regional",
        "display_name": "Géoportail France",
    },
    "GeoportailFrance Ortho": {
        "url": "https://data.geopf.fr/wmts?REQUEST=GetTile&SERVICE=WMTS&VERSION=1.0.0&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
        "attribution": "© Geoportail France",
        "max_zoom": 19,
        "group": "regional",
        "label_key": "source.geopFrOrtho",
    },
    "Swisstopo": {
        "url": "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg",
        "attribution": "© swisstopo",
        "max_zoom": 18,
        "group": "regional",
        "display_name": "Swisstopo (CH)",
    },
    "Swisstopo Satellite": {
        "url": "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg",
        "attribution": "© swisstopo",
        "max_zoom": 19,
        "group": "regional",
    },
    "BasemapAT": {
        "url": "https://mapsneu.wien.gv.at/basemap/geolandbasemap/normal/google3857/{z}/{y}/{x}.png",
        "attribution": "© basemap.at",
        "max_zoom": 20,
        "group": "regional",
        "display_name": "BasemapAT (Austria)",
    },
    "BasemapAT Ortho": {
        "url": "https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg",
        "attribution": "© basemap.at",
        "max_zoom": 20,
        "group": "regional",
        "label_key": "source.basemapAtOrtho",
    },
    "NL Kadaster": {
        "url": "https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png",
        "attribution": "© Kadaster",
        "max_zoom": 19,
        "group": "regional",
    },
    "Kartverket Topo (NO)": {
        "url": "https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png",
        "attribution": "© Kartverket",
        "max_zoom": 18,
        "group": "regional",
    },
    "Kartverket Topo Greyscale (NO)": {
        "url": "https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png",
        "attribution": "© Kartverket",
        "max_zoom": 18,
        "group": "regional",
    },
    "IGN España MTN": {
        "url": "https://www.ign.es/wmts/mapa-raster?layer=MTN&style=default&tilematrixset=GoogleMapsCompatible&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image/jpeg&TileMatrix={z}&TileCol={x}&TileRow={y}",
        "attribution": "© Instituto Geográfico Nacional de España",
        "max_zoom": 18,
        "group": "regional",
    },
    "USGS Topo": {
        "url": "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
        "attribution": "© USGS",
        "max_zoom": 20,
        "group": "regional",
        "display_name": "USGS Topo (USA)",
    },
    "USGS Imagery": {
        "url": "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
        "attribution": "© USGS",
        "max_zoom": 20,
        "group": "regional",
        "display_name": "USGS Imagery (USA)",
    },
    # ----- Overlays -----
    "WaymarkedTrails Hiking": {
        "url": "https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png",
        "attribution": "© waymarkedtrails.org (CC-BY-SA)",
        "max_zoom": 18,
        "overlay": True,
        "overlay_id": "hiking",
        "label_key": "overlay.hiking",
    },
    "WaymarkedTrails MTB": {
        "url": "https://tile.waymarkedtrails.org/mtb/{z}/{x}/{y}.png",
        "attribution": "© waymarkedtrails.org (CC-BY-SA)",
        "max_zoom": 18,
        "overlay": True,
        "overlay_id": "mtb",
        "label_key": "overlay.mtb",
    },
    "WaymarkedTrails Cycling": {
        "url": "https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png",
        "attribution": "© waymarkedtrails.org (CC-BY-SA)",
        "max_zoom": 18,
        "overlay": True,
        "overlay_id": "cycling",
        "label_key": "overlay.cycling",
    },
    "WaymarkedTrails Slopes": {
        "url": "https://tile.waymarkedtrails.org/slopes/{z}/{x}/{y}.png",
        "attribution": "© waymarkedtrails.org (CC-BY-SA)",
        "max_zoom": 18,
        "overlay": True,
        "overlay_id": "slopes",
        "label_key": "overlay.slopes",
    },
    "WaymarkedTrails Riding": {
        "url": "https://tile.waymarkedtrails.org/riding/{z}/{x}/{y}.png",
        "attribution": "© waymarkedtrails.org (CC-BY-SA)",
        "max_zoom": 18,
        "overlay": True,
        "overlay_id": "riding",
        "label_key": "overlay.riding",
    },
    "Esri World Hillshade": {
        "url": "https://server.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
        "attribution": "© Esri",
        "max_zoom": 16,
        "overlay": True,
        "overlay_id": "hillshade",
        "label_key": "overlay.hillshade",
        "opacity": 0.5,
        "z_index": 405,
    },
    "OpenSnowMap Pistes": {
        "url": "https://tiles.opensnowmap.org/pistes/{z}/{x}/{y}.png",
        "attribution": "© www.opensnowmap.org (CC-BY-SA)",
        "max_zoom": 18,
        "overlay": True,
        "overlay_id": "snowmap",
        "label_key": "overlay.snowmap",
    },
    "OpenRailwayMap": {
        "url": "https://a.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png",
        "attribution": "© OpenRailwayMap (CC-BY-SA)",
        "max_zoom": 19,
        "overlay": True,
        "overlay_id": "railway",
        "label_key": "overlay.railway",
    },
    "OpenSeaMap Seamarks": {
        "url": "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",
        "attribution": "© OpenSeaMap (CC-BY-SA)",
        "max_zoom": 18,
        "overlay": True,
        "overlay_id": "seamarks",
        "label_key": "overlay.seamarks",
    },
}

_PLACEHOLDER: Image.Image | None = None


def _placeholder() -> Image.Image:
    global _PLACEHOLDER
    if _PLACEHOLDER is None:
        _PLACEHOLDER = Image.new("RGB", (TILE_SIZE, TILE_SIZE), (220, 220, 220))
    return _PLACEHOLDER.copy()


class TileCache:
    """Thread-safe tile fetcher with a two-level cache (memory + disk)."""

    def __init__(self, cache_dir: Path | None = None, workers: int = 6) -> None:
        if cache_dir is None:
            cache_dir = Path.home() / ".cartograpy" / "tiles"
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        self._session = requests.Session()
        self._session.headers["User-Agent"] = "CartograPy/1.0 (map-printing tool; educational)"
        self._mem: dict[tuple, Image.Image] = {}
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=workers)

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def get_tile(self, source: str, z: int, x: int, y: int) -> Image.Image:
        """Return tile image (blocking). Serves from memory → disk → network."""
        key = (source, z, x, y)
        with self._lock:
            if key in self._mem:
                return self._mem[key]

        # Disk
        path = self._disk_path(source, z, x, y)
        if path.exists():
            try:
                img = Image.open(path).convert("RGB")
                with self._lock:
                    self._mem[key] = img
                return img
            except Exception:
                pass

        # Network
        img = self._download(source, z, x, y)
        with self._lock:
            self._mem[key] = img
        return img

    def get_tile_async(
        self,
        source: str,
        z: int,
        x: int,
        y: int,
        callback=None,
    ) -> Image.Image | None:
        """Non-blocking fetch. Returns image if cached, else ``None`` and
        calls *callback(key, image)* from a worker thread when ready."""
        key = (source, z, x, y)
        with self._lock:
            if key in self._mem:
                return self._mem[key]

        # Check disk quickly
        path = self._disk_path(source, z, x, y)
        if path.exists():
            try:
                img = Image.open(path).convert("RGB")
                with self._lock:
                    self._mem[key] = img
                return img
            except Exception:
                pass

        # Submit network fetch
        def _task():
            img = self._download(source, z, x, y)
            with self._lock:
                self._mem[key] = img
            if callback:
                callback(key, img)

        self._pool.submit(_task)
        return None

    def get_area(
        self, source: str, z: int, x_min: int, y_min: int, x_max: int, y_max: int,
    ) -> Image.Image:
        """Composite tiles in a rectangle (blocking download)."""
        cols = x_max - x_min + 1
        rows = y_max - y_min + 1
        result = Image.new("RGB", (cols * TILE_SIZE, rows * TILE_SIZE))
        for tx in range(x_min, x_max + 1):
            for ty in range(y_min, y_max + 1):
                tile = self.get_tile(source, z, tx, ty)
                result.paste(tile, ((tx - x_min) * TILE_SIZE, (ty - y_min) * TILE_SIZE))
        return result

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _disk_path(self, source: str, z: int, x: int, y: int) -> Path:
        return self.cache_dir / source / str(z) / str(x) / f"{y}.png"

    def _download(self, source: str, z: int, x: int, y: int) -> Image.Image:
        src = TILE_SOURCES.get(source)
        if src is None:
            return _placeholder()
        kind = src.get("type", "xyz")
        try:
            if kind == "wms":
                img = self._download_wms(src, z, x, y)
            else:
                img = self._download_xyz(src, z, x, y)
        except Exception:
            return _placeholder()
        # persist to disk
        path = self._disk_path(source, z, x, y)
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            img.save(path, "PNG")
        except Exception:
            pass
        return img

    def _download_xyz(self, src: dict, z: int, x: int, y: int) -> Image.Image:
        url = src["url"].format(z=z, x=x, y=y)
        resp = self._session.get(url, timeout=15)
        resp.raise_for_status()
        return Image.open(BytesIO(resp.content)).convert("RGB")

    def _download_wms(self, src: dict, z: int, x: int, y: int) -> Image.Image:
        """Build an OGC WMS GetMap request for a Web Mercator tile."""
        # Tile bounds in EPSG:3857 metres.
        n = 2 ** z
        tile_size_m = (2 * _WEB_MERCATOR_HALF) / n
        minx = -_WEB_MERCATOR_HALF + x * tile_size_m
        maxx = minx + tile_size_m
        maxy = _WEB_MERCATOR_HALF - y * tile_size_m
        miny = maxy - tile_size_m

        version = src.get("wms_version", "1.3.0")
        # WMS 1.3.0 uses CRS + axis order minx,miny,maxx,maxy for EPSG:3857.
        # WMS 1.1.1 uses SRS with the same axis order for projected CRS.
        params = {
            "SERVICE": "WMS",
            "REQUEST": "GetMap",
            "VERSION": version,
            "LAYERS": src.get("wms_layers", ""),
            "STYLES": src.get("wms_styles", ""),
            "FORMAT": src.get("wms_format", "image/png"),
            "TRANSPARENT": "TRUE" if src.get("wms_transparent") else "FALSE",
            "WIDTH": TILE_SIZE,
            "HEIGHT": TILE_SIZE,
            "BBOX": f"{minx},{miny},{maxx},{maxy}",
        }
        if version.startswith("1.3"):
            params["CRS"] = "EPSG:3857"
        else:
            params["SRS"] = "EPSG:3857"
        # Allow per-source extra params (e.g. custom dimensions, time).
        extra = src.get("wms_extra")
        if isinstance(extra, dict):
            params.update(extra)

        sep = "&" if "?" in src["wms_url"] else "?"
        url = f"{src['wms_url']}{sep}{urlencode(params)}"
        resp = self._session.get(url, timeout=20)
        resp.raise_for_status()
        mode = "RGBA" if src.get("wms_transparent") else "RGB"
        return Image.open(BytesIO(resp.content)).convert(mode)
