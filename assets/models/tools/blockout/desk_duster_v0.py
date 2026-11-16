"""Source script: desk_duster_v0 (Desk Duster v0, M1-W3-T07).

The T1 starter tool: a comically tiny handled desk brush (naming bible: "small ceremonial desk brush, polished wood
and brass"; display alias Toothbrush / Starter Brush). 16 cm long, so it reads as absurdly small in the custodian's
1.15x glove. Polished wood handle and head, brass ferrule, graphite bristle tufts. Origin = grip point (the
custodian's `socket_hand_R`), handle along the hand's forward axis, bristles down; `socket_contact` sits at the
bristle tips. Same slot palette as the custodian (one shared runtime material). Original procedural asset.

    blender --background --python assets/models/tools/blockout/desk_duster_v0.py -- --out <raw.glb> --report <json> --texdir <dir>
"""

import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo

sys.path.insert(
    0,
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "tools", "asset-pipeline", "src", "blender"
    ),
)

import ctm_blockout as kit  # noqa: E402
import ctm_lib as lib  # noqa: E402

ASSET_ID = "desk_duster_v0"
WOOD, BRASS, BRISTLE = 10, 11, 12  # palette rows after the custodian's 0..9
SLOT_NAMES = {WOOD: "wood", BRASS: "brass", BRISTLE: "bristle"}
HEAD_Y = -0.096
TIP_Z = -0.0155


def build(lod):
    b = kit.Builder(f"{ASSET_ID}_LOD{lod}")
    nu = (16, 10, 6)[lod]
    # Handle: tapered oval, rounded back end, origin = grip.
    b.add_tube(
        [(0.0, 0.048, 0.0), (0.0, 0.01, 0.0), (0.0, -0.035, 0.001), (0.0, -0.06, 0.0015)],
        [0.0085, 0.0092, 0.0068, 0.0062],
        WOOD,
        0,
        nu,
        (2, 1, 1)[lod],
        0.78,
        (True, False),
    )
    b.add_tube([(0.0, -0.058, 0.0015), (0.0, -0.074, 0.002)], [0.0074, 0.0074], BRASS, 0, nu, 1, 0.8, (False, False))
    b.add_superellipsoid((0.0, HEAD_Y, 0.002), (0.0115, 0.025, 0.0068), WOOD, 0, 4.0, 4.0, (16, 10, 6)[lod], (8, 6, 4)[lod])
    if lod == 0:
        for i in range(8):
            y = -0.077 + (-0.116 + 0.077) * i / 7
            for x in (-0.0066, 0.0, 0.0066):
                b.add_superellipsoid((x, y, -0.0098), (0.0029, 0.0023, 0.0058), BRISTLE, 0, 3.0, 3.0, 6, 3)
    else:
        b.add_superellipsoid((0.0, HEAD_Y, -0.0098), (0.0098, 0.022, 0.0058), BRISTLE, 0, 5.0, 5.0, (10, 4)[lod - 1], 4)
    return b


def main():
    args = lib.cli_args()
    steps = lib.Steps()
    lib.reset_scene()
    lib.ensure_world(ao_distance=0.02)
    material = kit.flat_material(ASSET_ID)
    lods = []
    for lod in range(3):
        obj = build(lod).to_object(f"{ASSET_ID}_LOD{lod}", material)
        kit.shade_smooth(obj, 50.0)
        lods.append(obj)
    steps.mark("geometry")
    for obj in lods:
        kit.bake_ao_into_green(obj, samples=32, floor=0.6)
    steps.mark("vertex AO")
    sockets = [kit.add_socket("socket_contact", (0.0, HEAD_Y, TIP_Z))]
    size = kit.export_glb(args.out, lods + sockets)
    steps.mark("export")
    low, top = lib.bounds(lods[0])
    areas = kit.slot_areas(lods[0], SLOT_NAMES)
    total = sum(areas.values())
    lib.write_report(
        args.report,
        {
            "asset": ASSET_ID,
            "class": "handTool",
            "placeholder": True,
            "sizeM": [round(top[i] - low[i], 4) for i in range(3)],
            "lodTriangles": [lib.triangle_count(o) for o in lods],
            "slotShare": {k: round(v / total, 4) for k, v in areas.items()},
            "sockets": [s.name for s in sockets],
            "rawBytes": size,
            "steps": steps.items,
            "totalSeconds": steps.total(),
        },
    )
    print(f"[ctm] {ASSET_ID}: LOD triangles {[lib.triangle_count(o) for o in lods]}", flush=True)


main()
