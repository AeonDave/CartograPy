"""Place search via Nominatim (OpenStreetMap geocoding API)."""
from __future__ import annotations

from dataclasses import dataclass

import requests

_URL = "https://nominatim.openstreetmap.org/search"
_HEADERS = {"User-Agent": "CartograPy/1.0 (map-printing tool; educational)"}


@dataclass(frozen=True, slots=True)
class GeoResult:
    name: str
    lat: float
    lon: float


def geocode(query: str, limit: int = 8) -> list[GeoResult]:
    """Return up to *limit* results for a free-text place search."""
    resp = requests.get(
        _URL,
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
