#!/usr/bin/env python3
"""Build transparent phone cutouts and body-color accents.

Downloads each phone's remote image_url (browser User-Agent, about one second
between requests), then:

1. Flood-fill near-white pixels (min channel > 228 and low saturation) that
   touch the border, and treat that region as background.
2. Union that foreground with the rembg u2net mask so a white phone body is
   kept when the flood fill would otherwise eat it, while near-white backdrop
   that both methods call background is removed.
3. Fill holes, 1px opening, 1px erosion, drop tiny components.
4. Gaussian-soften the alpha (sigma 0.7).
5. Crop to the alpha bbox, scale the longest side to 560px, and center it on a
   600x600 transparent canvas saved as WebP.
6. Sample the dominant non-gray body color (skip the dark screen, near-white,
   and near-black pixels) and store it as accent on the phone. If the body has
   no chromatic color, fall back to the brand color.

Corners of every canvas are checked to be transparent.
"""

from __future__ import annotations

import argparse
import json
import re
import time
import unicodedata
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
PHONES_PATH = ROOT / "data" / "phones.json"
OUT_DIR = ROOT / "images" / "phones"
CACHE_DIR = Path("/tmp/phone-cutout-cache")
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)
CANVAS = 600
LONG_SIDE = 560
WHITE_MIN = 228
LOW_SAT = 0.15

BRAND_ACCENT = {
    "Apple": "#8e8e93",
    "Samsung": "#5b7cfa",
    "Google": "#4285f4",
    "Xiaomi": "#ff6900",
    "Huawei": "#cf0a2c",
    "OPPO": "#26c281",
}


def slug_of(brand: str, model: str) -> str:
    text = f"{brand} {model}".lower().replace("+", " plus ").replace("＋", " plus ")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def download(url: str, dest: Path) -> None:
    if dest.is_file() and dest.stat().st_size > 0:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    last_error = None
    for attempt in range(4):
        try:
            request = Request(url, headers={"User-Agent": UA, "Accept": "image/*,*/*"})
            with urlopen(request, timeout=45) as response:
                data = response.read()
            if len(data) < 500:
                raise RuntimeError(f"short response {len(data)} bytes")
            dest.write_bytes(data)
            return
        except Exception as exc:  # noqa: BLE001 - retry network failures
            last_error = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"download failed for {url}: {last_error}")


def flood_background(rgb: np.ndarray) -> np.ndarray:
    channels = rgb.astype(np.int16)
    mx = channels.max(axis=2)
    mn = channels.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1)
    near_white = (mn > WHITE_MIN) & (sat < LOW_SAT)
    labeled, _count = ndimage.label(near_white)
    border = np.unique(
        np.concatenate(
            [labeled[0, :], labeled[-1, :], labeled[:, 0], labeled[:, -1]]
        )
    )
    border = border[border != 0]
    if border.size == 0:
        return np.zeros(labeled.shape, dtype=bool)
    return np.isin(labeled, border)


def rembg_foreground(image: Image.Image, session) -> np.ndarray:
    from rembg import remove

    cut = remove(image, session=session).convert("RGBA")
    alpha = np.array(cut)[:, :, 3]
    if alpha.shape != (image.height, image.width):
        alpha_image = Image.fromarray(alpha, mode="L").resize(
            (image.width, image.height), Image.Resampling.BILINEAR
        )
        alpha = np.array(alpha_image)
    return alpha > 128


def cleanup_mask(mask: np.ndarray) -> np.ndarray:
    mask = ndimage.binary_fill_holes(mask)
    structure = np.ones((3, 3), dtype=bool)
    mask = ndimage.binary_opening(mask, structure=structure)
    mask = ndimage.binary_erosion(mask, structure=structure)
    labeled, count = ndimage.label(mask)
    if count:
        sizes = np.bincount(labeled.ravel())
        sizes[0] = 0
        tiny = sizes < max(24, int(mask.size * 0.0015))
        mask = mask & ~tiny[labeled]
    return mask


def soften(mask: np.ndarray) -> np.ndarray:
    alpha = ndimage.gaussian_filter(mask.astype(np.float32), sigma=0.7)
    return np.clip(alpha, 0, 1)


def compose(rgb: np.ndarray, alpha: np.ndarray) -> Image.Image:
    mask = (alpha * 255).astype(np.uint8)
    ys, xs = np.where(mask > 8)
    if xs.size == 0:
        raise RuntimeError("cutout is empty")
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    crop = np.dstack([rgb[y0 : y1 + 1, x0 : x1 + 1], mask[y0 : y1 + 1, x0 : x1 + 1]])
    image = Image.fromarray(crop, "RGBA")
    scale = LONG_SIDE / max(image.width, image.height)
    resized = image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(
        resized,
        ((CANVAS - resized.width) // 2, (CANVAS - resized.height) // 2),
        resized,
    )
    return canvas


def assert_transparent_corners(canvas: Image.Image, slug: str) -> None:
    for point in ((0, 0), (CANVAS - 1, 0), (0, CANVAS - 1), (CANVAS - 1, CANVAS - 1)):
        if canvas.getpixel(point)[3] != 0:
            raise RuntimeError(f"{slug}: corner {point} is not transparent")


def visible_accent(color: str) -> str:
    """Keep the sampled hue, but lift dull dark colors so bars read on the dark UI."""
    red = int(color[1:3], 16)
    green = int(color[3:5], 16)
    blue = int(color[5:7], 16)
    high = max(red, green, blue)
    low = min(red, green, blue)
    luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    sat = (high - low) / high if high else 0
    if luma >= 120 or sat >= 0.38:
        return color
    target = 132
    mix = 0 if luma >= target else (target - luma) / (255 - luma)
    mix = max(0.0, min(0.62, mix))
    lifted = [int(round(channel + (255 - channel) * mix)) for channel in (red, green, blue)]
    return "#{:02x}{:02x}{:02x}".format(*lifted)


def dominant_accent(canvas: Image.Image, brand: str) -> tuple[str, str]:
    arr = np.asarray(canvas).astype(np.float32)
    rgb = arr[:, :, :3]
    alpha = arr[:, :, 3]
    red, green, blue = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    high = np.maximum(np.maximum(red, green), blue)
    low = np.minimum(np.minimum(red, green), blue)
    luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    sat = (high - low) / np.maximum(high, 1)
    # Body color only: skip the dark screen, near-white glass, near-black gaps, and gray metal.
    # Pale metal still counts; a higher luma floor keeps a dim wallpaper from beating the body.
    keep = (alpha > 200) & (luma > 70) & (luma < 230) & (sat > 0.12) & (high > 40)
    fallback = BRAND_ACCENT.get(brand, "#d6d3d1")
    if int(keep.sum()) < 200:
        return visible_accent(fallback), "brand"
    pixels = rgb[keep]
    bins = (pixels // 16).astype(np.int32)
    keys = bins[:, 0] * 256 + bins[:, 1] * 16 + bins[:, 2]
    values, counts = np.unique(keys, return_counts=True)
    winner = values[int(counts.argmax())]
    chosen = pixels[keys == winner]
    if chosen.shape[0] < 200:
        return visible_accent(fallback), "brand"
    median = np.median(chosen, axis=0)
    hex_color = "#{:02x}{:02x}{:02x}".format(*(int(channel) for channel in median))
    return visible_accent(hex_color), "sampled"


def cut_one(source: Path, session) -> Image.Image:
    image = Image.open(source).convert("RGB")
    rgb = np.array(image)
    background = flood_background(rgb)
    foreground = (~background) | rembg_foreground(image, session)
    alpha = soften(cleanup_mask(foreground))
    return compose(rgb, alpha)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="rebuild images even if they exist")
    args = parser.parse_args()

    from rembg import new_session

    phones = json.loads(PHONES_PATH.read_text(encoding="utf-8"))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    session = new_session("u2net")
    fallbacks = []
    for index, phone in enumerate(phones, start=1):
        slug = slug_of(phone["brand"], phone["model"])
        dest = OUT_DIR / f"{slug}.webp"
        url = phone.get("image_url")
        if not isinstance(url, str) or not url.startswith("http"):
            raise SystemExit(f"{slug}: missing remote image_url")
        cached = CACHE_DIR / f"{slug}{Path(url.split('?', 1)[0]).suffix or '.img'}"
        need_download = not cached.is_file()
        download(url, cached)
        if need_download:
            time.sleep(1.0)
        if args.force or not dest.is_file() or "accent" not in phone:
            canvas = cut_one(cached, session)
            assert_transparent_corners(canvas, slug)
            canvas.save(dest, format="WEBP", quality=82, method=6)
            accent, kind = dominant_accent(canvas, phone["brand"])
            phone["accent"] = accent
            if kind == "brand":
                fallbacks.append(f"{phone['brand']} {phone['model']} {accent}")
            print(f"[{index}/{len(phones)}] {slug} {accent} ({kind})", flush=True)
        else:
            print(f"[{index}/{len(phones)}] {slug} kept", flush=True)
    PHONES_PATH.write_text(json.dumps(phones, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(phones)} cutouts; brand-color fallbacks: {len(fallbacks)}")
    for line in fallbacks:
        print(f"fallback {line}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
