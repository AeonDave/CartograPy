"""Tests for GPX import/export round-tripping."""
import pytest

from cartograpy.gpx import parse_gpx, serialize_gpx

_SAMPLE = """<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test">
  <wpt lat="45.5" lon="9.25"><name>Cima &amp; Rifugio</name></wpt>
  <wpt lat="bad" lon="9.0"><name>broken</name></wpt>
  <rte><name>R1</name>
    <rtept lat="45.0" lon="9.0"/><rtept lat="45.1" lon="9.1"/>
  </rte>
  <trk><name>T1</name>
    <trkseg><trkpt lat="44.0" lon="8.0"/><trkpt lat="44.1" lon="8.1"/></trkseg>
    <trkseg><trkpt lat="44.2" lon="8.2"/><trkpt lat="44.3" lon="8.3"/></trkseg>
  </trk>
</gpx>"""


class TestParse:
    def test_waypoints_and_invalid_skipped(self):
        out = parse_gpx(_SAMPLE)
        assert len(out["waypoints"]) == 1
        wp = out["waypoints"][0]
        assert wp["lat"] == 45.5 and wp["lng"] == 9.25
        assert wp["name"] == "Cima & Rifugio"

    def test_route_and_track_segments(self):
        out = parse_gpx(_SAMPLE)
        names = [d["name"] for d in out["drawings"]]
        assert "R1" in names
        # Two trksegs become two separate drawings, numbered
        assert "T1 #1" in names and "T1 #2" in names
        for d in out["drawings"]:
            assert d["type"] == "line"
            assert len(d["points"]) >= 2

    def test_empty_input(self):
        assert parse_gpx("") == {"waypoints": [], "drawings": []}

    def test_invalid_xml_raises(self):
        with pytest.raises(ValueError):
            parse_gpx("<gpx><unclosed></gpx")


class TestRoundTrip:
    def test_serialize_then_parse(self):
        wps = [{"lat": 45.5, "lng": 9.25, "name": "Cima <X>"}]
        drawings = [{"type": "line", "name": "Sentiero",
                     "points": [[45.0, 9.0], [45.1, 9.1]]}]
        xml = serialize_gpx(wps, drawings)
        out = parse_gpx(xml)
        assert out["waypoints"][0]["name"] == "Cima <X>"
        assert out["waypoints"][0]["lat"] == 45.5
        assert out["drawings"][0]["points"] == [[45.0, 9.0], [45.1, 9.1]]

    def test_skips_malformed_entries(self):
        xml = serialize_gpx(
            [{"lat": "nope", "lng": 9.0}],
            [{"type": "line", "points": [[45.0, 9.0]]},   # < 2 points
             {"type": "protractor", "points": [[1, 2], [3, 4]]}],  # wrong type
        )
        out = parse_gpx(xml)
        assert out["waypoints"] == []
        assert out["drawings"] == []
