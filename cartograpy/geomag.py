"""Magnetic declination and grid convergence helpers.

Two angles matter for using a printed map with a compass:

* **Magnetic declination** — angle between true north and magnetic north.
  Computed via the World Magnetic Model 2025 (``pygeomag`` package, a
  required dependency). A dipole-only fallback is kept only as a guard
  against import failures in non-standard environments.

* **Grid convergence** — angle between true north and the grid (UTM /
  Transverse Mercator) north line. Computed analytically from the
  central-meridian / latitude geometry of the relevant projection via
  :mod:`pyproj`.

Both angles are returned in **degrees, positive east of true north**
(the convention used on most national topographic maps).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date

try:
    from pygeomag import GeoMag  # type: ignore
    _GM: "GeoMag | None" = None

    def _wmm_declination(lat: float, lon: float, year: float) -> float:
        global _GM
        if _GM is None:
            _GM = GeoMag()
        result = _GM.calculate(glat=lat, glon=lon, alt=0, time=year)
        return float(result.d)
except Exception:  # pragma: no cover - optional dependency
    _wmm_declination = None  # type: ignore[assignment]


@dataclass(frozen=True, slots=True)
class GeoMagInfo:
    """Combined magnetic declination + grid convergence at a point."""

    declination_deg: float        # +E, magnetic - true
    convergence_deg: float        # +E, grid - true
    grid_magnetic_deg: float      # magnetic - grid (compass <-> map grid)
    model: str                    # "WMM2025" or "fallback"
    year: float


# ---------------------------------------------------------------------------
# Magnetic declination
# ---------------------------------------------------------------------------

def _decimal_year(d: date | None = None) -> float:
    d = d or date.today()
    start = date(d.year, 1, 1).toordinal()
    end = date(d.year + 1, 1, 1).toordinal()
    return d.year + (d.toordinal() - start) / (end - start)


def _fallback_declination(lat: float, lon: float) -> float:
    """Quick analytical approximation when pygeomag is unavailable.

    Based on the IGRF dipole-only term — sufficient for showing a
    qualitatively correct arrow on the map, not for navigation. Returns
    degrees, positive east.
    """
    # Geomagnetic pole 2025 (north): 80.7°N, 72.7°W (i.e. lon = -72.7)
    pole_lat = math.radians(80.7)
    pole_lon = math.radians(-72.7)
    p_lat = math.radians(lat)
    p_lon = math.radians(lon)
    dlon = p_lon - pole_lon
    # Bearing from point to magnetic pole
    y = math.sin(dlon) * math.cos(pole_lat)
    x = (math.cos(p_lat) * math.sin(pole_lat)
         - math.sin(p_lat) * math.cos(pole_lat) * math.cos(dlon))
    bearing = math.degrees(math.atan2(y, x))
    # Declination ≈ bearing to magnetic pole (rough)
    return ((bearing + 540) % 360) - 180


def magnetic_declination(lat: float, lon: float,
                         year: float | None = None) -> tuple[float, str]:
    """Return ``(declination_deg, model_name)``.

    Positive values mean magnetic north is east of true north.
    """
    yr = year if year is not None else _decimal_year()
    if _wmm_declination is not None:
        try:
            return float(_wmm_declination(lat, lon, yr)), "WMM2025"
        except Exception:
            pass
    return _fallback_declination(lat, lon), "fallback"


# ---------------------------------------------------------------------------
# Grid convergence (true north vs grid north)
# ---------------------------------------------------------------------------

def _utm_zone(lon: float) -> int:
    return max(1, min(60, int((lon + 180) // 6) + 1))


def grid_convergence(lat: float, lon: float, epsg: int | None = None) -> float:
    """Return the angle between true north and grid north, in degrees east.

    ``epsg`` is the projected CRS to use (e.g. UTM zone). If ``None``, UTM
    of the local zone is assumed.
    """
    try:
        from pyproj import CRS, Transformer
    except ImportError:
        return 0.0

    if epsg is None or epsg == 0:
        zone = _utm_zone(lon)
        epsg = 32600 + zone if lat >= 0 else 32700 + zone

    try:
        # Use a tiny offset along the meridian to measure grid-north tilt.
        crs_geo = CRS.from_epsg(4326)
        crs_proj = CRS.from_epsg(epsg)
        to_proj = Transformer.from_crs(crs_geo, crs_proj, always_xy=True)
        x0, y0 = to_proj.transform(lon, lat)
        # Step ~100 m due true north at this latitude.
        dlat = 100.0 / 111320.0
        x1, y1 = to_proj.transform(lon, lat + dlat)
        # Angle of the projected meridian segment, measured CW from grid north.
        # Grid east = +x, grid north = +y. True-north step gives (dx, dy);
        # convergence is the rotation from (0, +1) to (dx, dy).
        dx = x1 - x0
        dy = y1 - y0
        # If grid north is rotated east of true north -> dx < 0 -> convergence > 0
        conv = -math.degrees(math.atan2(dx, dy))
        return conv
    except Exception:
        return 0.0


# ---------------------------------------------------------------------------
# Combined
# ---------------------------------------------------------------------------

def compute_geomag(lat: float, lon: float, epsg: int | None = None) -> GeoMagInfo:
    """Return all angles needed to annotate a printed map."""
    decl, model = magnetic_declination(lat, lon)
    conv = grid_convergence(lat, lon, epsg)
    return GeoMagInfo(
        declination_deg=decl,
        convergence_deg=conv,
        grid_magnetic_deg=decl - conv,
        model=model,
        year=_decimal_year(),
    )
