"""Crop the plugin screenshots to one consistent frame around the Settings panel.

The three captures came from differently sized windows, so a fixed rectangle
would cut one and leave dead space in another. The panel is located by its own
outline instead of by "white rows": the modal is a light card sitting on a
dimmed backdrop, and the backdrop is uniformly darker than the card everywhere
outside the card's rounded corners. Taking the largest rectangle that is
strictly brighter than the backdrop isolates the panel, whatever its position.

Every cropped image is then pasted into one shared canvas, so the trio lines up
in a README grid regardless of the original window size.
"""

from __future__ import annotations

import os
import sys

import numpy as np
from PIL import Image

ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
SCREENSHOTS = ["screenshot-1.png", "screenshot-2.png", "screenshot-3.png"]
OUTPUT_PREFIX = "panel-"


def backdrop_level(pixels: np.ndarray) -> int:
    """The most common luminance on the border ring, i.e. the dimmed backdrop."""
    ring = np.concatenate([
        pixels[0, :], pixels[-1, :], pixels[:, 0], pixels[:, -1],
    ])
    values, counts = np.unique(ring, return_counts=True)
    return int(values[counts.argmax()])


# The Settings card is near-white regardless of what is behind the window, so an
# absolute floor finds it even when the desktop shows through the window edges —
# a relative "brighter than the backdrop" test fails exactly in that case.
CARD_FLOOR = 248


def panel_bounds(image: Image.Image) -> tuple[int, int, int, int]:
    """Bounds of the modal card, as the largest near-white rectangle."""
    rgb = np.asarray(image.convert("RGB"), dtype=np.int16)
    luminance = rgb.mean(axis=2)

    brighter = luminance > CARD_FLOOR

    # The panel is a tall block: many rows are mostly near-white, the title bar
    # is thin, and the sidebar never reaches this brightness.
    row_profile = brighter.mean(axis=1)
    candidates = np.flatnonzero(row_profile >= 0.30)
    if candidates.size == 0:
        raise SystemExit("could not locate the Settings panel")

    # Longest contiguous run of candidate rows.
    breaks = np.flatnonzero(np.diff(candidates) > 3)
    starts = np.concatenate(([0], breaks + 1))
    ends = np.concatenate((breaks, [candidates.size - 1]))
    spans = [(int(starts[i]), int(ends[i])) for i in range(starts.size)]
    best = max(spans, key=lambda s: candidates[s[1]] - candidates[s[0]])
    top = int(candidates[best[0]])
    bottom = int(candidates[best[1]]) + 1

    # Horizontal extent: within those rows, the widest span of bright columns.
    band = brighter[top:bottom]
    col_profile = band.mean(axis=0)
    columns = np.flatnonzero(col_profile >= 0.50)
    if columns.size == 0:
        raise SystemExit("could not locate the Settings panel columns")

    left, right = int(columns[0]), int(columns[-1]) + 1

    # Trim the soft shadow at the corners: walk inward until the row is almost
    # entirely bright, which is where the card's own surface begins.
    solid = brighter[top:bottom, left:right].mean(axis=1) >= 0.92
    row_indexes = np.flatnonzero(solid)
    if row_indexes.size > 0:
        top = top + int(row_indexes[0])
        bottom = top + int(row_indexes[-1] - row_indexes[0]) + 1

    solid_cols = brighter[top:bottom, left:right].mean(axis=0) >= 0.92
    col_indexes = np.flatnonzero(solid_cols)
    if col_indexes.size > 0:
        left = left + int(col_indexes[0])
        right = left + int(col_indexes[-1] - col_indexes[0]) + 1

    return left, top, right, bottom


def trim_empty_bottom(image: Image.Image, box: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    """Cut the blank lower half of the card, keeping a little breathing room.

    The Settings modal is a fixed tall panel, so its content fills only the top
    third; a README image that keeps all of that reads as mostly empty space.
    The card's own fill is sampled rather than assumed to be pure white.
    """
    left, top, right, bottom = box
    rgb = np.asarray(image.convert("RGB"), dtype=np.int16)
    panel = rgb[top:bottom, left:right]

    # The card fill is whatever dominates the panel; content is anything else.
    flat = panel.reshape(-1, 3)
    quantised = (flat // 4 * 4)
    values, counts = np.unique(quantised, axis=0, return_counts=True)
    fill = values[counts.argmax()]

    differs = (np.abs(panel - fill).max(axis=2) > 24)
    # Ignore the outer columns: the card's rounded corners and their antialiasing
    # live there, and counting them would keep the whole blank tail alive.
    inset = max(8, panel.shape[1] // 12)
    interior = differs[:, inset:panel.shape[1] - inset]
    rows = np.flatnonzero(interior.mean(axis=1) > 0.02)
    if rows.size == 0:
        return box
    content_bottom = top + int(rows[-1])
    tail = min(28, bottom - content_bottom)
    return left, top, right, content_bottom + tail


def main() -> None:
    crops = []
    for name in SCREENSHOTS:
        path = os.path.join(ASSETS, name)
        if not os.path.exists(path):
            raise SystemExit(f"missing {path}")
        image = Image.open(path).convert("RGB")
        left, top, right, bottom = panel_bounds(image)
        box = trim_empty_bottom(image, (left, top, right, bottom))
        print(f"{name}: panel {box[0]},{box[1]} .. {box[2]},{box[3]}  "
              f"({box[2] - box[0]}x{box[3] - box[1]})")
        crops.append((name, image, box))

    width = max(b[2] - b[0] for _, _, b in crops)
    height = max(b[3] - b[1] for _, _, b in crops)
    print(f"output frame: {width}x{height}")

    for name, image, box in crops:
        # No padding: the card's own rounded corners and drop shadow are already
        # the edge of the subject, and a coloured mat would read as a grey border.
        canvas = Image.new("RGB", (width, height), (0xFF, 0xFF, 0xFF))
        panel = image.crop(box)
        canvas.paste(panel, ((width - panel.width) // 2, (height - panel.height) // 2))
        out = os.path.join(ASSETS, OUTPUT_PREFIX + name.split("-", 1)[1])
        canvas.save(out, format="PNG", optimize=True)
        print(f"wrote {os.path.basename(out)}  {canvas.width}x{canvas.height}")


if __name__ == "__main__":
    sys.exit(main())