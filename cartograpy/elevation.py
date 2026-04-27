"""Elevation profile fetcher.

Resolves elevations for a list of ``(lat, lon)`` points using the public
Open-Elevation API (https://api.open-elevation.com). Results are cached
in memory by quantised coordinates so a re-measurement of the same line
does not re-fetch.
"""
from __future__ import annotations

import json
import math
import urllib.request
from typing import Iterable

_API = "https://api.open-elevation.com/api/v1/lookup"
_UA = "CartograPy/1.0 (elevation-profile)"
_CACHE: dict[tuple[int, int], float] = {}


def _key(lat: float, lon: float) -> tuple[int, int]:
    """Quantise to ~10 m so jittered duplicates collapse."""
    return (int(round(lat * 1e4)), int(round(lon * 1e4)))


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def densify(points: list[tuple[float, float]],
            max_step_m: float = 200.0,
            max_total: int = 200) -> list[tuple[float, float]]:
    """Insert intermediate points so consecutive samples are <= ``max_step_m``.

    Caps the total number of samples at ``max_total`` to keep API calls
    within Open-Elevation's free-tier limits (~100 points per request).
    """
    if len(points) < 2:
        return list(points)

    # Estimate required samples
    total = 0.0
    seg_lens = []
    for i in range(1, len(points)):
        d = _haversine(*points[i - 1], *points[i])
        seg_lens.append(d)
        total += d
    if total == 0:
        return list(points)

    # Cap step size to honour max_total
    step = max(max_step_m, total / max(1, max_total - 1))

    out: list[tuple[float, float]] = [points[0]]
    for i, seg_len in enumerate(seg_lens):
        a = points[i]
        b = points[i + 1]
        n = max(1, int(math.ceil(seg_len / step)))
        for k in range(1, n + 1):
            t = k / n
            lat = a[0] + (b[0] - a[0]) * t
            lon = a[1] + (b[1] - a[1]) * t
            out.append((lat, lon))
    return out[:max_total]


def fetch_profile(points: Iterable[tuple[float, float]],
                  timeout: float = 15.0) -> list[dict]:
    """Return a list of ``{lat, lon, ele, dist}`` for each point.

    ``dist`` is the cumulative distance from the first point in metres.
    Missing samples (cache miss + network failure) get ``ele = None``.
    """
    pts = list(points)
    if not pts:
        return []

    # Find points missing from cache
    missing = [p for p in pts if _key(*p) not in _CACHE]
    if missing:
        body = json.dumps({
            "locations": [{"latitude": p[0], "longitude": p[1]} for p in missing],
        }).encode()
        req = urllib.request.Request(
            _API, data=body, method="POST",
            headers={"Content-Type": "application/json", "User-Agent": _UA},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode())
            for p, r in zip(missing, data.get("results", [])):
                ele = r.get("elevation")
                if ele is not None:
                    _CACHE[_key(*p)] = float(ele)
        except Exception:
            pass  # leave gaps in cache; result will have None elevations

    out: list[dict] = []
    cum = 0.0
    prev: tuple[float, float] | None = None
    for p in pts:
        if prev is not None:
            cum += _haversine(*prev, *p)
        ele = _CACHE.get(_key(*p))
        out.append({"lat": p[0], "lon": p[1], "ele": ele, "dist": cum})
        prev = p
    return out


def profile_stats(profile: list[dict]) -> dict:
    """Compute min/max/gain/loss/distance from a profile list."""
    eles = [p["ele"] for p in profile if p.get("ele") is not None]
    if not eles:
        return {"min": None, "max": None, "gain": 0.0, "loss": 0.0,
                "distance": profile[-1]["dist"] if profile else 0.0}
    gain = 0.0
    loss = 0.0
    last = None
    for p in profile:
        e = p.get("ele")
        if e is None:
            continue
        if last is not None:
            d = e - last
            if d > 0:
                gain += d
            else:
                loss -= d
        last = e
    return {
        "min": min(eles),
        "max": max(eles),
        "gain": gain,
        "loss": loss,
        "distance": profile[-1]["dist"] if profile else 0.0,
    }
