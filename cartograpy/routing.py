"""BRouter routing wrapper.

Computes hiking / MTB / trekking / cycling routes between two or more
waypoints using the public BRouter service (https://brouter.de). Free,
no API key, no quota beyond fair use. Returns the route as GeoJSON-style
coordinates plus distance, ascent, and duration estimates.

Profiles
--------
The user-facing keys are mapped to the official BRouter profile names:

* ``hiking``   -> ``hiking`` (fallback: ``hiking-mountain``)
* ``trekking`` -> ``trekking``
* ``foot``     -> ``shortest`` (fallback: ``hiking``)
* ``mtb``      -> ``mtb``
* ``bike``     -> ``fastbike`` (fallback: ``trekking``)
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request

_BROUTER = "https://brouter.de/brouter"
_UA = "CartograPy/1.0 (routing)"

_PROFILES: dict[str, tuple[str, ...]] = {
    "hiking":   ("hiking", "hiking-mountain"),
    "trekking": ("trekking",),
    "foot":     ("shortest", "hiking"),
    "mtb":      ("mtb",),
    "bike":     ("fastbike", "trekking"),
}

PROFILE_KEYS: tuple[str, ...] = tuple(_PROFILES.keys())


def route(profile: str, points: list[tuple[float, float]],
          timeout: float = 45.0) -> dict:
    """Compute a route through ``points`` (list of ``(lat, lon)``).

    Returns a dict::

        {
            "coords":   [[lat, lon], ...],
            "distance": metres,
            "duration": seconds (approx),
            "ascend":   metres of ascent,
            "profile":  "<resolved-brouter-profile>",
        }

    Raises ``ValueError`` on bad input or upstream failure.
    """
    if profile not in _PROFILES:
        raise ValueError(f"unknown profile: {profile}")
    if len(points) < 2:
        raise ValueError("need at least 2 points")

    last_error: ValueError | None = None
    for resolved_profile in _PROFILES[profile]:
        try:
            return _route_with_profile(resolved_profile, points, timeout)
        except ValueError as exc:
            last_error = exc
    if last_error is not None:
        raise last_error
    raise ValueError("BRouter returned no route")


def _route_with_profile(resolved_profile: str, points: list[tuple[float, float]],
                        timeout: float) -> dict:
    """Compute a route with an already-resolved BRouter profile name."""
    lonlats = "|".join(f"{lon:.6f},{lat:.6f}" for lat, lon in points)
    qs = urllib.parse.urlencode({
        "lonlats":         lonlats,
        "profile":         resolved_profile,
        "alternativeidx":  "0",
        "format":          "geojson",
    })
    url = f"{_BROUTER}?{qs}"

    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode())
    except Exception as exc:                          # noqa: BLE001
        raise ValueError(f"BRouter upstream error: {exc}") from exc

    feats = payload.get("features") or []
    if not feats:
        raise ValueError("BRouter returned no route")
    geom = feats[0].get("geometry") or {}
    coords_lonlat = geom.get("coordinates") or []
    if len(coords_lonlat) < 2:
        raise ValueError("BRouter returned an empty geometry")

    coords = [_to_latlon(c) for c in coords_lonlat]
    coords = [c for c in coords if c is not None]
    if len(coords) < 2:
        raise ValueError("BRouter returned malformed geometry")

    props = feats[0].get("properties") or {}
    # BRouter returns `track-length` (m) and `total-time` (s) as strings.
    def _f(name: str) -> float:
        try:
            return float(props.get(name, 0))
        except (TypeError, ValueError):
            return 0.0

    return {
        "coords":   coords,
        "distance": _f("track-length"),
        "duration": _f("total-time"),
        "ascend":   _f("filtered ascend"),
        "profile":  resolved_profile,
    }


def _to_latlon(coord: object) -> list[float] | None:
    """Convert a GeoJSON coordinate ``[lon, lat, ...]`` to ``[lat, lon]``."""
    if not isinstance(coord, (list, tuple)) or len(coord) < 2:
        return None
    try:
        lon = float(coord[0])
        lat = float(coord[1])
    except (TypeError, ValueError):
        return None
    return [lat, lon]


__all__ = ["route", "PROFILE_KEYS"]
