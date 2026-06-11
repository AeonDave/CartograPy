"""Hourly weather forecast proxy with provider fallback.

Primary provider is Open-Meteo (free, no key). Their public API has been
unstable (intermittent 502s / aggressive rate limiting — see
github.com/open-meteo/open-meteo/issues/1866), so when it fails the proxy
falls back to MET Norway's Locationforecast (free, no key, global), whose
response is normalized to the same Open-Meteo-like shape the frontend
consumes::

    {"hourly": {"temperature_2m": [...], "weathercode": [...], ...},
     "source": "open-meteo" | "met.no"}

Responses are cached for 10 minutes per (~1 km cell, date): every map
search triggers a forecast fetch, and both providers expect clients to
cache.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

_OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
_MET_NO = "https://api.met.no/weatherapi/locationforecast/2.0/compact"
# MET Norway terms require an identifying User-Agent with contact info.
_UA_OM = "CartograPy/1.0 (weather-widget)"
_UA_MET = "CartograPy/1.0 (+https://github.com/AeonDave/cartogra-py)"

_TTL_SEC = 600.0
_CACHE: dict[tuple, tuple[float, dict]] = {}

_HOURLY_FIELDS = (
    "temperature_2m", "apparent_temperature", "weathercode",
    "relativehumidity_2m", "precipitation_probability", "precipitation",
    "windspeed_10m", "windgusts_10m", "winddirection_10m", "uv_index",
)


class WeatherError(Exception):
    """Raised when no provider could produce a forecast."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def get_forecast(lat: float, lon: float, date: str = "") -> dict:
    """Return an hourly forecast dict, trying Open-Meteo then MET Norway."""
    cache_key = (round(lat, 2), round(lon, 2), date)
    now = time.time()
    cached = _CACHE.get(cache_key)
    if cached and cached[0] > now:
        return cached[1]

    errors: list[str] = []
    data = _try_open_meteo(lat, lon, date, errors)
    if data is None:
        data = _try_met_no(lat, lon, date, errors)
    if data is None:
        raise WeatherError("weather providers unavailable: " + "; ".join(errors))

    for stale in [k for k, (exp, _) in _CACHE.items() if exp <= now]:
        _CACHE.pop(stale, None)
    _CACHE[cache_key] = (now + _TTL_SEC, data)
    return data


# ---------------------------------------------------------------------------
# Open-Meteo (primary)
# ---------------------------------------------------------------------------

def _try_open_meteo(lat: float, lon: float, date: str,
                    errors: list[str]) -> dict | None:
    params = (
        f"latitude={lat}&longitude={lon}"
        f"&hourly={','.join(_HOURLY_FIELDS)}"
        f"&timezone=auto"
    )
    params += f"&start_date={date}&end_date={date}" if date else "&forecast_days=1"
    req = urllib.request.Request(
        f"{_OPEN_METEO}?{params}", headers={"User-Agent": _UA_OM})

    # Short retry on transient 5xx/timeouts; a 429 (rate limit) is final —
    # retrying makes it worse, the MET fallback takes over instead.
    for timeout in (10, 18):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode())
            data["source"] = "open-meteo"
            return data
        except urllib.error.HTTPError as exc:
            errors.append(f"open-meteo HTTP {exc.code}")
            if exc.code == 429:
                return None
        except Exception as exc:
            errors.append(f"open-meteo {type(exc).__name__}")
    return None


# ---------------------------------------------------------------------------
# MET Norway (fallback)
# ---------------------------------------------------------------------------

# symbol_code base → WMO weather code (the frontend maps WMO → icon/label).
_MET_SYMBOL_TO_WMO = {
    "clearsky": 0, "fair": 1, "partlycloudy": 2, "cloudy": 3, "fog": 45,
    "lightrain": 61, "lightrainshowers": 61,
    "rain": 63, "rainshowers": 63,
    "heavyrain": 65, "heavyrainshowers": 65,
    "lightsleet": 66, "lightsleetshowers": 66,
    "sleet": 66, "sleetshowers": 66,
    "heavysleet": 67, "heavysleetshowers": 67,
    "lightsnow": 71, "lightsnowshowers": 71,
    "snow": 73, "snowshowers": 85,
    "heavysnow": 75, "heavysnowshowers": 86,
}


def _met_symbol_to_wmo(symbol: str) -> int:
    base = symbol.split("_", 1)[0]  # strip _day / _night / _polartwilight
    if "thunder" in base:
        return 95
    return _MET_SYMBOL_TO_WMO.get(base, 3)


def _try_met_no(lat: float, lon: float, date: str,
                errors: list[str]) -> dict | None:
    req = urllib.request.Request(
        f"{_MET_NO}?lat={lat:.4f}&lon={lon:.4f}",
        headers={"User-Agent": _UA_MET})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = json.loads(resp.read().decode())
        return _normalize_met_no(payload, lon, date)
    except Exception as exc:
        errors.append(f"met.no {type(exc).__name__}: {exc}")
        return None


def _normalize_met_no(payload: dict, lon: float, date: str) -> dict | None:
    """Convert a Locationforecast timeseries into 24 Open-Meteo-like slots.

    MET timestamps are UTC; hours are mapped to approximate local solar
    time via a longitude-based offset (±1 h vs civil time at worst — fine
    for a fallback provider).
    """
    series = (payload.get("properties") or {}).get("timeseries") or []
    if not series:
        return None

    tz = timezone(timedelta(hours=round(lon / 15.0)))
    if date:
        target = date
    else:
        target = datetime.now(tz).strftime("%Y-%m-%d")

    n_fields = len(_HOURLY_FIELDS)
    slots: list[list] = [[None] * 24 for _ in range(n_fields)]
    (t_i, feel_i, code_i, hum_i, pprob_i, prec_i,
     wind_i, gust_i, wdir_i, uv_i) = range(n_fields)

    found = 0
    for entry in series:
        try:
            utc = datetime.fromisoformat(entry["time"].replace("Z", "+00:00"))
        except (KeyError, ValueError):
            continue
        local = utc.astimezone(tz)
        if local.strftime("%Y-%m-%d") != target:
            continue
        h = local.hour
        data = entry.get("data") or {}
        inst = ((data.get("instant") or {}).get("details")) or {}
        nxt = data.get("next_1_hours") or data.get("next_6_hours") or {}
        nxt_det = nxt.get("details") or {}
        symbol = ((nxt.get("summary") or {}).get("symbol_code")) or ""

        if "air_temperature" in inst:
            slots[t_i][h] = inst["air_temperature"]
            found += 1
        if "relative_humidity" in inst:
            slots[hum_i][h] = inst["relative_humidity"]
        if "wind_speed" in inst:
            slots[wind_i][h] = round(inst["wind_speed"] * 3.6, 1)   # m/s → km/h
        if "wind_speed_of_gust" in inst:
            slots[gust_i][h] = round(inst["wind_speed_of_gust"] * 3.6, 1)
        if "wind_from_direction" in inst:
            slots[wdir_i][h] = inst["wind_from_direction"]
        if "ultraviolet_index_clear_sky" in inst:
            slots[uv_i][h] = inst["ultraviolet_index_clear_sky"]
        if symbol:
            slots[code_i][h] = _met_symbol_to_wmo(symbol)
        if "precipitation_amount" in nxt_det:
            slots[prec_i][h] = nxt_det["precipitation_amount"]
        if "probability_of_precipitation" in nxt_det:
            slots[pprob_i][h] = nxt_det["probability_of_precipitation"]

    if found == 0:
        return None

    # Fill gaps (MET switches to 6-hourly steps after ~48 h) so the UI's
    # 24-segment bar has no holes: forward-fill, then back-fill the head.
    for arr in slots:
        last = None
        for h in range(24):
            if arr[h] is None:
                arr[h] = last
            else:
                last = arr[h]
        first = next((v for v in arr if v is not None), None)
        for h in range(24):
            if arr[h] is None:
                arr[h] = first

    hourly = {name: slots[i] for i, name in enumerate(_HOURLY_FIELDS)}
    # No apparent-temperature data → empty list so the UI hides the field
    # instead of showing a misleading 0°.
    if all(v is None for v in hourly["apparent_temperature"]):
        hourly["apparent_temperature"] = []
    for key in ("precipitation_probability", "uv_index"):
        if all(v is None for v in hourly[key]):
            hourly[key] = []

    return {"hourly": hourly, "source": "met.no"}


__all__ = ["WeatherError", "get_forecast"]
