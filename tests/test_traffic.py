"""Tests for live traffic validation and normalization helpers."""
import pytest

from cartograpy.traffic import (
    BoundingBox,
    TrafficConfigError,
    TrafficError,
    _heading_or_none,
    _parse_aishub_time,
    _validate_bbox,
    query_live_traffic,
)


def _bbox(s=45.0, w=9.0, n=45.5, e=9.5):
    return BoundingBox(south=s, west=w, north=n, east=e)


class TestBoundingBox:
    def test_area(self):
        assert _bbox().area_deg2 == pytest.approx(0.25)

    def test_contains(self):
        bb = _bbox()
        assert bb.contains(45.2, 9.2)
        assert not bb.contains(46.0, 9.2)
        assert not bb.contains(None, 9.2)


class TestValidation:
    def test_unknown_provider(self):
        with pytest.raises(TrafficError):
            query_live_traffic("submarine_sonar", _bbox(), {})

    def test_inverted_latitudes(self):
        with pytest.raises(TrafficError):
            _validate_bbox("aircraft_opensky", _bbox(s=46.0, n=45.0))

    def test_empty_bbox(self):
        with pytest.raises(TrafficError):
            _validate_bbox("aircraft_opensky", _bbox(n=45.0, s=45.0))

    def test_too_large_for_vessels(self):
        big = _bbox(s=0.0, w=0.0, n=20.0, e=20.0)  # 400 deg² > 100 cap
        with pytest.raises(TrafficError):
            _validate_bbox("vessel_aishub", big)

    def test_missing_aishub_username(self):
        with pytest.raises(TrafficConfigError):
            query_live_traffic("vessel_aishub", _bbox(), {})

    def test_missing_gtfs_url(self):
        with pytest.raises(TrafficConfigError):
            query_live_traffic("train_gtfsrt", _bbox(), {})


class TestNormalizers:
    def test_heading_wraps_and_rejects_sentinel(self):
        assert _heading_or_none(370.0) == 10.0
        assert _heading_or_none(511) is None      # AIS "not available"
        assert _heading_or_none(-5) is None
        assert _heading_or_none("90") == 90.0
        assert _heading_or_none("") is None

    def test_aishub_time_epoch_and_string(self):
        assert _parse_aishub_time("1700000000") == 1700000000
        assert _parse_aishub_time("2023-11-14 22:13:20 GMT") == 1700000000
        assert _parse_aishub_time("") is None
        assert _parse_aishub_time("yesterday") is None


class TestOpenSkyRowParsing:
    def test_short_row_no_crash(self, monkeypatch):
        """A state vector with exactly 11 fields must not raise IndexError."""
        from cartograpy import traffic as mod
        row = ["abc123", "AZA123 ", "Italy", 1700000000, None,
               9.2, 45.2, 1000.0, False, 200.0, 90.0]
        assert len(row) == 11
        monkeypatch.setattr(mod, "_fetch_json", lambda url: {"states": [row]})
        mod._CACHE.clear()
        out = query_live_traffic("aircraft_opensky", _bbox(), {})
        assert len(out["features"]) == 1
        feat = out["features"][0]
        assert feat["details"]["vertical_rate"] is None
        assert feat["label"] == "AZA123"
