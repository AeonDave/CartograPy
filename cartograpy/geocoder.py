"""Place search via Nominatim and Photon (OpenStreetMap geocoding APIs)."""
from __future__ import annotations

from dataclasses import dataclass

import requests

_NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
_PHOTON_URL = "https://photon.komoot.io/api/"
_HEADERS = {"User-Agent": "CartograPy/1.0 (map-printing tool; educational)"}


@dataclass(frozen=True, slots=True)
class GeoResult:
    name: str
    lat: float
    lon: float


def geocode(query: str, limit: int = 8) -> list[GeoResult]:
    """Return up to *limit* results for a free-text place search."""
    resp = requests.get(
        _NOMINATIM_URL,
        params={"q": query, "format": "json", "limit": limit},
        headers=_HEADERS,
        timeout=10,
    )
    resp.raise_for_status()
    out: list[GeoResult] = []
    for r in resp.json():
        out.append(
            GeoResult(
                name=r.get("display_name", ""),
                lat=float(r["lat"]),
                lon=float(r["lon"]),
            )
        )
    return out


_PHOTON_LANGS = {"en", "de", "fr"}


def autocomplete(query: str, limit: int = 8, lang: str = "en") -> list[GeoResult]:
    """Return up to *limit* autocomplete results using Photon (prefix-friendly)."""
    params: dict[str, str | int] = {"q": query, "limit": limit}
    if lang in _PHOTON_LANGS:
        params["lang"] = lang
    resp = requests.get(
        _PHOTON_URL,
        params=params,
        headers=_HEADERS,
        timeout=10,
    )
    resp.raise_for_status()
    out: list[GeoResult] = []
    for feat in resp.json().get("features", []):
        props = feat.get("properties", {})
        coords = feat.get("geometry", {}).get("coordinates", [])
        if len(coords) < 2:
            continue
        parts = [props.get("name", "")]
        for key in ("city", "county", "state", "country"):
            val = props.get(key, "")
            if val and val != parts[0]:
                parts.append(val)
        display_name = ", ".join(p for p in parts if p)
        out.append(GeoResult(name=display_name, lat=coords[1], lon=coords[0]))
    return out
