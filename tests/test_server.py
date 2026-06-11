"""Integration tests for the HTTP server: caps, CSRF/host protection."""
import json
import threading
import urllib.request
import urllib.error

import pytest

from cartograpy.server import create_server


@pytest.fixture(scope="module")
def server_url():
    server, url = create_server(host="127.0.0.1", port=0)
    port = server.server_address[1]
    url = f"http://127.0.0.1:{port}"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield url
    server.shutdown()
    server.server_close()


def _get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def _post(url, payload, headers=None):
    body = json.dumps(payload).encode()
    hdrs = {"Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(url, data=body, headers=hdrs, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


class TestHostOriginProtection:
    def test_normal_get_allowed(self, server_url):
        code, body = _get(f"{server_url}/api/constants")
        assert code == 200
        assert b"grid_systems" in body

    def test_rebound_host_rejected(self, server_url):
        code, _ = _get(f"{server_url}/api/constants",
                       headers={"Host": "evil.example.com"})
        assert code == 403

    def test_cross_origin_post_rejected(self, server_url):
        code, _ = _post(f"{server_url}/api/config", {"scale": 25000},
                        headers={"Origin": "https://evil.example.com"})
        assert code == 403

    def test_same_origin_post_allowed(self, server_url):
        code, _ = _post(f"{server_url}/api/gpx/import", {"text": " "},
                        headers={"Origin": server_url})
        # 400 (empty text) proves it passed the origin gate
        assert code == 400


class TestParameterCaps:
    def test_grid_sheets_capped(self, server_url):
        code, body = _get(
            f"{server_url}/api/grid?lat=45&lon=9&scale=25000&sheets=9999&grid_type=utm")
        assert code == 200
        data = json.loads(body)
        # 20-sheet cap → ground extent stays bounded (< 60 km at 1:25000 A4)
        assert data["ground_w"] < 60_000

    def test_export_rejects_unknown_paper(self, server_url):
        code, body = _post(f"{server_url}/api/export",
                           {"lat": 45, "lon": 9, "scale": 25000, "paper": "A9"})
        assert code == 400
        assert b"paper" in body

    def test_export_rejects_unknown_source(self, server_url):
        code, body = _post(f"{server_url}/api/export",
                           {"lat": 45, "lon": 9, "scale": 25000,
                            "source": "EvilTiles"})
        assert code == 400
        assert b"source" in body

    def test_invalid_json_is_400(self, server_url):
        req = urllib.request.Request(
            f"{server_url}/api/config", data=b"{not json",
            headers={"Content-Type": "application/json"}, method="POST")
        with pytest.raises(urllib.error.HTTPError) as exc:
            urllib.request.urlopen(req, timeout=10)
        assert exc.value.code == 400


class TestFileEndpoints:
    def test_wp_save_sanitizes_name(self, server_url):
        code, body = _post(f"{server_url}/api/waypoints/save",
                           {"name": "../../etc/passwd", "waypoints": []})
        assert code == 200
        safe = json.loads(body)["name"]
        assert "/" not in safe and ".." not in safe
        # cleanup
        _post(f"{server_url}/api/waypoints/delete", {"name": safe})

    def test_wp_load_missing_is_404(self, server_url):
        code, _ = _get(f"{server_url}/api/waypoints/load?name=__nope__")
        assert code == 404


class TestWeatherProxy:
    """Weather proxy: TTL cache, MET Norway fallback, no-retry on 429.

    Uses requests as HTTP client because urllib.request.urlopen is
    monkeypatched server-side.
    """

    @staticmethod
    def _fake_resp(body: bytes):
        class _R:
            def read(self):
                return body
            def __enter__(self):
                return self
            def __exit__(self, *a):
                return False
        return _R()

    def test_upstream_called_once_then_cached(self, server_url, monkeypatch):
        import requests
        from cartograpy import weather as wx

        calls = {"n": 0}

        def fake_urlopen(req, timeout=0):
            calls["n"] += 1
            return self._fake_resp(b'{"hourly": {"temperature_2m": [1, 2, 3]}}')

        monkeypatch.setattr(wx.urllib.request, "urlopen", fake_urlopen)
        wx._CACHE.clear()

        r1 = requests.get(f"{server_url}/api/weather?lat=44.1&lon=7.1", timeout=10)
        r2 = requests.get(f"{server_url}/api/weather?lat=44.1004&lon=7.1004", timeout=10)
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["hourly"]["temperature_2m"] == [1, 2, 3]
        assert r1.json()["source"] == "open-meteo"
        assert calls["n"] == 1  # second request served from cache (~1 km cell)

    def test_429_falls_back_to_met_no(self, server_url, monkeypatch):
        import io
        import json as _json
        import requests
        import urllib.error
        from cartograpy import weather as wx

        calls = {"om": 0, "met": 0}
        met_payload = {
            "properties": {"timeseries": [
                {
                    "time": "2099-01-01T11:00:00Z",
                    "data": {
                        "instant": {"details": {
                            "air_temperature": 5.0, "relative_humidity": 80.0,
                            "wind_speed": 2.0, "wind_from_direction": 180.0,
                        }},
                        "next_1_hours": {
                            "summary": {"symbol_code": "snow"},
                            "details": {"precipitation_amount": 0.4},
                        },
                    },
                },
            ]},
        }

        def fake_urlopen(req, timeout=0):
            if "open-meteo" in req.full_url:
                calls["om"] += 1
                raise urllib.error.HTTPError(
                    req.full_url, 429, "Too Many", {}, io.BytesIO(b""))
            calls["met"] += 1
            return self._fake_resp(_json.dumps(met_payload).encode())

        monkeypatch.setattr(wx.urllib.request, "urlopen", fake_urlopen)
        wx._CACHE.clear()

        r = requests.get(
            f"{server_url}/api/weather?lat=44.2&lon=7.2&date=2099-01-01",
            timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert data["source"] == "met.no"
        assert calls["om"] == 1      # 429 is not retried
        assert calls["met"] == 1
        hourly = data["hourly"]
        assert len(hourly["temperature_2m"]) == 24
        # 11:00 UTC at lon 7.2 → UTC+0 ... +1; value present and gap-filled
        assert 5.0 in hourly["temperature_2m"]
        assert all(v == 5.0 for v in hourly["temperature_2m"])  # fills
        assert 73 in hourly["weathercode"]                      # snow → WMO 73
        assert hourly["windspeed_10m"][12] == 7.2               # 2 m/s → km/h
        assert hourly["apparent_temperature"] == []             # not provided

    def test_both_providers_down_is_502(self, server_url, monkeypatch):
        import requests
        from cartograpy import weather as wx

        def fake_urlopen(req, timeout=0):
            raise TimeoutError("dead")

        monkeypatch.setattr(wx.urllib.request, "urlopen", fake_urlopen)
        wx._CACHE.clear()

        r = requests.get(f"{server_url}/api/weather?lat=44.3&lon=7.3", timeout=10)
        assert r.status_code == 502
        assert "unavailable" in r.json()["error"]
