"""Generate a print-ready PDF at mathematically correct physical scale.

The key guarantee: on the printed page, 1 mm measured with a ruler
corresponds to exactly ``scale / 1000`` metres on the ground.

Approach
--------
1. Compute the ground area covered by the printable region of the page.
2. Download tiles at the best resolution for that ground/pixel ratio.
3. Resample the tile composite to *exactly* the right number of pixels
   so that ``pixel_count * (25.4 / dpi)`` mm × ``scale`` = ground metres.
4. Overlay the UTM grid and decorations.
5. Save as PDF with the resolution tag set to *dpi* — the PDF reader
   and printer driver honour that tag for 1:1 output.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Allow large composites for high-DPI / large-paper exports
Image.MAX_IMAGE_PIXELS = 400_000_000

from .grid import GRID_SYSTEMS, compute_grid
from .geomag import compute_geomag
from .utils import (
    PAPER_SIZES,
    TILE_SIZE,
    auto_grid_spacing,
    compute_sheet_layout,
    deg2num,
    ground_resolution,
    latlon_to_pixel,
    num2deg,
)


# ---------------------------------------------------------------------------
# Font helper
# ---------------------------------------------------------------------------

def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for name in ("arial.ttf", "Arial.ttf",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                 "/usr/share/fonts/TTF/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def export_map_pdf(
    tile_cache,
    source_name: str,
    center_lat: float,
    center_lon: float,
    scale: int,
    paper: str = "A4",
    landscape: bool = False,
    dpi: int = 300,
    output: str | Path = "map.pdf",
    grid_type: str = "utm",
    grid_spacing: int | None = None,
    grid_full_labels: bool = False,
    grid_scale: int = 50,
    show_grid: bool = True,
    map_text_scale: int = 50,
    sheets: int = 1,
    waypoints: list | None = None,
    drawings: list | None = None,
    margins_mm: int = 10,
    progress_cb=None,
) -> Path:
    """Render and save the map.  Returns the output path.

    Parameters
    ----------
    sheets : number of physical sheets; >1 produces a multi-page PDF.
    progress_cb : optional callable(message: str) for status updates.
    """
    output = Path(output)

    def _status(msg: str) -> None:
        if progress_cb:
            progress_cb(msg)

    sheets = max(1, sheets)

    # ---- sheet layout ----------------------------------------------------
    cols, rows = compute_sheet_layout(sheets, landscape)

    # ---- per-sheet geometry ----------------------------------------------
    pw_mm, ph_mm = PAPER_SIZES[paper]
    if landscape:
        pw_mm, ph_mm = ph_mm, pw_mm

    map_w_mm = pw_mm - 2 * margins_mm
    map_h_mm = ph_mm - 2 * margins_mm - 20  # 20 mm reserved for legend

    ground_w_m = map_w_mm * scale / 1000.0
    ground_h_m = map_h_mm * scale / 1000.0

    img_w = int(round(map_w_mm / 25.4 * dpi))
    img_h = int(round(map_h_mm / 25.4 * dpi))

    overlap_mm = 10
    step_w_m = (map_w_mm - overlap_mm) * scale / 1000.0
    step_h_m = (map_h_mm - overlap_mm) * scale / 1000.0

    # Total ground area covered by the full sheet matrix
    total_ground_w = ground_w_m + (cols - 1) * step_w_m
    total_ground_h = ground_h_m + (rows - 1) * step_h_m

    target_mpp = ground_w_m / img_w  # metres-per-pixel we need

    # ---- choose zoom & download tiles ------------------------------------
    _ts = max(1, min(100, map_text_scale))
    text_factor = _ts / 25.0 * 1.5
    effective_mpp = target_mpp * text_factor

    best_z = 18
    for z in range(1, 19):
        if ground_resolution(center_lat, z) <= effective_mpp:
            best_z = z
            break

    tile_mpp = ground_resolution(center_lat, best_z)

    # Download tiles for the *total* multi-sheet area
    total_tile_px_w = total_ground_w / tile_mpp
    total_tile_px_h = total_ground_h / tile_mpp

    cx, cy = deg2num(center_lat, center_lon, best_z)
    half_tx = total_tile_px_w / TILE_SIZE / 2.0
    half_ty = total_tile_px_h / TILE_SIZE / 2.0

    tx_min = int(math.floor(cx - half_tx)) - 1
    tx_max = int(math.ceil(cx + half_tx)) + 1
    ty_min = int(math.floor(cy - half_ty)) - 1
    ty_max = int(math.ceil(cy + half_ty)) + 1

    _status(f"Download tile z={best_z} ({tx_max-tx_min+1}×{ty_max-ty_min+1})…")
    composite = tile_cache.get_area(source_name, best_z, tx_min, ty_min, tx_max, ty_max)

    # ---- grid computation (for the whole area) ---------------------------
    if grid_spacing is None:
        grid_spacing = auto_grid_spacing(scale)

    grid_info = None
    if show_grid and grid_type != "none":
        _status(f"Computing {GRID_SYSTEMS.get(grid_type, grid_type)} grid…")
        grid_info = compute_grid(grid_type, center_lat, center_lon,
                                 total_ground_w, total_ground_h, grid_spacing,
                                 scale, full_labels=grid_full_labels)

    # ---- magnetic declination + grid convergence -------------------------
    geomag_epsg = grid_info.epsg if grid_info else None
    geomag = compute_geomag(center_lat, center_lon, geomag_epsg)

    # ---- page constants --------------------------------------------------
    page_w = int(round(pw_mm / 25.4 * dpi))
    page_h = int(round(ph_mm / 25.4 * dpi))
    margin_px = int(round(margins_mm / 25.4 * dpi))
    overlap_px = int(round(overlap_mm / 25.4 * dpi * (img_w / (map_w_mm / 25.4 * dpi))))
    # overlap in image pixels: overlap_mm maps to this many pixels in map image
    ovlp_img_px_w = int(round(overlap_mm / map_w_mm * img_w))
    ovlp_img_px_h = int(round(overlap_mm / map_h_mm * img_h))

    # ---- grid drawing params  ------------------------------------------
    _gs = max(1, min(100, grid_scale)) / 50.0
    base_font_px = max(16, dpi * 9 // 72)
    scaled_font_px = max(10, int(base_font_px * _gs))
    label_font = _font(scaled_font_px)
    grid_color = (0, 40, 200)
    line_w = max(1, int(max(2, dpi // 100) * _gs))

    # Origin of tile composite in pixel space
    ox = (cx - tx_min) * TILE_SIZE
    oy = (cy - ty_min) * TILE_SIZE

    # ---- build each page ------------------------------------------------
    pages: list[Image.Image] = []
    sheet_idx = 0
    cos_lat = math.cos(math.radians(center_lat))

    for r in range(rows):
        for c in range(cols):
            if sheet_idx >= sheets:
                break
            sheet_idx += 1
            _status(f"Composing sheet {sheet_idx}/{sheets}…")

            # Sheet centre offset from map centre (in metres)
            off_x_m = (c - (cols - 1) / 2.0) * step_w_m
            off_y_m = (r - (rows - 1) / 2.0) * step_h_m

            sheet_lat = center_lat - off_y_m / 111320.0
            sheet_lon = center_lon + off_x_m / (111320.0 * cos_lat)

            # Crop from composite: find pixel center of this sheet
            sheet_tile_cx = ox + off_x_m / tile_mpp
            sheet_tile_cy = oy + off_y_m / tile_mpp
            sheet_tile_pw = ground_w_m / tile_mpp
            sheet_tile_ph = ground_h_m / tile_mpp

            s_left = int(sheet_tile_cx - sheet_tile_pw / 2)
            s_top = int(sheet_tile_cy - sheet_tile_ph / 2)
            s_right = int(sheet_tile_cx + sheet_tile_pw / 2)
            s_bottom = int(sheet_tile_cy + sheet_tile_ph / 2)

            cropped = composite.crop((s_left, s_top, s_right, s_bottom))
            map_img = cropped.resize((img_w, img_h), Image.LANCZOS)

            # ---- draw grid on this sheet ---------------------------------
            if grid_info is not None and grid_info.lines:
                draw = ImageDraw.Draw(map_img)
                for gl in grid_info.lines:
                    px1, py1 = latlon_to_pixel(gl.lat1, gl.lon1, sheet_lat, sheet_lon,
                                               ground_w_m, ground_h_m, img_w, img_h)
                    px2, py2 = latlon_to_pixel(gl.lat2, gl.lon2, sheet_lat, sheet_lon,
                                               ground_w_m, ground_h_m, img_w, img_h)
                    if not _outside(px1, py1, px2, py2, img_w, img_h):
                        draw.line([(px1, py1), (px2, py2)], fill=grid_color, width=line_w)
                        pad = max(4, int(2 / 25.4 * dpi))
                        rpad = max(60, int(max(20, 20 * _gs) / 25.4 * dpi))
                        bpad = max(20, int(max(6, 6 * _gs) / 25.4 * dpi))
                        if gl.direction == "v":
                            lx = _clamp(px1, pad, img_w - rpad)
                            draw.text((lx, pad), gl.label, fill=grid_color, font=label_font)
                            draw.text((lx, img_h - bpad), gl.label, fill=grid_color, font=label_font)
                        else:
                            ly = _clamp(py1, pad, img_h - bpad)
                            draw.text((pad, ly), gl.label, fill=grid_color, font=label_font)
                            draw.text((img_w - rpad, ly), gl.label, fill=grid_color, font=label_font)

            # ---- waypoints on this sheet ---------------------------------
            if waypoints:
                draw_wp = ImageDraw.Draw(map_img)
                wp_size = max(12, dpi * 12 // 72)
                for wp in waypoints:
                    wp_lat = float(wp.get("lat", 0))
                    wp_lng = float(wp.get("lng", 0))
                    px, py = latlon_to_pixel(wp_lat, wp_lng, sheet_lat, sheet_lon,
                                             ground_w_m, ground_h_m, img_w, img_h)
                    if 0 <= px < img_w and 0 <= py < img_h:
                        color_str = wp.get("color", "#dc2626")
                        color = _hex_to_rgb(color_str)
                        rr = wp_size // 2
                        draw_wp.ellipse([px - rr, py - rr, px + rr, py + rr],
                                        fill=color, outline=(255, 255, 255), width=max(1, rr // 4))
                        ir = max(2, rr // 3)
                        draw_wp.ellipse([px - ir, py - ir, px + ir, py + ir],
                                        fill=(255, 255, 255))
                        wp_name = wp.get("name", "")
                        if wp_name:
                            wp_font = _font(max(12, dpi * 8 // 72))
                            bbox = draw_wp.textbbox((0, 0), wp_name, font=wp_font)
                            tw = bbox[2] - bbox[0]
                            draw_wp.text((px - tw // 2, py + rr + max(2, dpi // 150)),
                                         wp_name, fill=color, font=wp_font)

            # ---- tool drawings on this sheet -----------------------------
            if drawings:
                _draw_tools(ImageDraw.Draw(map_img), drawings,
                            sheet_lat, sheet_lon, ground_w_m, ground_h_m,
                            img_w, img_h, dpi)

            # ---- compose page --------------------------------------------
            page = Image.new("RGB", (page_w, page_h), (255, 255, 255))
            page.paste(map_img, (margin_px, margin_px))

            dp = ImageDraw.Draw(page)
            dp.rectangle(
                [margin_px - 1, margin_px - 1,
                 margin_px + img_w, margin_px + img_h],
                outline=(0, 0, 0), width=max(2, dpi // 150),
            )

            # ---- overlap indicator lines ---------------------------------
            if sheets > 1:
                ovlp_color = (160, 160, 160)
                ovlp_w = max(1, dpi // 300)
                ovlp_dash = int(4 / 25.4 * dpi)  # ~4mm dash
                # left edge has overlap if c > 0
                if c > 0:
                    x_line = margin_px + ovlp_img_px_w
                    _draw_dashed_vline(dp, x_line, margin_px, margin_px + img_h, ovlp_color, ovlp_w, ovlp_dash)
                # right edge has overlap if c < cols-1 and next sheet exists
                if c < cols - 1 and (r * cols + c + 1) < sheets:
                    x_line = margin_px + img_w - ovlp_img_px_w
                    _draw_dashed_vline(dp, x_line, margin_px, margin_px + img_h, ovlp_color, ovlp_w, ovlp_dash)
                # top edge has overlap if r > 0
                if r > 0:
                    y_line = margin_px + ovlp_img_px_h
                    _draw_dashed_hline(dp, y_line, margin_px, margin_px + img_w, ovlp_color, ovlp_w, ovlp_dash)
                # bottom edge has overlap if r < rows-1 and a sheet exists below
                if r < rows - 1 and ((r + 1) * cols + c) < sheets:
                    y_line = margin_px + img_h - ovlp_img_px_h
                    _draw_dashed_hline(dp, y_line, margin_px, margin_px + img_w, ovlp_color, ovlp_w, ovlp_dash)

            # ---- bottom area: legend OR sheet info -----------------------
            legend_y = margin_px + img_h + int(5 / 25.4 * dpi)
            is_last = (sheet_idx == sheets)

            if is_last:
                # Full legend on the last page
                _draw_scale_bar(dp, margin_px, legend_y, scale, dpi)
                info_right = page_w - margin_px
                if sheets > 1:
                    info_right -= int(35 / 25.4 * dpi)
                _draw_info(dp, margin_px + int(80 / 25.4 * dpi), legend_y,
                           scale, center_lat, center_lon, grid_info, source_name,
                           geomag, dpi, info_right)

            if sheets > 1:
                # Sheet number
                info_font = _font(max(14, dpi * 9 // 72))
                sheet_label = f"Sheet {sheet_idx} / {sheets}"
                if is_last:
                    # Place sheet label in the reserved right strip so it
                    # does not collide with the two-column legend text.
                    sx = page_w - margin_px - int(34 / 25.4 * dpi)
                else:
                    sx = margin_px
                dp.text((sx, legend_y), sheet_label, fill=(0, 0, 0), font=info_font)

                if not is_last:
                    # Scale label on non-last pages too
                    small_font = _font(max(12, dpi * 7 // 72))
                    dp.text((sx, legend_y + int(5 / 25.4 * dpi)),
                            f"Scale  1 : {scale:,}".replace(",", "."),
                            fill=(80, 80, 80), font=small_font)

                # Mini position diagram
                diagram_y = legend_y + int(6 / 25.4 * dpi) if is_last else legend_y
                _draw_sheet_diagram(dp, page_w - margin_px - int(20 / 25.4 * dpi),
                                    diagram_y, cols, rows, c, r, sheets, dpi)

            # north arrow with magnetic + grid declinations
            _draw_north_arrow(dp, page_w - margin_px - int(15 / 25.4 * dpi),
                              margin_px + int(5 / 25.4 * dpi), dpi, geomag)

            pages.append(page)

    # ---- save ------------------------------------------------------------
    _status("Saving PDF…")
    if len(pages) == 1:
        pages[0].save(str(output), "PDF", resolution=dpi)
    else:
        pages[0].save(str(output), "PDF", resolution=dpi,
                      save_all=True, append_images=pages[1:])
    _status(f"Saved: {output}")
    return output


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _outside(x1, y1, x2, y2, w, h) -> bool:
    """True if the line is entirely outside the image bounds."""
    return (x1 < -w and x2 < -w) or (x1 > 2 * w and x2 > 2 * w) or \
           (y1 < -h and y2 < -h) or (y1 > 2 * h and y2 > 2 * h)


def _draw_tools(draw: ImageDraw.ImageDraw, drawings: list,
                center_lat: float, center_lon: float,
                ground_w: float, ground_h: float,
                img_w: int, img_h: int, dpi: int) -> None:
    """Render tool drawings (ruler, protractor, line, route, compass)."""
    lw = max(2, dpi // 150)
    _TC = {"ruler": "#dc2626", "protractor": "#7c3aed",
           "line": "#0891b2", "compass": "#ea580c", "route": "#16a34a"}

    for drw in drawings:
        dtype = drw.get("type", "")
        color = _hex_to_rgb(_TC.get(dtype, "#333333"))

        if dtype == "ruler":
            pts = drw.get("points", [])
            if len(pts) == 2:
                p1 = latlon_to_pixel(pts[0][0], pts[0][1], center_lat, center_lon,
                                     ground_w, ground_h, img_w, img_h)
                p2 = latlon_to_pixel(pts[1][0], pts[1][1], center_lat, center_lon,
                                     ground_w, ground_h, img_w, img_h)
                draw.line([p1, p2], fill=color, width=lw)
                for p in [p1, p2]:
                    r2 = max(3, dpi // 72)
                    draw.ellipse([p[0]-r2, p[1]-r2, p[0]+r2, p[1]+r2], fill=color)

        elif dtype == "protractor":
            pts = drw.get("points", [])
            if len(pts) == 3:
                pxs = [latlon_to_pixel(p[0], p[1], center_lat, center_lon,
                                       ground_w, ground_h, img_w, img_h)
                       for p in pts]
                draw.line([pxs[0], pxs[1]], fill=color, width=lw)
                draw.line([pxs[1], pxs[2]], fill=color, width=lw)
                for p in pxs:
                    r2 = max(3, dpi // 72)
                    draw.ellipse([p[0]-r2, p[1]-r2, p[0]+r2, p[1]+r2], fill=color)

        elif dtype in {"line", "route"}:
            pts = drw.get("points", [])
            if len(pts) >= 2:
                pxs = [latlon_to_pixel(p[0], p[1], center_lat, center_lon,
                                       ground_w, ground_h, img_w, img_h)
                       for p in pts]
                for i in range(1, len(pxs)):
                    draw.line([pxs[i-1], pxs[i]], fill=color, width=lw)
                if dtype == "line":
                    for p in pxs:
                        r2 = max(3, dpi // 72)
                        draw.ellipse([p[0]-r2, p[1]-r2, p[0]+r2, p[1]+r2], fill=color)

        elif dtype == "compass":
            cc = drw.get("center", [0, 0])
            ec = drw.get("edge", [0, 0])
            pc = latlon_to_pixel(cc[0], cc[1], center_lat, center_lon,
                                 ground_w, ground_h, img_w, img_h)
            pe = latlon_to_pixel(ec[0], ec[1], center_lat, center_lon,
                                 ground_w, ground_h, img_w, img_h)
            rpx = int(math.hypot(pe[0]-pc[0], pe[1]-pc[1]))
            if rpx > 0:
                draw.ellipse([pc[0]-rpx, pc[1]-rpx, pc[0]+rpx, pc[1]+rpx],
                             outline=color, width=lw)
                draw.line([pc, pe], fill=color, width=lw)
                r2 = max(3, dpi // 72)
                draw.ellipse([pc[0]-r2, pc[1]-r2, pc[0]+r2, pc[1]+r2], fill=color)


def _draw_dashed_vline(draw: ImageDraw.ImageDraw, x: int,
                       y_top: int, y_bot: int,
                       color: tuple, width: int, dash: int) -> None:
    """Draw a vertical dashed line."""
    y = y_top
    while y < y_bot:
        y_end = min(y + dash, y_bot)
        draw.line([(x, y), (x, y_end)], fill=color, width=width)
        y += dash * 2


def _draw_dashed_hline(draw: ImageDraw.ImageDraw, y: int,
                       x_left: int, x_right: int,
                       color: tuple, width: int, dash: int) -> None:
    """Draw a horizontal dashed line."""
    x = x_left
    while x < x_right:
        x_end = min(x + dash, x_right)
        draw.line([(x, y), (x_end, y)], fill=color, width=width)
        x += dash * 2


def _draw_sheet_diagram(draw: ImageDraw.ImageDraw, x: int, y: int,
                        cols: int, rows: int, cur_c: int, cur_r: int,
                        total_sheets: int, dpi: int) -> None:
    """Draw a mini grid diagram showing which sheet we're on."""
    cell_w = max(8, int(5 / 25.4 * dpi))
    cell_h = max(6, int(4 / 25.4 * dpi))
    fnt = _font(max(8, dpi * 5 // 72))
    idx = 0
    for r in range(rows):
        for c in range(cols):
            if idx >= total_sheets:
                break
            idx += 1
            cx = x + c * cell_w
            cy = y + r * cell_h
            if r == cur_r and c == cur_c:
                draw.rectangle([cx, cy, cx + cell_w, cy + cell_h],
                               fill=(225, 29, 72), outline=(0, 0, 0))
                txt_color = (255, 255, 255)
            else:
                draw.rectangle([cx, cy, cx + cell_w, cy + cell_h],
                               fill=(230, 230, 230), outline=(0, 0, 0))
                txt_color = (80, 80, 80)
            draw.text((cx + 2, cy + 1), str(idx), fill=txt_color, font=fnt)


def _clamp(v: float, lo: float, hi: float) -> int:
    return int(max(lo, min(hi, v)))


def _nice_round(value: float) -> float:
    """Pick a 1/2/5 × 10^n value <= ``value``."""
    if value <= 0:
        return 1.0
    exp = math.floor(math.log10(value))
    base = 10 ** exp
    for mult in (5, 2, 1):
        cand = mult * base
        if cand <= value:
            return cand
    return base


def _draw_scale_bar(draw: ImageDraw.ImageDraw, x: int, y: int,
                    scale: int, dpi: int) -> None:
    """Graphic metric scale bar: 4 alternating segments of a "nice" length.

    The bar's total ground length is the largest 1/2/5 × 10^n value that
    fits within ~70 mm on paper, so the printout always shows e.g. 1 km
    or 500 m or 200 m segments — never an awkward 437 m bar.
    """
    target_mm = 70
    target_ground = target_mm * scale / 1000.0
    total_m = _nice_round(target_ground)
    total_mm = total_m * 1000.0 / scale
    total_px = int(round(total_mm / 25.4 * dpi))
    h_px = int(round(3 / 25.4 * dpi))
    n_seg = 4
    seg_px = total_px / n_seg

    # Alternating fills
    for i in range(n_seg):
        x0 = int(round(x + i * seg_px))
        x1 = int(round(x + (i + 1) * seg_px))
        fill = (0, 0, 0) if i % 2 == 0 else (255, 255, 255)
        draw.rectangle([x0, y, x1, y + h_px], fill=fill, outline=(0, 0, 0))
    # Outer border
    draw.rectangle([x, y, x + total_px, y + h_px], outline=(0, 0, 0), width=1)

    # Tick labels at 0, mid, full
    fnt = _font(max(12, dpi * 7 // 72))
    ty = y + h_px + int(1 / 25.4 * dpi)

    def _label(meters: float) -> str:
        if meters >= 1000:
            return (f"{meters / 1000:g} km")
        return f"{int(round(meters))} m"

    for frac, anchor in ((0.0, "left"), (0.5, "center"), (1.0, "right")):
        meters = total_m * frac
        lx = x + frac * total_px
        s = _label(meters)
        bbox = draw.textbbox((0, 0), s, font=fnt)
        tw = bbox[2] - bbox[0]
        if anchor == "center":
            lx -= tw / 2
        elif anchor == "right":
            lx -= tw
        draw.text((int(lx), ty), s, fill=(0, 0, 0), font=fnt)

    # Ratio label below the ticks
    fnt2 = _font(max(14, dpi * 8 // 72))
    draw.text((x, ty + int(5 / 25.4 * dpi)),
              f"Scale  1 : {scale:,}".replace(",", "."),
              fill=(0, 0, 0), font=fnt2)


def _draw_info(draw, x, y, scale, lat, lon, grid_info, source, geomag, dpi,
               right_x=None):
    fnt = _font(max(12, dpi * 7 // 72))   # ~7 pt at print
    lat_dir = "N" if lat >= 0 else "S"
    lon_dir = "E" if lon >= 0 else "W"
    lines = [
        f"Center: {abs(lat):.5f}°{lat_dir}  {abs(lon):.5f}°{lon_dir}",
        f"Source: {source}",
        f"Datum: WGS 84 (EPSG:4326)",
    ]
    if grid_info:
        lines.append(
            f"Grid: {GRID_SYSTEMS.get(grid_info.system, grid_info.system)}"
            f" — {grid_info.zone} — EPSG:{grid_info.epsg}"
        )
    if geomag is not None:
        d = geomag.declination_deg
        c = geomag.convergence_deg
        d_dir = "E" if d >= 0 else "W"
        c_dir = "E" if c >= 0 else "W"
        lines.append(
            f"Magnetic decl.: {abs(d):.1f}°{d_dir}"
            f"   Grid conv.: {abs(c):.1f}°{c_dir}"
            f"   ({geomag.model}, {int(geomag.year)})"
        )
    lines.append("Print at 100% without fit-to-page scaling")

    line_step = int(3.8 / 25.4 * dpi)
    fill = (60, 60, 60)
    if right_x is None:
        for i, line in enumerate(lines):
            draw.text((x, y + i * line_step), line, fill=fill, font=fnt)
        return

    available_w = max(0, right_x - x)
    gap = int(5 / 25.4 * dpi)
    min_col_w = int(32 / 25.4 * dpi)
    if available_w < min_col_w * 2 + gap:
        for i, line in enumerate(lines):
            _draw_fitted_text(draw, x, y + i * line_step, line, fnt, fill, available_w)
        return

    col_w = (available_w - gap) // 2
    rows = math.ceil(len(lines) / 2)
    for col, chunk in enumerate((lines[:rows], lines[rows:])):
        col_x = x + col * (col_w + gap)
        for row, line in enumerate(chunk):
            _draw_fitted_text(draw, col_x, y + row * line_step,
                              line, fnt, fill, col_w)


def _draw_fitted_text(draw, x, y, text, font, fill, max_width):
    """Draw text clipped with an ellipsis so it never leaves its column."""
    if max_width <= 0:
        return
    if _text_width(draw, text, font) <= max_width:
        draw.text((x, y), text, fill=fill, font=font)
        return

    ellipsis = "…"
    if _text_width(draw, ellipsis, font) > max_width:
        return

    lo = 0
    hi = len(text)
    best = ellipsis
    while lo <= hi:
        mid = (lo + hi) // 2
        candidate = text[:mid].rstrip() + ellipsis
        if _text_width(draw, candidate, font) <= max_width:
            best = candidate
            lo = mid + 1
        else:
            hi = mid - 1
    draw.text((x, y), best, fill=fill, font=font)


def _text_width(draw, text, font) -> int:
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0]


def _draw_north_arrow(draw, cx, cy, dpi, geomag=None):
    """North-arrow rosette showing true / grid / magnetic north.

    True north points straight up. The grid-north arrow is rotated by the
    grid convergence; the magnetic-north arrow by the magnetic declination.
    """
    length = int(11 / 25.4 * dpi)
    half_w = int(2 / 25.4 * dpi)
    base_y = cy + length

    def _arrow(angle_deg: float, color: tuple, label: str, head: int) -> None:
        a = math.radians(angle_deg)
        sa = math.sin(a)
        ca = math.cos(a)
        # Tip = (cx, cy) rotated around (cx, base_y)
        # i.e. arrow grows upward, then we rotate the tip about the base.
        # Vector from base to tip = (0, -length); rotate by `angle_deg` CW
        # (positive angle => tip leans right).
        tip_x = cx + sa * length
        tip_y = base_y - ca * length
        # Base corners perpendicular to direction
        bx_left = cx - ca * half_w
        by_left = base_y - sa * half_w
        bx_right = cx + ca * half_w
        by_right = base_y + sa * half_w
        draw.polygon([(tip_x, tip_y), (bx_left, by_left), (bx_right, by_right)],
                     fill=color)
        # Label near the tip
        fnt = _font(max(12, dpi * 7 // 72))
        lx = tip_x + sa * head - half_w
        ly = tip_y - ca * head - int(3 / 25.4 * dpi)
        draw.text((lx, ly), label, fill=color, font=fnt)

    # Centre point
    r = max(2, int(0.8 / 25.4 * dpi))
    draw.ellipse([cx - r, base_y - r, cx + r, base_y + r], fill=(0, 0, 0))

    # True north (always vertical)
    _arrow(0.0, (0, 0, 0), "N", int(2 / 25.4 * dpi))

    if geomag is not None:
        # Grid north — small offset, blue. Positive convergence = grid north
        # is rotated CCW from true north (i.e. tip leans left/west of N).
        if abs(geomag.convergence_deg) > 0.05:
            _arrow(-geomag.convergence_deg, (0, 60, 200), "G",
                   int(2 / 25.4 * dpi))
        # Magnetic north — red. Positive declination (E) → tip leans right.
        if abs(geomag.declination_deg) > 0.05:
            _arrow(geomag.declination_deg, (200, 30, 30), "M",
                   int(2 / 25.4 * dpi))


def _hex_to_rgb(h: str) -> tuple[int, int, int]:
    """Convert '#rrggbb' to (r, g, b)."""
    h = h.lstrip("#")
    if len(h) != 6:
        return (220, 38, 38)  # fallback red
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
