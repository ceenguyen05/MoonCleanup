"""Brightside trim sheet v0: procedural base colour / normal / ORM / emissive strips. Original work (M0-W0-T06).

Every strip tiles along U and is mapped by its V range, so hardware reaches the texel-density bar without a
unique unwrap. Colours are the art-direction section 5.1 palette tokens. Arrays use row 0 = bottom (v = 0).
"""

import numpy as np

import ctm_lib as lib

SIZE = 1024
PAD_PX = 2  # V inset so neighbouring strips never bleed in mips

# (name, height px, palette group used for the area-share measurement)
STRIPS = [
    ("panel", 256, "ivory"),
    ("ivory", 128, "ivory"),
    ("teal", 128, "teal"),
    ("deck", 128, "deck-gray"),
    ("teal_deep", 64, "teal"),
    ("yellow", 64, "yellow"),
    ("hazard", 64, "yellow"),
    ("graphite", 64, "graphite"),
    ("steel", 64, "steel"),
    ("glass", 32, "glass"),
    ("emit_teal", 16, "emissive"),
    ("emit_amber", 16, "emissive"),
]

# Brightside trim sheet v1 (M1-W5-T03 hero hardware): v0 plus a grating strip (weighing decks, Dump Plate) and a
# warm-white emissive strip (flood lenses). The deck strip gives up 64 px and glass 16 px so the sheet stays 1024 px.
# v0 (STRIPS) is unchanged, so the M0 proof module rebuilds byte-identically.
STRIPS_V1 = [
    ("panel", 256, "ivory"),
    ("ivory", 128, "ivory"),
    ("teal", 128, "teal"),
    ("deck", 64, "deck-gray"),
    ("grate", 64, "steel"),
    ("teal_deep", 64, "teal"),
    ("yellow", 64, "yellow"),
    ("hazard", 64, "yellow"),
    ("graphite", 64, "graphite"),
    ("steel", 64, "steel"),
    ("glass", 16, "glass"),
    ("emit_teal", 16, "emissive"),
    ("emit_amber", 16, "emissive"),
    ("emit_warm", 16, "emissive"),
]

PALETTE = {
    "grate": "#C9CCCF",
    "emit_warm": "#FFE2B0",
    "ivory": "#E4DCCB",
    "teal": "#1C8C84",
    "teal_deep": "#0E5E5C",
    "yellow": "#F2B705",
    "graphite": "#2B2F34",
    "steel": "#C9CCCF",
    "deck": "#B4B2AC",
    "glass": "#15181B",
    "emit_teal": "#35E0D2",
    "emit_amber": "#FFB02E",
}


def srgb(hex_color):
    return np.array([int(hex_color[i : i + 2], 16) / 255.0 for i in (1, 3, 5)], np.float32)


class TrimSheet:
    def __init__(self, strips=None):
        self.rows = {}
        self.groups = {}
        self.order = []
        y = 0
        for name, height, group in strips or STRIPS:
            self.rows[name] = (y, y + height)
            self.groups[name] = group
            self.order.append(name)
            y += height
        assert y == SIZE

    def v_range(self, name):
        y0, y1 = self.rows[name]
        return (y0 + PAD_PX) / SIZE, (y1 - PAD_PX) / SIZE

    def strip_px(self, name):
        y0, y1 = self.rows[name]
        return y1 - y0 - 2 * PAD_PX

    def index(self, name):
        return self.order.index(name)

    def generate(self, texdir, prefix, seed=7):
        rng = np.random.default_rng(seed)
        width = SIZE
        base = np.zeros((SIZE, width, 3), np.float32)
        normal = np.zeros((SIZE, width, 3), np.float32)
        orm = np.zeros((SIZE, width, 3), np.float32)
        emissive = np.zeros((SIZE, width, 3), np.float32)
        x = np.arange(width, dtype=np.float32)[None, :]

        def soft_noise(rows, passes=6):
            field = rng.random((rows, width)).astype(np.float32) - 0.5
            for _ in range(passes):
                field = (field + np.roll(field, 3, 1) + np.roll(field, -3, 1) + np.roll(field, 2, 0) + np.roll(field, -2, 0)) / 5.0
            return field / max(1e-6, float(np.abs(field).max()))

        def rounded(distance, radius):
            t = np.clip(distance / radius, 0.0, 1.0)
            return np.sqrt(1.0 - (1.0 - t) ** 2)

        for name in self.order:
            y0, y1 = self.rows[name]
            rows = y1 - y0
            yl = np.arange(rows, dtype=np.float32)[:, None]
            edge = np.minimum(yl + 0.5, rows - 0.5 - yl) + 0.0 * x
            color = np.broadcast_to(srgb(PALETTE.get(name, PALETTE["ivory"])), (rows, width, 3)).copy()
            height = np.zeros((rows, width), np.float32)
            rough = np.full((rows, width), 0.45, np.float32)
            metal = np.zeros((rows, width), np.float32)
            occlusion = np.ones((rows, width), np.float32)
            glow = np.zeros((rows, width, 3), np.float32)

            if name == "panel":
                seam = np.abs(((x + 128.0) % 256.0) - 128.0) + 0.0 * yl
                inset = np.minimum(edge, seam)
                body = rounded(inset, 6.0)
                height = 1.6 * body
                xr = (x % 32.0) - 16.0
                yr = np.minimum(np.abs(yl - 14.0), np.abs(yl - (rows - 15.0)))
                rivet = np.clip(1.0 - np.sqrt(xr * xr + yr * yr) / 3.6, 0.0, 1.0) ** 0.5
                height = height + 0.9 * rivet
                tint = np.array([0.985, 1.012, 1.0, 0.992], np.float32)[((x // 256.0) % 4).astype(int)] + 0.0 * yl
                shade = (0.86 + 0.14 * body) * tint * (1.0 + 0.012 * soft_noise(rows))
                color *= shade[..., None]
                occlusion = 0.7 + 0.3 * body
                rough = 0.45 + 0.04 * soft_noise(rows)
            elif name == "ivory":
                body = rounded(edge, 5.0)
                height = 1.2 * body
                color *= ((0.9 + 0.1 * body) * (1.0 + 0.012 * soft_noise(rows)))[..., None]
                occlusion = 0.8 + 0.2 * body
            elif name == "teal":
                body = rounded(edge, 8.0)
                groove = np.clip(1.0 - np.abs(yl - rows / 2.0) / 3.0, 0.0, 1.0) + 0.0 * x
                height = 1.8 * body - 0.7 * groove
                color *= ((0.88 + 0.12 * body) * (1.0 - 0.25 * groove) * (1.0 + 0.015 * soft_noise(rows)))[..., None]
                occlusion = (0.75 + 0.25 * body) * (1.0 - 0.3 * groove)
                rough = np.full((rows, width), 0.4, np.float32)
            elif name == "deck":
                body = rounded(edge, 4.0)
                xr = (x % 16.0) - 8.0
                yr = (yl % 16.0) - 8.0
                stud = np.clip(1.0 - np.sqrt(xr * xr + yr * yr) / 4.0, 0.0, 1.0) ** 0.5
                height = 1.0 * body + 0.8 * stud
                color *= ((0.9 + 0.1 * body) * (1.0 + 0.03 * soft_noise(rows, 3)))[..., None]
                rough = np.full((rows, width), 0.7, np.float32)
                occlusion = 0.85 + 0.15 * body
            elif name == "teal_deep":
                height = 0.45 * np.sin(yl * (2.0 * np.pi / 16.0)) + 0.0 * x
                color *= (0.92 + 0.08 * np.sin(yl * (2.0 * np.pi / 16.0)) + 0.0 * x)[..., None]
            elif name == "yellow":
                body = rounded(edge, 5.0)
                height = 1.2 * body
                color *= (0.9 + 0.1 * body)[..., None]
            elif name == "hazard":
                body = rounded(edge, 4.0)
                stripe = (((x + yl) // 32.0) % 2.0)[..., None]
                color = stripe * srgb(PALETTE["yellow"]) + (1.0 - stripe) * srgb(PALETTE["graphite"])
                color = color * (0.9 + 0.1 * body)[..., None]
                height = 1.0 * body
                rough = np.full((rows, width), 0.5, np.float32)
            elif name == "graphite":
                rib = np.sin(x * (2.0 * np.pi / 16.0)) + 0.0 * yl
                height = 0.6 * rib
                color *= (0.9 + 0.1 * rib)[..., None]
                rough = np.full((rows, width), 0.6, np.float32)
            elif name == "steel":
                body = rounded(edge, 3.0)
                streak = rng.normal(0.0, 1.0, (rows, 1)).astype(np.float32) + 0.0 * x
                height = 0.8 * body + 0.08 * streak
                rough = np.clip(0.35 + 0.05 * streak, 0.2, 0.55)
                metal[:] = 1.0
                color *= (1.0 + 0.02 * streak)[..., None]
            elif name == "grate":
                # Bar grating across U: 8 px bright brushed bars, 4 px dark open slots (period 12 px = 3.75 cm at 320 px/m).
                phase = (x % 12.0) + 0.0 * yl
                bar = np.clip(1.0 - np.abs(phase - 4.0) / 4.5, 0.0, 1.0)
                slot = (phase >= 9.0).astype(np.float32)
                body = rounded(edge, 3.0)
                height = 1.4 * bar * body - 1.2 * slot
                color *= ((0.82 + 0.18 * bar) * (1.0 - 0.8 * slot))[..., None]
                occlusion = 1.0 - 0.65 * slot
                rough = 0.38 + 0.25 * slot
                metal = (1.0 - slot).astype(np.float32)
            elif name == "glass":
                rough = np.full((rows, width), 0.05, np.float32)
            elif name in ("emit_teal", "emit_amber", "emit_warm"):
                glow = np.broadcast_to(srgb(PALETTE[name]), (rows, width, 3)).copy()
                color *= 0.35
                rough = np.full((rows, width), 0.3, np.float32)

            dhdx = np.clip((np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 0.5, -1.5, 1.5)
            dhdy = np.clip(np.gradient(height, axis=0), -1.5, 1.5)
            length = np.sqrt(dhdx * dhdx + dhdy * dhdy + 1.0)
            normal[y0:y1, :, 0] = (-dhdx / length) * 0.5 + 0.5
            normal[y0:y1, :, 1] = (-dhdy / length) * 0.5 + 0.5
            normal[y0:y1, :, 2] = (1.0 / length) * 0.5 + 0.5
            base[y0:y1] = np.clip(color, 0.0, 1.0)
            orm[y0:y1, :, 0] = np.clip(occlusion, 0.0, 1.0)
            orm[y0:y1, :, 1] = np.clip(rough, 0.0, 1.0)
            orm[y0:y1, :, 2] = metal
            emissive[y0:y1] = glow

        images, sizes = {}, {}
        for key, array, is_srgb in (("basecolor", base, True), ("normal", normal, False), ("orm", orm, False), ("emissive", emissive, True)):
            images[key], sizes[key] = lib.save_texture(f"{prefix}_{key}", array, is_srgb, f"{texdir}/{prefix}_{key}.png")
        return images, sizes
