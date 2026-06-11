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
