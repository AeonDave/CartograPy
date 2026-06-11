"""Tests for PDF export helpers and the zoom-selection fix."""
import pytest

from cartograpy.export import _hex_to_rgb, _nice_round
from cartograpy.tiles import TILE_SOURCES, _placeholder


class TestNiceRound:
    @pytest.mark.parametrize("value,expected", [
        (1750.0, 1000.0), (437.0, 200.0), (99.0, 50.0),
        (5000.0, 5000.0), (0.0, 1.0), (-3.0, 1.0),
    ])
    def test_nice_values(self, value, expected):
        assert _nice_round(value) == expected


class TestHexToRgb:
    def test_valid(self):
        assert _hex_to_rgb("#ff0080") == (255, 0, 128)
        assert _hex_to_rgb("00ff00") == (0, 255, 0)

    def test_invalid_falls_back(self):
        assert _hex_to_rgb("#abc") == (220, 38, 38)
        assert _hex_to_rgb("") == (220, 38, 38)


class TestZoomClamp:
    def test_zoom_never_exceeds_source_max(self):
        """Replicates export_map_pdf's zoom choice for a low-max-zoom source."""
        from cartograpy.utils import ground_resolution

        source_name = "GEBCO"  # max_zoom 9
        scale, dpi, map_text_scale, lat = 10_000, 300, 50, 45.0
        target_mpp = 0.21 * scale / 25_000  # arbitrary fine resolution
        effective_mpp = target_mpp * (map_text_scale / 25.0 * 1.5)

        source_max_z = min(18, int(TILE_SOURCES.get(source_name, {}).get("max_zoom", 18)))
        best_z = source_max_z
        for z in range(1, source_max_z + 1):
            if ground_resolution(lat, z) <= effective_mpp:
                best_z = z
                break
        assert best_z <= 9


class TestPlaceholder:
    def test_placeholder_is_flagged(self):
        img = _placeholder()
        assert img.info.get("placeholder") is True

    def test_placeholder_not_memory_cached(self, tmp_path, monkeypatch):
        from cartograpy.tiles import TileCache

        tc = TileCache(cache_dir=tmp_path)
        monkeypatch.setattr(tc, "_download_xyz",
                            lambda *a, **k: (_ for _ in ()).throw(IOError("net down")))
        img = tc.get_tile("OpenStreetMap", 10, 1, 2)
        assert img.info.get("placeholder") is True
        assert not tc._mem            # failure must not be cached
        assert not list(tmp_path.rglob("*.png"))  # nor written to disk
