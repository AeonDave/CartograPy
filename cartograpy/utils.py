"""Projection math, tile coordinate helpers, and constants."""
from __future__ import annotations

import math

# ---------------------------------------------------------------------------
# WGS-84 constants
# ---------------------------------------------------------------------------
EARTH_RADIUS = 6378137.0  # semi-major axis, metres
EARTH_CIRCUMFERENCE = 2 * math.pi * EARTH_RADIUS

TILE_SIZE = 256  # standard OSM tile edge, px

# ---------------------------------------------------------------------------
# Paper sizes (width × height in mm, portrait)
# ---------------------------------------------------------------------------
PAPER_SIZES: dict[str, tuple[int, int]] = {
    "A4": (210, 297),
    "A3": (297, 420),
    "A2": (420, 594),
    "A1": (594, 841),
    "Letter": (216, 279),
    "Legal": (216, 356),
}

# ---------------------------------------------------------------------------
# Standard map scale denominators
# ---------------------------------------------------------------------------
SCALES: list[int] = [
    2_500, 5_000, 10_000, 15_000, 20_000, 25_000,
    50_000, 75_000, 100_000, 200_000,
]

# ---------------------------------------------------------------------------
# Tile ↔ WGS-84 conversions  (Web Mercator / EPSG:3857 scheme)
# ---------------------------------------------------------------------------

def deg2num(lat_deg: float, lon_deg: float, zoom: int) -> tuple[float, float]:
    """WGS-84 → fractional tile coordinates at *zoom*."""
    lat_rad = math.radians(lat_deg)
    n = 1 << zoom
    x = (lon_deg + 180.0) / 360.0 * n
    y = (1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n
    return x, y


def num2deg(x: float, y: float, zoom: int) -> tuple[float, float]:
    """Fractional tile coordinates → WGS-84 (lat, lon)."""
    n = 1 << zoom
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * y / n))))
    return lat, lon


def ground_resolution(lat_deg: float, zoom: int) -> float:
    """Metres per pixel at *lat_deg* and *zoom*."""
    return EARTH_CIRCUMFERENCE * math.cos(math.radians(lat_deg)) / (TILE_SIZE * (1 << zoom))


def optimal_zoom(lat_deg: float, scale: int, dpi: int = 300) -> int:
    """Best tile zoom level for a target print *scale* at *dpi*.

    We pick the coarsest zoom whose ground resolution is ≤ the
    resolution required by the scale/DPI combination (i.e. tiles are at
    least as detailed as we need).
    """
    # Each printed pixel covers this many metres on the ground:
    target_mpp = scale * 25.4 / (dpi * 1000.0)
    for z in range(1, 19):
        if ground_resolution(lat_deg, z) <= target_mpp:
            return z
    return 18


def auto_grid_spacing(scale: int) -> int:
    """Sensible UTM grid spacing (metres) for a given map scale."""
    if scale <= 5_000:
        return 100
    if scale <= 10_000:
        return 200
    if scale <= 25_000:
        return 500
    if scale <= 50_000:
        return 1_000
    if scale <= 100_000:
        return 2_000
    return 5_000


def latlon_to_pixel(
    lat: float,
    lon: float,
    center_lat: float,
    center_lon: float,
    ground_w_m: float,
    ground_h_m: float,
    img_w_px: int,
    img_h_px: int,
) -> tuple[int, int]:
    """Approximate WGS-84 → image-pixel conversion (equirectangular)."""
    dx_m = (lon - center_lon) * math.pi / 180.0 * EARTH_RADIUS * math.cos(math.radians(center_lat))
    dy_m = (lat - center_lat) * math.pi / 180.0 * EARTH_RADIUS
    px = int(img_w_px / 2.0 + dx_m / ground_w_m * img_w_px)
    py = int(img_h_px / 2.0 - dy_m / ground_h_m * img_h_px)
    return px, py


def compute_sheet_layout(n: int, landscape: bool) -> tuple[int, int]:
    """Return ``(cols, rows)`` for *n* sheets arranged near-square.

    Landscape orientation favours more columns than rows; portrait favours
    more rows than columns. ``n <= 1`` always returns ``(1, 1)``.
    """
    if n <= 1:
        return (1, 1)
    if landscape:
        cols = math.ceil(math.sqrt(n))
        rows = math.ceil(n / cols)
    else:
        rows = math.ceil(math.sqrt(n))
        cols = math.ceil(n / rows)
    return (cols, rows)
