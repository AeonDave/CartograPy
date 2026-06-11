"""Tests for the theme system: registry, routing, traversal safety."""
import json
import threading
import urllib.request
import urllib.error

import pytest

from cartograpy.server import create_server, get_active_theme, list_themes


@pytest.fixture(scope="module")
def server_url():
    server, _ = create_server(host="127.0.0.1", port=0)
    port = server.server_address[1]
    url = f"http://127.0.0.1:{port}"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield url
    server.shutdown()
    server.server_close()


def _get(url):
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            return resp.status, resp.read(), dict(resp.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), dict(exc.headers)


class TestRegistry:
    def test_builtin_themes_discovered(self):
        ids = {t["id"] for t in list_themes()}
        assert {"classic", "tactical"} <= ids

    def test_metadata_fields(self):
        for t in list_themes():
            assert t["id"] and t["name"]
            assert set(t) == {"id", "name", "description", "version", "author"}

    def test_active_theme_is_valid(self):
        assert get_active_theme() in {t["id"] for t in list_themes()}


class TestRouting:
    def test_api_themes(self, server_url):
        code, body, _ = _get(f"{server_url}/api/themes")
        assert code == 200
        data = json.loads(body)
        ids = {t["id"] for t in data["themes"]}
        assert "classic" in ids and "tactical" in ids
        assert data["active"] in ids

    def test_root_serves_active_theme_index(self, server_url):
        code, body, headers = _get(f"{server_url}/")
        assert code == 200
        assert b"/theme/style.css" in body
        assert b'id="map"' in body
        assert "no-cache" in headers.get("Cache-Control", "")

    def test_theme_stylesheet_served(self, server_url):
        code, body, headers = _get(f"{server_url}/theme/style.css")
        assert code == 200
        assert headers["Content-Type"].startswith("text/css")
        assert len(body) > 1000

    def test_unknown_asset_404(self, server_url):
        code, _, _ = _get(f"{server_url}/theme/nope.css")
        assert code == 404

    def test_extension_whitelist(self, server_url):
        code, _, _ = _get(f"{server_url}/theme/theme.json.bak")
        assert code == 404

    def test_path_traversal_blocked(self, server_url):
        # "../<other-theme>/..." must not escape the ACTIVE theme directory;
        # "../../*.py" must never reach the source tree.
        other = "tactical" if get_active_theme() != "tactical" else "classic"
        for evil in ("../../server.py", "..%2F..%2Fserver.py",
                     f"../{other}/theme.json", f"..%2F{other}%2Ftheme.json"):
            code, body, _ = _get(f"{server_url}/theme/{evil}")
            assert code == 404, evil
            assert b"BaseHTTPRequestHandler" not in body


class TestContract:
    """Every theme must ship the DOM ids the engine hard-requires."""

    REQUIRED_IDS = [
        "map", "sidebar", "toggleSidebar", "closeSidebar", "sidebarBackdrop",
        "status", "mobileToolBar", "mtbDone", "mtbUndo", "mtbCancel",
        "language", "theme", "scale", "paper", "sheets", "landscape",
        "source", "dpi", "mapTextScale", "bearing", "chkMagBadge",
        "btnExport", "search", "btnSearch", "searchSuggestions", "results",
        "resultsList", "historySection", "histList", "gridType", "gridScale",
        "fullLabels", "gridScaleGroup", "fullLabelsGroup", "overlayList",
        "overlayMsg", "chkTrafficAircraft", "chkTrafficVessels",
        "chkTrafficTrains", "trafficAircraftProvider", "trafficVesselProvider",
        "trafficTrainProvider", "trafficRefreshSec", "trafficMsg",
        "owmApiKey", "owmKeyInput", "owmKeyField", "owmKeyConfirm",
        "owmKeyError", "owmKeyBadge", "owmKeyDelete", "aishubUsername",
        "gtfsRealtimeUrl", "btnRuler", "btnProtractor", "btnLine",
        "btnCompass", "btnRoute", "btnLineUndo", "rulerInfo", "rulerResult",
        "protractorInfo", "protractorResult", "lineInfo", "lineResult",
        "compassInfo", "compassResult", "routeInfo", "routeResult",
        "routeProfile", "routeDraftPoints", "btnRouteDone", "btnRouteCancel",
        "rulerHistory", "protractorHistory", "lineHistory", "compassHistory",
        "routeHistory", "toolHistorySep", "chkSnapWp", "chkSnapPeaks",
        "chkSnapTrails", "chkToolsInPdf", "btnToolSave", "btnToolLoad",
        "btnToolClearAll", "toolFilePanel", "toolSavePanel", "toolFileName",
        "btnToolSaveConfirm", "toolLoadPanel", "toolFileList",
        "waypointSection", "btnWpAddOnMap", "iconGrid", "colorGrid",
        "wpDatumLabel", "wpCoordInput", "btnWpAdd", "wpBulkInput",
        "btnWpBulk", "wpList", "btnWpClearAll", "btnWpSave", "btnWpLoad",
        "wpFilePanel", "wpSavePanel", "wpFileName", "btnWpSaveConfirm",
        "wpLoadPanel", "wpFileList", "weatherCard", "weatherClose",
        "weatherDate", "weatherNow", "weatherIcon", "weatherTemp",
        "weatherFeelsLike", "weatherLabel", "weatherStats", "weatherBar",
        "weatherNowIndicator", "weatherHourIndicator", "weatherLegend",
    ]

    @pytest.mark.parametrize("theme", [t["id"] for t in list_themes()])
    def test_theme_provides_all_required_ids(self, theme):
        from pathlib import Path
        html = (Path(__file__).resolve().parent.parent
                / "cartograpy" / "themes" / theme / "index.html").read_text("utf-8")
        missing = [i for i in self.REQUIRED_IDS if f'id="{i}"' not in html]
        assert not missing, f"theme '{theme}' missing ids: {missing}"

    @pytest.mark.parametrize("theme", [t["id"] for t in list_themes()])
    def test_waypoint_section_is_details(self, theme):
        from pathlib import Path
        html = (Path(__file__).resolve().parent.parent
                / "cartograpy" / "themes" / theme / "index.html").read_text("utf-8")
        import re
        m = re.search(r"<(\w+)[^>]*id=\"waypointSection\"", html)
        assert m and m.group(1) == "details"

    @pytest.mark.parametrize("theme", [t["id"] for t in list_themes()])
    def test_app_js_loaded(self, theme):
        from pathlib import Path
        html = (Path(__file__).resolve().parent.parent
                / "cartograpy" / "themes" / theme / "index.html").read_text("utf-8")
        assert 'src="/app.js"' in html
