"""OSM feature lookup via the Overpass API for in-tool snapping.

Queries the Overpass API for nearby features (peaks, trail vertices)
inside a bounding box. Results are cached on disk per (bbox-grid, types)
so that small map pans do not retrigger the (slow) network call.

The bounding box is quantised to a 0.05° grid (~5 km) before being used
as a cache key, which lets us reuse a single fetch for nearby viewports.
"""
from __future__ import annotations

import hashlib
import json
import math
import time
import urllib.request
from pathlib import Path

from .runtime import get_data_dir

_OVERPASS = "https://overpass-api.de/api/interpreter"
_UA = "CartograPy/1.0 (snap-features)"
_TYPES = ("peak", "trail")

_CACHE_DIR: Path = get_data_dir() / "osm_cache"
_CACHE_DIR.mkdir(exist_ok=True)
_GRID = 0.05            # bbox quantisation step in degrees
_MAX_AREA_DEG2 = 0.5    # refuse queries larger than ~50×50 km
_TTL_SEC = 7 * 24 * 3600


def _snap_bbox(s: float, w: float, n: float, e: float,
               step: float = _GRID) -> tuple[float, float, float, float]:
    """Expand a bbox outward to the quantisation grid.

    Both the cache key AND the Overpass query use the expanded bbox, so a
    cached result always covers every raw viewport that maps to the same key.
    """
    qs = max(-90.0, math.floor(s / step) * step)
    qw = max(-180.0, math.floor(w / step) * step)
    qn = min(90.0, math.ceil(n / step) * step)
    qe = min(180.0, math.ceil(e / step) * step)
    return qs, qw, qn, qe


def _cache_key(qs: float, qw: float, qn: float, qe: float,
               types: tuple[str, ...]) -> Path:
    raw = f"{qs:.4f},{qw:.4f},{qn:.4f},{qe:.4f}|{','.join(types)}"
    h = hashlib.sha1(raw.encode()).hexdigest()[:16]
    return _CACHE_DIR / f"{h}.json"


def _build_query(s: float, w: float, n: float, e: float,
                 types: tuple[str, ...]) -> str:
    parts: list[str] = []
    bbox = f"{s},{w},{n},{e}"
    if "peak" in types:
        parts.append(f'node["natural"="peak"]({bbox});')
    if "trail" in types:
        parts.append(
            f'way["highway"~"^(path|track|footway|cycleway|bridleway)$"]({bbox});'
        )
    body = "".join(parts)
    return f"[out:json][timeout:25];({body});out tags geom;"


def _parse(payload: dict) -> dict:
    peaks: list[dict] = []
    trails: list[dict] = []
    for el in payload.get("elements", []):
        tags = el.get("tags", {}) or {}
        if el.get("type") == "node" and tags.get("natural") == "peak":
            peaks.append({
                "lat": el.get("lat"),
                "lon": el.get("lon"),
                "name": tags.get("name") or "",
                "ele": tags.get("ele") or "",
            })
        elif el.get("type") == "way" and "highway" in tags:
            geom = el.get("geometry") or []
            if len(geom) < 2:
                continue
            coords = [[g["lat"], g["lon"]] for g in geom
                      if "lat" in g and "lon" in g]
            if len(coords) < 2:
                continue
            trails.append({
                "name":  tags.get("name") or "",
                "kind":  tags.get("highway"),
                "coords": coords,
            })
    return {"peaks": peaks, "trails": trails}


def query_features(s: float, w: float, n: float, e: float,
                   types: tuple[str, ...] = _TYPES,
                   timeout: float = 30.0) -> dict:
    """Return nearby snap features inside the given bbox.

    Result shape::

        {
            "peaks":  [{lat, lon, name, ele}, ...],
            "trails": [{name, kind, coords: [[lat, lon], ...]}, ...],
        }

    Raises ``ValueError`` if the bbox is too large.
    """
    types = tuple(t for t in types if t in _TYPES) or _TYPES
    if not (-90 <= s <= n <= 90 and -180 <= w <= e <= 180):
        raise ValueError("invalid bbox")
    if (n - s) * (e - w) > _MAX_AREA_DEG2:
        raise ValueError("bbox too large for snap query")

    qs, qw, qn, qe = _snap_bbox(s, w, n, e)
    cache_path = _cache_key(qs, qw, qn, qe, types)
    if cache_path.exists():
        try:
            age = cache_path.stat().st_mtime
            if time.time() - age < _TTL_SEC:
                return json.loads(cache_path.read_text(encoding="utf-8"))
        except Exception:
            pass  # fall through to refetch

    body = _build_query(qs, qw, qn, qe, types).encode()
    req = urllib.request.Request(
        _OVERPASS, data=body, method="POST",
        headers={"User-Agent": _UA, "Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode())
    except Exception as exc:                          # noqa: BLE001
        raise ValueError(f"Overpass error: {exc}") from exc

    result = _parse(payload)
    try:
        cache_path.write_text(json.dumps(result), encoding="utf-8")
    except Exception:
        pass
    return result


__all__ = ["query_features", "_TYPES"]
