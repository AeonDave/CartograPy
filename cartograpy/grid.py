"""Grid line computation for map overlay and PDF export.

Supported grid systems
----------------------
- ``utm``             — Universal Transverse Mercator (auto-zone)
- ``latlon``          — Latitude / Longitude (auto-detect DD / DM / DMS)
- ``mgrs``            — Military Grid Reference System
- ``gauss_boaga``     — Gauss-Boaga (Italy, Monte Mario — EPSG 3003/3004)
- ``swiss``           — Swiss CH1903+ / LV95 (EPSG 2056)
- ``bng``             — British National Grid OSGB36 (EPSG 27700)
- ``dutch``           — Dutch RD New (EPSG 28992)
- ``gauss_krueger``   — German Gauss-Krüger (EPSG 31466-31469)
- ``irish_ig``        — Irish Grid (EPSG 29902)
- ``irish_itm``       — Irish Transverse Mercator (EPSG 2157)
- ``eov``             — Hungarian EOV (EPSG 23700)
- ``kkj``             — Finnish KKJ zone 3 (EPSG 2393)
- ``nztm``            — New Zealand TM (EPSG 2193)
- ``sweref99``        — Swedish SWEREF 99 TM (EPSG 3006)
- ``rt90``            — Swedish RT90 2.5 gon V (EPSG 3021)
- ``south_african``   — South African Lo29 (EPSG 2054)
- ``taiwan``          — Taiwan TWD97 / TM2 (EPSG 3826)
- ``qng``             — Qatar National Grid (EPSG 28600)
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from pyproj import Transformer


# ------------------------------------------------------------------
# Shared data structures
# ------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class GridLine:
    """A single grid line in WGS-84 endpoints."""
    lat1: float
    lon1: float
    lat2: float
    lon2: float
    label: str
    full_value: float
    direction: str    # "v" vertical | "h" horizontal


@dataclass(frozen=True, slots=True)
class GridInfo:
    system: str       # grid system key (e.g. "utm", "latlon_dd")
    zone: str         # human-readable zone / datum info
    epsg: int         # EPSG code used (0 for pure lat/lon)
    center_easting: float
    center_northing: float
    lines: list[GridLine]


# ------------------------------------------------------------------
# Available grid systems (order = UI order)
# ------------------------------------------------------------------

GRID_SYSTEMS: dict[str, str] = {
    "none":          "Nessuna griglia",
    "utm":           "UTM",
    "latlon":        "Lat/Lon (auto DD/DM/DMS)",
    "mgrs":          "MGRS",
    "gauss_boaga":   "Gauss-Boaga (Italia)",
    "swiss":         "Swiss CH1903+ / LV95",
    "bng":           "British National Grid",
    "dutch":         "Dutch RD New",
    "gauss_krueger": "German Gauss-Krüger",
    "irish_ig":      "Irish Grid",
    "irish_itm":     "Irish Transverse Mercator",
    "eov":           "Hungarian EOV",
    "kkj":           "Finnish KKJ",
    "nztm":          "New Zealand TM",
    "sweref99":      "Swedish SWEREF 99 TM",
    "rt90":          "Swedish RT90",
    "south_african": "South African Lo29",
    "taiwan":        "Taiwan TWD97 / TM2",
    "qng":           "Qatar National Grid",
}


def utm_zone(lon: float) -> int:
    return int((lon + 180.0) / 6.0) + 1


def utm_epsg(lat: float, lon: float) -> int:
    zone = utm_zone(lon)
    return (32600 + zone) if lat >= 0 else (32700 + zone)


def format_label(value: float, spacing: int) -> str:
    """Abbreviate a UTM coordinate for map labels.

    Convention: show kilometres with enough precision for the grid spacing.
    """
    km = value / 1000.0
    if spacing >= 1000:
        return f"{int(km)}"
    if spacing >= 500:
        return f"{km:.1f}"
    if spacing >= 100:
        return f"{km:.1f}"
    return f"{km:.2f}"


def compute_utm_grid(
    center_lat: float,
    center_lon: float,
    width_m: float,
    height_m: float,
    spacing_m: int,
) -> GridInfo:
    """Compute UTM grid lines covering an area centred on *(lat, lon)*.

    Parameters
    ----------
    width_m, height_m : ground extent of the map in metres.
    spacing_m : distance between grid lines in metres.

    Returns
    -------
    GridInfo with WGS-84 line endpoints ready for rendering.
    """
    epsg = utm_epsg(center_lat, center_lon)
    zone = utm_zone(center_lon)

    to_utm = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
    to_wgs = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)

    # Centre in UTM
    cx, cy = to_utm.transform(center_lon, center_lat)

    # Bounds (add one spacing margin so labels appear at edges)
    x_lo = cx - width_m / 2.0 - spacing_m
    x_hi = cx + width_m / 2.0 + spacing_m
    y_lo = cy - height_m / 2.0 - spacing_m
    y_hi = cy + height_m / 2.0 + spacing_m

    x_start = math.floor(x_lo / spacing_m) * spacing_m
    x_end = math.ceil(x_hi / spacing_m) * spacing_m
    y_start = math.floor(y_lo / spacing_m) * spacing_m
    y_end = math.ceil(y_hi / spacing_m) * spacing_m

    lines: list[GridLine] = []

    # Vertical lines (constant easting)
    e = x_start
    while e <= x_end:
        lon1, lat1 = to_wgs.transform(e, y_lo)
        lon2, lat2 = to_wgs.transform(e, y_hi)
        lines.append(GridLine(
            lat1=lat1, lon1=lon1, lat2=lat2, lon2=lon2,
            label=format_label(e, spacing_m),
            full_value=e,
            direction="v",
        ))
        e += spacing_m

    # Horizontal lines (constant northing)
    n = y_start
    while n <= y_end:
        lon1, lat1 = to_wgs.transform(x_lo, n)
        lon2, lat2 = to_wgs.transform(x_hi, n)
        lines.append(GridLine(
            lat1=lat1, lon1=lon1, lat2=lat2, lon2=lon2,
            label=format_label(n, spacing_m),
            full_value=n,
            direction="h",
        ))
        n += spacing_m

    return GridInfo(
        system="utm",
        zone=f"{zone}{'N' if center_lat >= 0 else 'S'}",
        epsg=epsg,
        center_easting=cx,
        center_northing=cy,
        lines=lines,
    )


# ==================================================================
# Lat/Lon — Decimal Degrees
# ==================================================================

def _auto_dd_spacing(scale: int) -> float:
    """Grid spacing in decimal degrees for a given map scale."""
    if scale <= 5_000:
        return 0.001      # ~111 m
    if scale <= 10_000:
        return 0.002
    if scale <= 25_000:
        return 0.005
    if scale <= 50_000:
        return 0.01
    if scale <= 100_000:
        return 0.02
    return 0.05


def compute_latlon_dd_grid(
    center_lat: float, center_lon: float,
    width_m: float, height_m: float, scale: int,
) -> GridInfo:
    """Grid of lat/lon lines labelled in decimal degrees."""
    spacing = _auto_dd_spacing(scale)

    d_lat = height_m / 111320.0
    d_lon = width_m / (111320.0 * max(math.cos(math.radians(center_lat)), 0.01))
    margin = spacing

    lat_lo = center_lat - d_lat / 2 - margin
    lat_hi = center_lat + d_lat / 2 + margin
    lon_lo = center_lon - d_lon / 2 - margin
    lon_hi = center_lon + d_lon / 2 + margin

    lines: list[GridLine] = []

    # Vertical (constant longitude)
    lon = math.floor(lon_lo / spacing) * spacing
    while lon <= lon_hi:
        lbl = f"{lon:.4f}°"
        lines.append(GridLine(lat_lo, lon, lat_hi, lon, lbl, lon, "v"))
        lon += spacing

    # Horizontal (constant latitude)
    lat = math.floor(lat_lo / spacing) * spacing
    while lat <= lat_hi:
        lbl = f"{lat:.4f}°"
        lines.append(GridLine(lat, lon_lo, lat, lon_hi, lbl, lat, "h"))
        lat += spacing

    return GridInfo(
        system="latlon_dd", zone="WGS-84", epsg=0,
        center_easting=center_lon, center_northing=center_lat,
        lines=lines,
    )


# ==================================================================
# Lat/Lon — Degrees + Decimal Minutes
# ==================================================================

def _auto_dm_spacing_minutes(scale: int) -> float:
    """Grid spacing in arc-minutes."""
    if scale <= 5_000:
        return 0.1
    if scale <= 10_000:
        return 0.2
    if scale <= 25_000:
        return 0.5
    if scale <= 50_000:
        return 1.0
    if scale <= 100_000:
        return 2.0
    return 5.0


def _dd_to_dm(dd: float) -> str:
    """Decimal degrees → D°M.m′ label."""
    sign = "-" if dd < 0 else ""
    dd = abs(dd)
    d = int(dd)
    m = (dd - d) * 60
    return f"{sign}{d}°{m:05.2f}′"


def compute_latlon_dm_grid(
    center_lat: float, center_lon: float,
    width_m: float, height_m: float, scale: int,
) -> GridInfo:
    """Grid of lat/lon lines labelled in degrees + decimal minutes."""
    sp_min = _auto_dm_spacing_minutes(scale)
    spacing = sp_min / 60.0  # convert to degrees

    d_lat = height_m / 111320.0
    d_lon = width_m / (111320.0 * max(math.cos(math.radians(center_lat)), 0.01))
    margin = spacing

    lat_lo = center_lat - d_lat / 2 - margin
    lat_hi = center_lat + d_lat / 2 + margin
    lon_lo = center_lon - d_lon / 2 - margin
    lon_hi = center_lon + d_lon / 2 + margin

    lines: list[GridLine] = []

    lon = math.floor(lon_lo / spacing) * spacing
    while lon <= lon_hi:
        lines.append(GridLine(lat_lo, lon, lat_hi, lon, _dd_to_dm(lon), lon, "v"))
        lon += spacing

    lat = math.floor(lat_lo / spacing) * spacing
    while lat <= lat_hi:
        lines.append(GridLine(lat, lon_lo, lat, lon_hi, _dd_to_dm(lat), lat, "h"))
        lat += spacing

    return GridInfo(
        system="latlon_dm", zone="WGS-84", epsg=0,
        center_easting=center_lon, center_northing=center_lat,
        lines=lines,
    )


# ==================================================================
# MGRS — uses UTM grid but with MGRS-style labels
# ==================================================================

def _utm_to_mgrs_label(easting: float, northing: float, zone: int, north: bool) -> str:
    """Simplified MGRS label from UTM coordinates (100km square + 4-digit)."""
    # Column letter: based on easting, cycles A-H / J-R / S-Z per zone set
    set_idx = (zone - 1) % 3
    col_letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"  # 24 letters (no I, O)
    col_offset = set_idx * 8
    e100k = int(easting / 100_000)
    col_letter = col_letters[(col_offset + e100k - 1) % len(col_letters)]

    # Row letter: based on northing, cycles A-V (20 letters)
    row_letters = "ABCDEFGHJKLMNPQRSTUV"
    row_offset = 0 if (zone % 2 == 1) else 5
    n100k = int(northing / 100_000) % 20
    row_letter = row_letters[(row_offset + n100k) % len(row_letters)]

    e_4 = int(easting % 100_000) // 10
    n_4 = int(northing % 100_000) // 10

    return f"{zone}{col_letter}{row_letter} {e_4:04d} {n_4:04d}"


def compute_mgrs_grid(
    center_lat: float, center_lon: float,
    width_m: float, height_m: float, spacing_m: int,
) -> GridInfo:
    """UTM-based grid with MGRS labels."""
    epsg = utm_epsg(center_lat, center_lon)
    zone = utm_zone(center_lon)
    north = center_lat >= 0

    to_utm = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
    to_wgs = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)

    cx, cy = to_utm.transform(center_lon, center_lat)
    x_lo = cx - width_m / 2 - spacing_m
    x_hi = cx + width_m / 2 + spacing_m
    y_lo = cy - height_m / 2 - spacing_m
    y_hi = cy + height_m / 2 + spacing_m

    x_start = math.floor(x_lo / spacing_m) * spacing_m
    x_end = math.ceil(x_hi / spacing_m) * spacing_m
    y_start = math.floor(y_lo / spacing_m) * spacing_m
    y_end = math.ceil(y_hi / spacing_m) * spacing_m

    lines: list[GridLine] = []

    e = x_start
    while e <= x_end:
        lon1, lat1 = to_wgs.transform(e, y_lo)
        lon2, lat2 = to_wgs.transform(e, y_hi)
        lbl = f"{int(e % 100_000) // 10:04d}E"
        lines.append(GridLine(lat1, lon1, lat2, lon2, lbl, e, "v"))
        e += spacing_m

    n = y_start
    while n <= y_end:
        lon1, lat1 = to_wgs.transform(x_lo, n)
        lon2, lat2 = to_wgs.transform(x_hi, n)
        lbl = f"{int(n % 100_000) // 10:04d}N"
        lines.append(GridLine(lat1, lon1, lat2, lon2, lbl, n, "h"))
        n += spacing_m

    band_letter = "CDEFGHJKLMNPQRSTUVWX"[max(0, min(19, int((center_lat + 80) / 8)))]
    zone_str = f"{zone}{band_letter}"

    return GridInfo(
        system="mgrs", zone=zone_str, epsg=epsg,
        center_easting=cx, center_northing=cy, lines=lines,
    )


# ==================================================================
# Generic projected CRS grid (reused by Gauss-Boaga, Swiss, BNG)
# ==================================================================

def _compute_projected_grid(
    center_lat: float, center_lon: float,
    width_m: float, height_m: float, spacing_m: int,
    epsg: int, system: str, zone_label: str,
) -> GridInfo:
    """Generic grid for any projected CRS given by EPSG code."""
    to_proj = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
    to_wgs = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)

    cx, cy = to_proj.transform(center_lon, center_lat)
    x_lo = cx - width_m / 2 - spacing_m
    x_hi = cx + width_m / 2 + spacing_m
    y_lo = cy - height_m / 2 - spacing_m
    y_hi = cy + height_m / 2 + spacing_m

    x_start = math.floor(x_lo / spacing_m) * spacing_m
    x_end = math.ceil(x_hi / spacing_m) * spacing_m
    y_start = math.floor(y_lo / spacing_m) * spacing_m
    y_end = math.ceil(y_hi / spacing_m) * spacing_m

    lines: list[GridLine] = []

    e = x_start
    while e <= x_end:
        lon1, lat1 = to_wgs.transform(e, y_lo)
        lon2, lat2 = to_wgs.transform(e, y_hi)
        lines.append(GridLine(lat1, lon1, lat2, lon2,
                              format_label(e, spacing_m), e, "v"))
        e += spacing_m

    n = y_start
    while n <= y_end:
        lon1, lat1 = to_wgs.transform(x_lo, n)
        lon2, lat2 = to_wgs.transform(x_hi, n)
        lines.append(GridLine(lat1, lon1, lat2, lon2,
                              format_label(n, spacing_m), n, "h"))
        n += spacing_m

    return GridInfo(
        system=system, zone=zone_label, epsg=epsg,
        center_easting=cx, center_northing=cy, lines=lines,
    )


# ==================================================================
# Gauss-Boaga (Italy)
# ==================================================================

def _gauss_boaga_epsg(lon: float) -> tuple[int, str]:
    """Pick fuso Ovest (EPSG 3003) or Est (EPSG 3004)."""
    if lon < 12.0:
        return 3003, "Fuso Ovest"
    return 3004, "Fuso Est"


def compute_gauss_boaga_grid(
    center_lat: float, center_lon: float,
    width_m: float, height_m: float, spacing_m: int,
) -> GridInfo:
    epsg, zone_label = _gauss_boaga_epsg(center_lon)
    return _compute_projected_grid(
        center_lat, center_lon, width_m, height_m, spacing_m,
        epsg, "gauss_boaga", f"Gauss-Boaga {zone_label}",
    )


# ==================================================================
# German Gauss-Krüger (zones 2–5, EPSG 31466–31469)
# ==================================================================

def _gauss_krueger_epsg(lon: float) -> tuple[int, str]:
    if lon < 7.5:
        return 31466, "Zone 2"
    if lon < 10.5:
        return 31467, "Zone 3"
    if lon < 13.5:
        return 31468, "Zone 4"
    return 31469, "Zone 5"


def compute_gauss_krueger_grid(
    center_lat: float, center_lon: float,
    width_m: float, height_m: float, spacing_m: int,
) -> GridInfo:
    epsg, zone_label = _gauss_krueger_epsg(center_lon)
    return _compute_projected_grid(
        center_lat, center_lon, width_m, height_m, spacing_m,
        epsg, "gauss_krueger", f"Gauss-Krüger {zone_label}",
    )


# ==================================================================
# Unified dispatcher
# ==================================================================

def _full_label(gl: GridLine, system: str) -> str:
    """Format full_value as a non-abbreviated label."""
    if system in ("latlon_dd", "latlon"):
        return f"{gl.full_value:.6f}°"
    if system in ("latlon_dm",):
        return _dd_to_dm(gl.full_value)
    # Projected grids: metres
    return str(int(round(gl.full_value)))


# Projected grids dispatched via EPSG code → (epsg, zone_label).
_PROJECTED_GRIDS: dict[str, tuple[int, str]] = {
    "swiss":         (2056,  "CH1903+ / LV95"),
    "bng":           (27700, "OSGB36"),
    "dutch":         (28992, "RD New"),
    "irish_ig":      (29902, "Irish Grid"),
    "irish_itm":     (2157,  "Irish TM"),
    "eov":           (23700, "EOV"),
    "kkj":           (2393,  "KKJ zone 3"),
    "nztm":          (2193,  "NZGD2000 / TM"),
    "sweref99":      (3006,  "SWEREF 99 TM"),
    "rt90":          (3021,  "RT90 2.5 gon V"),
    "south_african": (2054,  "Hartebeesthoek94 Lo29"),
    "taiwan":        (3826,  "TWD97 / TM2"),
    "qng":           (28600, "QNG (Qatar)"),
}


def compute_grid(
    grid_type: str,
    center_lat: float,
    center_lon: float,
    width_m: float,
    height_m: float,
    spacing_m: int,
    scale: int = 25_000,
    full_labels: bool = False,
) -> GridInfo | None:
    """Compute grid lines for the requested system.

    Returns ``None`` for ``grid_type="none"``.
    """
    if grid_type == "none":
        return None

    # Legacy aliases
    if grid_type in ("latlon_dd", "latlon_dm"):
        grid_type = "latlon"

    if grid_type == "utm":
        gi = compute_utm_grid(center_lat, center_lon, width_m, height_m, spacing_m)
    elif grid_type == "mgrs":
        gi = compute_mgrs_grid(center_lat, center_lon, width_m, height_m, spacing_m)
    elif grid_type == "latlon":
        gi = compute_latlon_dd_grid(center_lat, center_lon, width_m, height_m, scale)
    elif grid_type == "gauss_boaga":
        gi = compute_gauss_boaga_grid(center_lat, center_lon, width_m, height_m, spacing_m)
    elif grid_type == "gauss_krueger":
        gi = compute_gauss_krueger_grid(center_lat, center_lon, width_m, height_m, spacing_m)
    elif grid_type in _PROJECTED_GRIDS:
        epsg, label = _PROJECTED_GRIDS[grid_type]
        gi = _compute_projected_grid(
            center_lat, center_lon, width_m, height_m, spacing_m,
            epsg, grid_type, label,
        )
    else:
        return None

    if full_labels and gi is not None:
        new_lines = [
            GridLine(gl.lat1, gl.lon1, gl.lat2, gl.lon2,
                     _full_label(gl, gi.system), gl.full_value, gl.direction)
            for gl in gi.lines
        ]
        gi = GridInfo(
            system=gi.system, zone=gi.zone, epsg=gi.epsg,
            center_easting=gi.center_easting,
            center_northing=gi.center_northing,
            lines=new_lines,
        )

    return gi
