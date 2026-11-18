"""Source script: trundle (Trundle walk-behind push cart, production, M1-W7-T02).

Brightside's compact cleaning cart (art-direction 5.2): tall T-handle, low ivory body on a teal skid frame, a bristle
drum in front between teal arms with yellow hub caps, a small smoked hopper, white head lamps. About 1.4 x 0.9 x 1.1 m.
Original procedural asset; colours come from the Brightside PBR palette (art-direction 5.1) baked into COLOR_0 (linear
albedo x vertex AO), so the runtime needs one vertex-colour material and no textures.

Game frame (what the runtime sees): +Z forward (drum end), +Y up, +X right, origin = chassis ground point. The script
models in that frame through `P()` and Blender's exporter maps Blender (x, y, z) -> glTF (x, z, -y).

Nodes (kept stable for the animation spec, see apps/client/src/visuals/vfx/vehicles/trundle-model.ts):
    chassis_LOD<n>, lamps_LOD<n>, drum_LOD<n>, wheels_LOD<n>   meshes, vertices in the asset frame
    drum_pivot, wheel_pivot                                    empties at the spin axes (spin about X)

    blender --background --python assets/models/vehicles/trundle.py -- --out <raw.glb> --report <json> --texdir <dir>
"""

import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "tools", "asset-pipeline", "src", "blender")
)

import numpy as np  # noqa: E402

import ctm_blockout as kit  # noqa: E402
import ctm_lib as lib  # noqa: E402

ASSET_ID = "trundle"
IVORY, TEAL, TEAL_DEEP, YELLOW, GRAPHITE, STEEL, SMOKE, LENS, BRISTLE, BRISTLE_DARK, AMBER = range(11)
NAMES = {
    IVORY: "ivory", TEAL: "teal", TEAL_DEEP: "teal-deep", YELLOW: "yellow", GRAPHITE: "graphite", STEEL: "steel",
    SMOKE: "smoke", LENS: "lens", BRISTLE: "bristle", BRISTLE_DARK: "bristle-dark", AMBER: "amber",
}
# sRGB hex per slot (art-direction 5.1 where a token exists); converted to linear when baked.
HEX = {
    IVORY: 0xE4DCCB, TEAL: 0x1C8C84, TEAL_DEEP: 0x0E5E5C, YELLOW: 0xF2B705, GRAPHITE: 0x2B2F34, STEEL: 0xC9CCCF,
    SMOKE: 0x3A3F46, LENS: 0xFFF4CF, BRISTLE: 0x7A6650, BRISTLE_DARK: 0x4E4233, AMBER: 0xFFB02E,
}
DRUM_R = 0.2
DRUM_FRONT = 0.78
WHEEL_R = 0.22
DRUM_Z = DRUM_FRONT - DRUM_R
WHEEL_Z = -0.45


def P(x, y, z):
    """Game frame (x right, y up, z forward) -> Blender (z up, forward = -y)."""
    return (x, -z, y)


def lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def ellip(b, center, half, slot, e_h=2.0, e_v=2.0, lod=0, z_range=None):
    """Superellipsoid with half extents in the game frame (x, y, z)."""
    big = max(half)
    nu, nv = (24, 12) if big > 0.4 else (16, 8) if big > 0.15 else (12, 6) if big > 0.05 else (8, 4)
    nu, nv = (nu, nv) if lod == 0 else (max(8, nu // 2), max(4, nv // 2)) if lod == 1 else (max(6, nu // 3), max(3, nv // 3))
    b.add_superellipsoid(P(*center), (half[0], half[2], half[1]), slot, 0, e_h, e_v, nu, nv, z_range=z_range)


def rod(b, a, c, r, slot, lod, caps=(False, False), cap_rings=2):
    nu = (16, 10, 6)[lod]
    b.add_tube([P(*a), P(*c)], [r, r], slot, 0, nu, cap_rings, 1.0, caps)


def build(piece, lod):
    b = kit.Builder(f"{ASSET_ID}_{piece}_LOD{lod}")
    nu = (28, 14, 8)[lod]
    if piece == "chassis":
        # Body shell, skid plate, bumper, hopper, handle assembly.
        ellip(b, (0.0, 0.37, 0.05), (0.45, 0.14, 0.56), IVORY, 4.0, 4.0, lod)
        ellip(b, (0.0, 0.215, 0.05), (0.47, 0.06, 0.6), TEAL, 4.0, 3.0, lod)
        ellip(b, (0.0, 0.19, 0.6), (0.4, 0.045, 0.07), TEAL_DEEP, 3.0, 3.0, lod)  # front lip
        ellip(b, (0.0, 0.5, 0.2), (0.3, 0.035, 0.28), TEAL, 4.0, 3.0, lod)  # hood trim, behind the lamps
        # Hopper: smoked body, teal rim, ivory lid, steel clasp.
        ellip(b, (0.0, 0.63, -0.14), (0.31, 0.14, 0.24), SMOKE, 3.0, 3.0, lod)
        ellip(b, (0.0, 0.5, -0.14), (0.35, 0.03, 0.28), TEAL, 4.0, 3.0, lod)
        ellip(b, (0.0, 0.775, -0.14), (0.25, 0.03, 0.2), IVORY, 4.0, 3.0, lod)
        if lod < 2:
            ellip(b, (0.0, 0.52, 0.12), (0.06, 0.02, 0.03), STEEL, 3.0, 3.0, lod)
        # Drum arms (teal) and end plates, steel axle through the drum.
        for s in (-1, 1):
            ellip(b, (s * 0.6, 0.23, 0.38), (0.035, 0.07, 0.34), TEAL, 4.0, 3.0, lod)
            if lod < 2:
                b.add_tube([P(s * 0.62, DRUM_R, DRUM_Z), P(s * 0.655, DRUM_R, DRUM_Z)], [0.1, 0.1], TEAL_DEEP, 0, nu, 1, 1.0, (False, False))
        # Axle (wheels spin around it).
        rod(b, (-0.5, WHEEL_R, WHEEL_Z), (0.5, WHEEL_R, WHEEL_Z), 0.03, STEEL, lod)
        # Rear lamps and the wheel arches.
        for s in (-1, 1):
            ellip(b, (s * 0.3, 0.4, -0.5), (0.07, 0.035, 0.02), AMBER, 3.0, 3.0, lod)
            if lod < 2:
                ellip(b, (s * 0.485, 0.3, WHEEL_Z), (0.02, 0.1, 0.17), TEAL_DEEP, 3.0, 3.0, lod)
        # Handle: two graphite uprights, yellow T-bar with graphite grips, control box.
        for s in (-1, 1):
            rod(b, (s * 0.3, 0.42, -0.45), (s * 0.3, 1.3, -0.78), 0.024, GRAPHITE, lod, (True, True), 2)
        rod(b, (-0.3, 1.33, -0.8), (0.3, 1.33, -0.8), 0.03, YELLOW, lod, (False, False))
        for s in (-1, 1):
            b.add_tube([P(s * 0.3, 1.33, -0.8), P(s * 0.4, 1.33, -0.8)], [0.036, 0.036], GRAPHITE, 0, (16, 10, 6)[lod], 2, 1.0, (False, True))
        ellip(b, (0.0, 1.27, -0.76), (0.1, 0.045, 0.06), IVORY, 4.0, 3.0, lod)
        if lod == 0:
            for k in (-1, 1):
                ellip(b, (k * 0.04, 1.318, -0.77), (0.016, 0.006, 0.016), TEAL, 2.0, 2.0, lod)
            # Fasteners: a row of rivet heads on the shoulder of the shell.
            for i in range(3):
                for s in (-1, 1):
                    ellip(b, (s * 0.4, 0.46, -0.28 + i * 0.17), (0.012, 0.01, 0.012), STEEL, 2.0, 2.0, lod)
    elif piece == "lamps":
        for s in (-1, 1):
            ellip(b, (s * 0.3, 0.42, 0.615), (0.065, 0.045, 0.03), LENS, 3.0, 3.0, lod)
    elif piece == "drum":
        # Bristle bands with alternating tone (combed stripes), flat steel core, yellow hub caps.
        bands = 9 if lod == 0 else 5 if lod == 1 else 3
        span = 1.04
        w = span / bands
        for k in range(bands):
            x0 = -span / 2 + k * w + 0.004
            slot = BRISTLE if k % 2 == 0 else BRISTLE_DARK
            b.add_tube([P(x0, DRUM_R, DRUM_Z), P(x0 + w - 0.008, DRUM_R, DRUM_Z)], [DRUM_R, DRUM_R], slot, 0, nu, 1, 1.0, (False, False))
        rod(b, (-0.6, DRUM_R, DRUM_Z), (0.6, DRUM_R, DRUM_Z), 0.05, STEEL, lod)
        for s in (-1, 1):
            b.add_tube(
                [P(s * 0.55, DRUM_R, DRUM_Z), P(s * 0.585, DRUM_R, DRUM_Z), P(s * 0.62, DRUM_R, DRUM_Z)],
                [0.115, 0.13, 0.1], YELLOW, 0, nu, 1, 1.0, (False, True) if s > 0 else (True, False),
            )
    elif piece == "wheels":
        for s in (-1, 1):
            x = s * 0.5
            b.add_tube(
                [P(x - 0.055, WHEEL_R, WHEEL_Z), P(x, WHEEL_R, WHEEL_Z), P(x + 0.055, WHEEL_R, WHEEL_Z)],
                [WHEEL_R * 0.9, WHEEL_R, WHEEL_R * 0.9], GRAPHITE, 0, nu, 1, 1.0, (False, False),
            )
            hub_x = x + s * 0.057
            b.add_tube([P(hub_x - s * 0.01, WHEEL_R, WHEEL_Z), P(hub_x + s * 0.01, WHEEL_R, WHEEL_Z)], [0.12, 0.12], STEEL, 0, nu, 1, 1.0, (False, False))
            b.add_tube([P(hub_x, WHEEL_R, WHEEL_Z), P(hub_x + s * 0.02, WHEEL_R, WHEEL_Z)], [0.045, 0.045], YELLOW, 0, (16, 10, 6)[lod], 1, 1.0, (False, False))
    return b


def bake_palette(obj):
    """COLOR_0 (slot, AO, part) -> linear palette albedo x AO, alpha 1."""
    mesh = obj.data
    layer = mesh.color_attributes["Col"]
    n = len(mesh.loops)
    cols = np.empty(n * 4, np.float32)
    layer.data.foreach_get("color", cols)
    cols = cols.reshape(n, 4)
    slots = np.rint(cols[:, 0] * kit.SLOT_SCALE).astype(int)
    table = np.zeros((16, 3), np.float32)
    for slot, hexv in HEX.items():
        table[slot] = (lin((hexv >> 16) & 255), lin((hexv >> 8) & 255), lin(hexv & 255))
    ao = cols[:, 1:2]
    out = np.ones((n, 4), np.float32)
    out[:, :3] = table[slots] * ao
    layer.data.foreach_set("color", out.ravel())
    mesh.update()


def main():
    args = lib.cli_args()
    steps = lib.Steps()
    lib.reset_scene()
    lib.ensure_world(ao_distance=0.06)
    material = kit.flat_material(ASSET_ID)
    pieces = ("chassis", "lamps", "drum", "wheels")
    objects = {}
    for piece in pieces:
        for lod in range(3):
            obj = build(piece, lod).to_object(f"{piece}_LOD{lod}", material)
            kit.shade_smooth(obj, 50.0)
            objects[(piece, lod)] = obj
    steps.mark("geometry")
    for obj in objects.values():
        kit.bake_ao_into_green(obj, samples=32, floor=0.55)
        bake_palette(obj)
    steps.mark("vertex AO + palette")
    pivots = [
        kit.add_socket("drum_pivot", P(0.0, DRUM_R, DRUM_Z)),
        kit.add_socket("wheel_pivot", P(0.0, WHEEL_R, WHEEL_Z)),
    ]
    size = kit.export_glb(args.out, list(objects.values()) + pivots)
    steps.mark("export")
    low = [1e9] * 3
    top = [-1e9] * 3
    for (piece, lod), obj in objects.items():
        if lod != 0:
            continue
        lo, hi = lib.bounds(obj)
        low = [min(low[i], lo[i]) for i in range(3)]
        top = [max(top[i], hi[i]) for i in range(3)]
    lib.write_report(
        args.report,
        {
            "asset": ASSET_ID,
            "class": "vehicle",
            "placeholder": False,
            "sizeM_blender_xyz": [round(top[i] - low[i], 4) for i in range(3)],
            "pieceTriangles": {p: [lib.triangle_count(objects[(p, l)]) for l in range(3)] for p in pieces},
            "pivots": [s.name for s in pivots],
            "rawBytes": size,
            "steps": steps.items,
            "totalSeconds": steps.total(),
        },
    )
    print(f"[ctm] {ASSET_ID}: piece triangles { {p: [lib.triangle_count(objects[(p, l)]) for l in range(3)] for p in pieces} }", flush=True)


main()
