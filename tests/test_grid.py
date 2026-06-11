"""Tests for grid computation and coordinate parsing in cartograpy.grid."""
import pytest

from cartograpy.grid import (
    GRID_SYSTEMS,
    compute_grid,
    parse_coords,
    parse_latlon_auto,
    utm_epsg,
    utm_zone,
)


class TestUtmZone:
    @pytest.mark.parametrize("lon,zone", [
        (-180.0, 1), (-177.0, 1), (9.0, 32), (12.5, 33), (173.9, 59), (174.0, 60),
    ])
    def test_zone_from_longitude(self, lon, zone):
        assert utm_zone(lon) == zone

    def test_epsg_hemispheres(self):
        assert utm_epsg(45.0, 9.0) == 32632   # Milan → 32N
        assert utm_epsg(-34.0, 18.5) == 32734  # Cape Town → 34S


class TestComputeGrid:
    def test_none_returns_none(self):
        assert compute_grid("none", 45.0, 9.0, 5000, 5000, 500) is None

    def test_unknown_returns_none(self):
        assert compute_grid("klingon", 45.0, 9.0, 5000, 5000, 500) is None

    def test_utm_grid_lines_cover_area(self):
        gi = compute_grid("utm", 45.0, 9.0, 5000, 5000, 1000)
        assert gi.system == "utm"
        assert gi.zone == "32N"
        assert gi.epsg == 32632
        v = [l for l in gi.lines if l.direction == "v"]
        h = [l for l in gi.lines if l.direction == "h"]
        # 5 km span + 1 spacing margin each side → at least 6 lines per axis
        assert len(v) >= 6 and len(h) >= 6

    def test_utm_full_values_are_round_multiples(self):
        gi = compute_grid("utm", 45.0, 9.0, 5000, 5000, 1000)
        for line in gi.lines:
            assert line.full_value % 1000 == 0

    def test_full_labels_are_plain_metres(self):
        gi = compute_grid("utm", 45.0, 9.0, 5000, 5000, 1000, full_labels=True)
        for line in gi.lines:
            assert line.label == str(int(round(line.full_value)))

    def test_legacy_dm_alias_maps_to_latlon(self):
        gi = compute_grid("latlon_dm", 45.0, 9.0, 5000, 5000, 500, scale=25_000)
        assert gi.system == "latlon_dd"

    def test_every_declared_system_computes(self):
        # Use a centre inside each grid's natural region where relevant.
        centres = {
            "gauss_boaga": (45.0, 9.0), "swiss": (46.8, 8.2),
            "bng": (51.5, -0.1), "dutch": (52.1, 5.3),
            "gauss_krueger": (50.0, 8.6), "irish_ig": (53.3, -6.3),
            "irish_itm": (53.3, -6.3), "eov": (47.5, 19.0),
            "kkj": (60.2, 25.0), "nztm": (-41.3, 174.8),
            "sweref99": (59.3, 18.1), "rt90": (59.3, 18.1),
            "south_african": (-33.9, 29.0), "taiwan": (25.0, 121.5),
            "qng": (25.3, 51.5), "utm": (45.0, 9.0),
            "mgrs": (45.0, 9.0), "latlon": (45.0, 9.0),
        }
        for key in GRID_SYSTEMS:
            if key == "none":
                continue
            lat, lon = centres[key]
            gi = compute_grid(key, lat, lon, 5000, 5000, 1000, scale=25_000)
            assert gi is not None, key
            assert gi.lines, key


class TestParseLatlonAuto:
    def test_decimal_pair(self):
        assert parse_latlon_auto("45.5, 9.25") == (45.5, 9.25)

    def test_dms(self):
        lat, lon = parse_latlon_auto("45°30'00\"N 9°15'00\"E")
        assert lat == pytest.approx(45.5)
        assert lon == pytest.approx(9.25)

    def test_dm(self):
        lat, lon = parse_latlon_auto("45°30.0' N 9°15.0' E")
        assert lat == pytest.approx(45.5)
        assert lon == pytest.approx(9.25)

    def test_southern_western_hemisphere(self):
        lat, lon = parse_latlon_auto("33°55'S 18°25'W")
        assert lat == pytest.approx(-33.9166, abs=1e-3)
        assert lon == pytest.approx(-18.4166, abs=1e-3)

    def test_garbage_raises(self):
        with pytest.raises(ValueError):
            parse_latlon_auto("not a coordinate")


class TestParseCoords:
    def test_utm_roundtrip(self):
        # Duomo di Milano ≈ 45.4642N 9.19E → UTM 32T 514815 5034000 (approx)
        lat, lon = parse_coords("utm", "32T 514815 5034556")
        assert lat == pytest.approx(45.4642, abs=2e-3)
        assert lon == pytest.approx(9.19, abs=2e-3)

    def test_utm_southern_band(self):
        # Band C..M → southern hemisphere EPSG
        lat, _ = parse_coords("utm", "34H 261878 6243186")
        assert lat < 0

    def test_utm_bad_format_raises(self):
        with pytest.raises(ValueError):
            parse_coords("utm", "514815 5034556")  # missing zone/band

    def test_gauss_boaga_west_zone(self):
        # E < 2 520 000 → EPSG 3003 (west)
        lat, lon = parse_coords("gauss_boaga", "1514000 5034000")
        assert lat == pytest.approx(45.46, abs=0.05)
        assert lon == pytest.approx(9.18, abs=0.05)

    def test_projected_grid_swiss(self):
        # Bern ≈ LV95 2600000, 1200000
        lat, lon = parse_coords("swiss", "2600000 1200000")
        assert lat == pytest.approx(46.95, abs=0.01)
        assert lon == pytest.approx(7.44, abs=0.01)

    def test_default_falls_back_to_latlon(self):
        assert parse_coords("latlon", "45.5 9.25") == (45.5, 9.25)
