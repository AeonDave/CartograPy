"""GPX import / export.

Parses GPX 1.1 documents into the CartograPy in-memory model and serializes
the in-memory model back to GPX. We deliberately avoid third-party GPX
parsers — the GPX schema is small and the ElementTree based implementation
below covers the constructs CartograPy uses (waypoints, tracks, routes).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from xml.etree import ElementTree as ET

_NS = "http://www.topografix.com/GPX/1/1"
_NSMAP = {"gpx": _NS}

# CartograPy waypoint icon defaults — applied to GPX <wpt> entries that
# don't carry CartograPy-specific extension data.
_DEFAULT_ICON = "fa-location-dot"
_DEFAULT_COLOR = "#dc2626"
_TRACK_COLOR = "#0891b2"


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------

def parse_gpx(text: str) -> dict[str, list]:
    """Parse a GPX document.

    Returns ``{"waypoints": [...], "drawings": [...]}`` where:

    * Each waypoint is ``{lat, lng, name, icon, color}``.
    * Each drawing is a ``{type: "line", name, points: [[lat, lon], ...],
      color}`` entry compatible with the tools store.
    """
    text = text.strip()
    if not text:
        return {"waypoints": [], "drawings": []}

    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise ValueError(f"Invalid GPX document: {exc}") from exc

    # Strip namespace from tag names for easier matching.
    def tag(el: ET.Element) -> str:
        return el.tag.split("}", 1)[-1]

    def text_of(el: ET.Element | None, name: str) -> str | None:
        if el is None:
            return None
        for child in el:
            if tag(child) == name:
                return (child.text or "").strip() or None
        return None

    waypoints: list[dict[str, Any]] = []
    drawings: list[dict[str, Any]] = []

    for el in root:
        t = tag(el)
        if t == "wpt":
            try:
                lat = float(el.attrib["lat"])
                lon = float(el.attrib["lon"])
            except (KeyError, ValueError):
                continue
            waypoints.append({
                "lat": lat,
                "lng": lon,
                "name": text_of(el, "name") or "",
                "icon": _DEFAULT_ICON,
                "color": _DEFAULT_COLOR,
            })

        elif t in ("trk", "rte"):
            name = text_of(el, "name") or ""
            # Each <trk> can contain multiple <trkseg>; each becomes its own
            # drawing so segments stay separate. Routes have <rtept> directly.
            if t == "rte":
                pts = []
                for child in el:
                    if tag(child) == "rtept":
                        try:
                            pts.append([float(child.attrib["lat"]),
                                        float(child.attrib["lon"])])
                        except (KeyError, ValueError):
                            continue
                if len(pts) >= 2:
                    drawings.append({
                        "type": "line",
                        "name": name,
                        "color": _TRACK_COLOR,
                        "points": pts,
                    })
            else:
                segs = [c for c in el if tag(c) == "trkseg"]
                for i, seg in enumerate(segs):
                    pts = []
                    for child in seg:
                        if tag(child) == "trkpt":
                            try:
                                pts.append([float(child.attrib["lat"]),
                                            float(child.attrib["lon"])])
                            except (KeyError, ValueError):
                                continue
                    if len(pts) >= 2:
                        seg_name = name if len(segs) == 1 else f"{name} #{i + 1}".strip()
                        drawings.append({
                            "type": "line",
                            "name": seg_name,
                            "color": _TRACK_COLOR,
                            "points": pts,
                        })

    return {"waypoints": waypoints, "drawings": drawings}


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def serialize_gpx(waypoints: list[dict] | None = None,
                  drawings: list[dict] | None = None,
                  *, creator: str = "CartograPy") -> str:
    """Serialize waypoints and tracks to a GPX 1.1 document."""
    waypoints = waypoints or []
    drawings = drawings or []

    ET.register_namespace("", _NS)
    root = ET.Element(f"{{{_NS}}}gpx", attrib={
        "version": "1.1",
        "creator": creator,
    })
    metadata = ET.SubElement(root, f"{{{_NS}}}metadata")
    name_el = ET.SubElement(metadata, f"{{{_NS}}}name")
    name_el.text = "CartograPy export"
    time_el = ET.SubElement(metadata, f"{{{_NS}}}time")
    time_el.text = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    for wp in waypoints:
        try:
            lat = float(wp.get("lat"))
            lon = float(wp.get("lng", wp.get("lon")))
        except (TypeError, ValueError):
            continue
        wpt = ET.SubElement(root, f"{{{_NS}}}wpt", attrib={
            "lat": _fmt(lat), "lon": _fmt(lon),
        })
        if wp.get("name"):
            n = ET.SubElement(wpt, f"{{{_NS}}}name")
            n.text = str(wp["name"])

    for drw in drawings:
        if drw.get("type") not in {"line", "route"}:
            continue
        pts = drw.get("points") or []
        if len(pts) < 2:
            continue
        trk = ET.SubElement(root, f"{{{_NS}}}trk")
        n = ET.SubElement(trk, f"{{{_NS}}}name")
        n.text = str(drw.get("name") or ("Route" if drw.get("type") == "route" else "Track"))
        seg = ET.SubElement(trk, f"{{{_NS}}}trkseg")
        for p in pts:
            try:
                lat = float(p[0]); lon = float(p[1])
            except (TypeError, ValueError, IndexError):
                continue
            ET.SubElement(seg, f"{{{_NS}}}trkpt", attrib={
                "lat": _fmt(lat), "lon": _fmt(lon),
            })

    ET.indent(root, space="  ")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode")


def _fmt(v: float) -> str:
    """Format a coordinate with sane precision and no trailing zeros."""
    s = f"{v:.7f}".rstrip("0").rstrip(".")
    return s if s else "0"


__all__ = ["parse_gpx", "serialize_gpx"]
