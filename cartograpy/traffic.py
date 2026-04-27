"""Live traffic provider adapters for aircraft, vessels, and trains.

The module exposes a small provider-neutral API used by the HTTP server. Each
provider returns the same JSON-friendly feature shape so the Leaflet frontend can
render live markers without knowing provider-specific payloads.
"""
from __future__ import annotations

import hashlib
import json
import math
import time
import urllib.parse
import urllib.request
from calendar import timegm
from dataclasses import dataclass
from typing import Any

_USER_AGENT = "CartograPy/1.0 (live-traffic overlay; educational)"
_OPENSKY_URL = "https://opensky-network.org/api/states/all"
_AISHUB_URL = "https://data.aishub.net/ws.php"

_PROVIDER_TTL = {
    "aircraft_opensky": 20,
    "vessel_aishub": 60,
    "train_gtfsrt": 30,
}
_PROVIDER_KIND = {
    "aircraft_opensky": "aircraft",
    "vessel_aishub": "vessel",
    "train_gtfsrt": "train",
}
_PROVIDER_MAX_AREA = {
    "aircraft_opensky": 400.0,
    "vessel_aishub": 100.0,
    "train_gtfsrt": 400.0,
}

_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


@dataclass(frozen=True, slots=True)
class BoundingBox:
    """WGS-84 bounding box used by live traffic providers."""

    south: float
    west: float
    north: float
    east: float

    @property
    def area_deg2(self) -> float:
        """Return rough bounding-box area in square degrees."""
        return max(0.0, self.north - self.south) * max(0.0, self.east - self.west)

    def contains(self, lat: float | None, lon: float | None) -> bool:
        """Return true if ``lat``/``lon`` falls inside the bbox."""
        if lat is None or lon is None:
            return False
        return self.south <= lat <= self.north and self.west <= lon <= self.east


class TrafficError(ValueError):
    """Raised when a live traffic provider cannot produce usable data."""


class TrafficConfigError(TrafficError):
    """Raised when a provider is missing required local configuration."""


def query_live_traffic(provider: str, bbox: BoundingBox, config: dict[str, Any] | None = None) -> dict:
    """Return normalized live traffic features for ``provider`` inside ``bbox``.

    Args:
        provider: Provider id, e.g. ``"aircraft_opensky"``.
        bbox: Visible map extent in WGS-84.
        config: Saved local config containing provider credentials/URLs.

    Raises:
        TrafficError: If provider, bbox, config, or upstream response is invalid.
    """
    _validate_provider(provider)
    _validate_bbox(provider, bbox)
    cfg = config or {}
    ttl = _PROVIDER_TTL[provider]
    cache_key = _cache_key(provider, bbox, cfg)
    now = time.time()
    cached = _CACHE.get(cache_key)
    if cached and cached[0] > now:
        payload = dict(cached[1])
        payload["cached"] = True
        return payload

    if provider == "aircraft_opensky":
        features = _fetch_opensky(bbox)
    elif provider == "vessel_aishub":
        features = _fetch_aishub(bbox, cfg)
    elif provider == "train_gtfsrt":
        features = _fetch_gtfs_realtime(bbox, cfg)
    else:  # pragma: no cover - guarded by _validate_provider
        raise TrafficError(f"unsupported provider: {provider}")

    payload = {
        "provider": provider,
        "kind": _PROVIDER_KIND[provider],
        "features": features,
        "fetched_at": int(now),
        "ttl": ttl,
        "cached": False,
    }
    _CACHE[cache_key] = (now + ttl, payload)
    return payload


def available_providers() -> dict[str, str]:
    """Return supported provider id -> traffic kind map."""
    return dict(_PROVIDER_KIND)


def _validate_provider(provider: str) -> None:
    if provider not in _PROVIDER_KIND:
        raise TrafficError(f"unsupported provider: {provider}")


def _validate_bbox(provider: str, bbox: BoundingBox) -> None:
    if not (-90 <= bbox.south <= bbox.north <= 90):
        raise TrafficError("invalid latitude bounds")
    if not (-180 <= bbox.west <= bbox.east <= 180):
        raise TrafficError("invalid longitude bounds")
    if bbox.area_deg2 <= 0:
        raise TrafficError("empty bbox")
    max_area = _PROVIDER_MAX_AREA[provider]
    if bbox.area_deg2 > max_area:
        raise TrafficError("zoom in to load live traffic")


def _cache_key(provider: str, bbox: BoundingBox, config: dict[str, Any]) -> str:
    qs = (
        round(bbox.south, 2), round(bbox.west, 2),
        round(bbox.north, 2), round(bbox.east, 2),
    )
    config_part = ""
    if provider == "vessel_aishub":
        config_part = str(config.get("aishubUsername") or "")
    elif provider == "train_gtfsrt":
        config_part = str(config.get("gtfsRealtimeUrl") or "")
    digest = hashlib.sha1(config_part.encode("utf-8")).hexdigest()[:10]
    return f"{provider}|{qs}|{digest}"


def _fetch_json(url: str, timeout: float = 12.0) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read().decode("utf-8", errors="replace")
    except Exception as exc:
        raise TrafficError(f"live traffic upstream error: {exc}") from exc
    try:
        return json.loads(data)
    except json.JSONDecodeError as exc:
        raise TrafficError("live traffic upstream returned invalid JSON") from exc


def _fetch_bytes(url: str, timeout: float = 12.0) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except Exception as exc:
        raise TrafficError(f"live traffic upstream error: {exc}") from exc


def _fetch_opensky(bbox: BoundingBox) -> list[dict[str, Any]]:
    params = urllib.parse.urlencode({
        "lamin": f"{bbox.south:.6f}",
        "lomin": f"{bbox.west:.6f}",
        "lamax": f"{bbox.north:.6f}",
        "lomax": f"{bbox.east:.6f}",
    })
    payload = _fetch_json(f"{_OPENSKY_URL}?{params}")
    states = payload.get("states") or []
    features: list[dict[str, Any]] = []
    for row in states:
        if not isinstance(row, list) or len(row) < 11:
            continue
        lon = _float_or_none(row[5])
        lat = _float_or_none(row[6])
        if not bbox.contains(lat, lon):
            continue
        icao24 = _clean_str(row[0])
        callsign = _clean_str(row[1])
        altitude_m = _float_or_none(row[7])
        speed_ms = _float_or_none(row[9])
        heading = _heading_or_none(row[10])
        timestamp = _int_or_none(row[3]) or _int_or_none(row[4])
        features.append({
            "id": f"aircraft:{icao24}",
            "kind": "aircraft",
            "provider": "aircraft_opensky",
            "lat": lat,
            "lon": lon,
            "heading": heading,
            "speed": _round(speed_ms * 3.6 if speed_ms is not None else None, 1),
            "speed_unit": "km/h",
            "altitude": _round(altitude_m, 0),
            "altitude_unit": "m",
            "label": callsign or icao24.upper(),
            "timestamp": timestamp,
            "details": {
                "icao24": icao24,
                "callsign": callsign,
                "origin_country": _clean_str(row[2]),
                "on_ground": bool(row[8]),
                "vertical_rate": _round(_float_or_none(row[11]), 1),
                "squawk": _clean_str(row[14]) if len(row) > 14 else "",
            },
        })
    return features


def _fetch_aishub(bbox: BoundingBox, config: dict[str, Any]) -> list[dict[str, Any]]:
    username = str(config.get("aishubUsername") or "").strip()
    if not username:
        raise TrafficConfigError("AISHub username missing")
    params = urllib.parse.urlencode({
        "username": username,
        "format": 1,
        "output": "json",
        "compress": 0,
        "latmin": f"{bbox.south:.6f}",
        "latmax": f"{bbox.north:.6f}",
        "lonmin": f"{bbox.west:.6f}",
        "lonmax": f"{bbox.east:.6f}",
    })
    payload = _fetch_json(f"{_AISHUB_URL}?{params}", timeout=20.0)
    records = _aishub_records(payload)
    features: list[dict[str, Any]] = []
    for rec in records:
        lat = _float_or_none(rec.get("LATITUDE"))
        lon = _float_or_none(rec.get("LONGITUDE"))
        if not bbox.contains(lat, lon):
            continue
        mmsi = str(rec.get("MMSI") or "").strip()
        heading = _heading_or_none(rec.get("HEADING"))
        if heading is None:
            heading = _heading_or_none(rec.get("COG"))
        timestamp = _parse_aishub_time(rec.get("TIME") or rec.get("TSTAMP"))
        features.append({
            "id": f"vessel:{mmsi}",
            "kind": "vessel",
            "provider": "vessel_aishub",
            "lat": lat,
            "lon": lon,
            "heading": heading,
            "speed": _round(_float_or_none(rec.get("SOG")), 1),
            "speed_unit": "kn",
            "altitude": None,
            "altitude_unit": "",
            "label": _clean_str(rec.get("NAME")) or mmsi,
            "timestamp": timestamp,
            "details": {
                "mmsi": mmsi,
                "imo": str(rec.get("IMO") or "").strip(),
                "callsign": _clean_str(rec.get("CALLSIGN")),
                "type": str(rec.get("TYPE") or "").strip(),
                "destination": _clean_str(rec.get("DEST")),
                "nav_status": str(rec.get("NAVSTAT") or "").strip(),
                "course": _round(_float_or_none(rec.get("COG")), 1),
            },
        })
    return features


def _aishub_records(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        if len(payload) >= 2 and isinstance(payload[1], list):
            return [r for r in payload[1] if isinstance(r, dict)]
        return [r for r in payload if isinstance(r, dict)]
    if isinstance(payload, dict):
        if payload.get("ERROR"):
            raise TrafficError(str(payload.get("ERROR_MESSAGE") or "AISHub error"))
        for key in ("data", "records", "vessels"):
            rows = payload.get(key)
            if isinstance(rows, list):
                return [r for r in rows if isinstance(r, dict)]
    return []


def _fetch_gtfs_realtime(bbox: BoundingBox, config: dict[str, Any]) -> list[dict[str, Any]]:
    url = str(config.get("gtfsRealtimeUrl") or "").strip()
    if not url:
        raise TrafficConfigError("GTFS-Realtime URL missing")
    try:
        from google.transit import gtfs_realtime_pb2  # type: ignore[import-not-found]
    except Exception as exc:
        raise TrafficConfigError("install gtfs-realtime-bindings for train traffic") from exc

    feed = gtfs_realtime_pb2.FeedMessage()
    try:
        feed.ParseFromString(_fetch_bytes(url, timeout=20.0))
    except Exception as exc:
        raise TrafficError(f"invalid GTFS-Realtime feed: {exc}") from exc

    features: list[dict[str, Any]] = []
    for entity in feed.entity:
        if not entity.HasField("vehicle") or not entity.vehicle.HasField("position"):
            continue
        veh = entity.vehicle
        pos = veh.position
        lat = _float_or_none(pos.latitude)
        lon = _float_or_none(pos.longitude)
        if not bbox.contains(lat, lon):
            continue
        vehicle_id = _clean_str(getattr(veh.vehicle, "id", "")) if veh.HasField("vehicle") else ""
        vehicle_label = _clean_str(getattr(veh.vehicle, "label", "")) if veh.HasField("vehicle") else ""
        route_id = _clean_str(getattr(veh.trip, "route_id", "")) if veh.HasField("trip") else ""
        trip_id = _clean_str(getattr(veh.trip, "trip_id", "")) if veh.HasField("trip") else ""
        features.append({
            "id": f"train:{vehicle_id or entity.id}",
            "kind": "train",
            "provider": "train_gtfsrt",
            "lat": lat,
            "lon": lon,
            "heading": _heading_or_none(pos.bearing if pos.HasField("bearing") else None),
            "speed": _round(pos.speed * 3.6 if pos.HasField("speed") else None, 1),
            "speed_unit": "km/h",
            "altitude": None,
            "altitude_unit": "",
            "label": vehicle_label or vehicle_id or route_id or entity.id,
            "timestamp": _int_or_none(veh.timestamp) if veh.HasField("timestamp") else None,
            "details": {
                "vehicle_id": vehicle_id,
                "route_id": route_id,
                "trip_id": trip_id,
                "stop_id": _clean_str(getattr(veh, "stop_id", "")),
                "status": str(getattr(veh, "current_status", "")),
            },
        })
    return features


def _float_or_none(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v):
        return None
    return v


def _int_or_none(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _heading_or_none(value: Any) -> float | None:
    v = _float_or_none(value)
    if v is None or v < 0 or v >= 511:
        return None
    return round(v % 360, 1)


def _round(value: float | None, ndigits: int) -> float | None:
    if value is None:
        return None
    return round(value, ndigits)


def _clean_str(value: Any) -> str:
    return str(value or "").strip()


def _parse_aishub_time(value: Any) -> int | None:
    raw = _clean_str(value)
    if not raw:
        return None
    ts = _int_or_none(raw)
    if ts is not None:
        return ts
    try:
        parsed = time.strptime(raw.replace(" GMT", ""), "%Y-%m-%d %H:%M:%S")
        return int(timegm(parsed))
    except ValueError:
        return None


__all__ = [
    "BoundingBox",
    "TrafficConfigError",
    "TrafficError",
    "available_providers",
    "query_live_traffic",
]
