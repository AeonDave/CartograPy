"""Tests for projection math and layout helpers in cartograpy.utils."""
import math

import pytest

from cartograpy.utils import (
    auto_grid_spacing,
    compute_sheet_layout,
    deg2num,
    ground_resolution,
    latlon_to_pixel,
    num2deg,
    optimal_zoom,
)


class TestTileConversions:
    def test_deg2num_num2deg_roundtrip(self):
        lat, lon = 45.4642, 9.19  # Milan
        for zoom in (5, 10, 15, 18):
            x, y = deg2num(lat, lon, zoom)
            lat2, lon2 = num2deg(x, y, zoom)
            assert lat2 == pytest.approx(lat, abs=1e-9)
            assert lon2 == pytest.approx(lon, abs=1e-9)

    def test_deg2num_known_values(self):
        # Origin of the tile scheme: lat=85.0511..., lon=-180 → tile (0, 0)
        x, y = deg2num(85.0511287798066, -180.0, 1)
        assert x == pytest.approx(0.0, abs=1e-6)
        assert y == pytest.approx(0.0, abs=1e-6)
        # Equator / Greenwich is the exact centre of the grid
        x, y = deg2num(0.0, 0.0, 1)
        assert x == pytest.approx(1.0)
        assert y == pytest.approx(1.0)

    def test_ground_resolution_equator_z0(self):
        # Whole earth circumference / 256 px at z0
        assert ground_resolution(0.0, 0) == pytest.approx(156543.03, rel=1e-4)

    def test_ground_resolution_shrinks_with_latitude(self):
        assert ground_resolution(60.0, 10) == pytest.approx(
            ground_resolution(0.0, 10) * math.cos(math.radians(60.0)), rel=1e-9
        )


class TestOptimalZoom:
    def test_monotonic_in_scale(self):
        zooms = [optimal_zoom(45.0, s) for s in (5_000, 25_000, 100_000)]
        assert zooms == sorted(zooms, reverse=True)

    def test_zoom_resolution_sufficient(self):
        scale, dpi, lat = 25_000, 300, 45.0
        z = optimal_zoom(lat, scale, dpi)
        target_mpp = scale * 25.4 / (dpi * 1000.0)
        assert ground_resolution(lat, z) <= target_mpp


class TestGridSpacing:
    @pytest.mark.parametrize("scale,expected", [
        (2_500, 100), (10_000, 200), (25_000, 500),
        (50_000, 1_000), (100_000, 2_000), (200_000, 5_000),
    ])
    def test_spacing_table(self, scale, expected):
        assert auto_grid_spacing(scale) == expected


class TestSheetLayout:
    def test_single_sheet(self):
        assert compute_sheet_layout(1, False) == (1, 1)
        assert compute_sheet_layout(0, True) == (1, 1)

    @pytest.mark.parametrize("n", range(2, 21))
    def test_layout_holds_all_sheets(self, n):
        for landscape in (False, True):
            cols, rows = compute_sheet_layout(n, landscape)
            assert cols * rows >= n
            # Near-square: removing a full row/column must not still fit n
            assert (cols - 1) * rows < n or cols * (rows - 1) < n

    def test_orientation_bias(self):
        cols_l, rows_l = compute_sheet_layout(6, True)
        cols_p, rows_p = compute_sheet_layout(6, False)
        assert cols_l >= rows_l
        assert rows_p >= cols_p


class TestLatlonToPixel:
    def test_center_maps_to_image_center(self):
        px, py = latlon_to_pixel(45.0, 9.0, 45.0, 9.0, 10_000, 10_000, 800, 600)
        assert (px, py) == (400, 300)

    def test_north_decreases_y(self):
        _, py = latlon_to_pixel(45.01, 9.0, 45.0, 9.0, 10_000, 10_000, 800, 600)
        assert py < 300

    def test_east_increases_x(self):
        px, _ = latlon_to_pixel(45.0, 9.01, 45.0, 9.0, 10_000, 10_000, 800, 600)
        assert px > 400
