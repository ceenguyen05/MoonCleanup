"""Source script: bristle_broom (T3 Bristle Broom, production, M1-W4-T07).

Full-length push broom (naming bible T3): brushed aluminium shaft with a graphite grip sleeve, graphite head block on
an ivory cap with a teal stripe, two rows of graphite bristle tufts, 0.45 m wide (the sim contact width). Modelled in
the hold-world frame (ctm_production.HOLD_DEG): in the poser's hold pose the head rests on the ground ahead.
Original procedural asset.

    blender --background --python assets/models/tools/bristle_broom.py -- --out <raw.glb> --report <json> --texdir <dir>
"""

import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "tools", "asset-pipeline", "src", "blender")
)

import ctm_blockout as kit  # noqa: E402
import ctm_production as prod  # noqa: E402

ASSET_ID = "bristle_broom"
SUIT, BELLOWS, GRAPHITE, STEEL, BRISTLE = 0, 1, 2, 3, 12
NAMES = {SUIT: "ivory", BELLOWS: "teal", GRAPHITE: "graphite", STEEL: "steel", BRISTLE: "bristle"}
G = prod.HOLD_GROUND_Z
HALF_W = 0.225
HEAD = (0.1, -0.42, G + 0.1)  # head block centre (x toward the body centre, -y forward)


def build(lod):
    b = kit.Builder(f"{ASSET_ID}_LOD{lod}")
    nu = (24, 10, 6)[lod]
    top = (-0.04, 0.12, 0.27)
    joint = (HEAD[0], HEAD[1] + 0.012, HEAD[2] + 0.03)
    b.add_tube([top, (0.0, 0.0, 0.0), joint], [0.0145, 0.0145, 0.0145], STEEL, 0, nu, 1, 1.0, (False, False))
    if lod < 2:
        b.add_tube([tuple(v * 1.06 for v in top), top], [0.017, 0.017], GRAPHITE, 0, nu, (2, 1)[lod], 1.0, (True, False))
    if lod < 2:
        d = tuple(joint[i] - top[i] for i in range(3))
        b.add_tube([tuple(-0.07 * v for v in d), tuple(0.07 * v for v in d)], [0.0175, 0.0175], GRAPHITE, 0, nu, 1, 1.0, (True, True))
    b.add_superellipsoid(HEAD, (HALF_W, 0.036, 0.022), GRAPHITE, 0, 6.0, 4.0, (32, 10, 6)[lod], (8, 6, 4)[lod])
    b.add_superellipsoid((HEAD[0], HEAD[1], HEAD[2] + 0.022), (HALF_W - 0.01, 0.03, 0.01), SUIT, 0, 6.0, 4.0, (32, 10, 6)[lod], (6, 4, 4)[lod])
    if lod < 2:
        b.add_superellipsoid((HEAD[0], HEAD[1] - 0.031, HEAD[2] + 0.004), (HALF_W - 0.03, 0.0035, 0.007), BELLOWS, 0, 6.0, 4.0, 12, 4)
        b.add_superellipsoid((joint[0], joint[1], joint[2] - 0.004), (0.022, 0.022, 0.018), STEEL, 0, 3.0, 3.0, 12, 6)
    if lod == 0:
        for row, dy in enumerate((-0.016, 0.016)):
            for i in range(13):
                x = HEAD[0] - HALF_W + 0.018 + (2 * HALF_W - 0.036) * i / 12
                b.add_superellipsoid((x + 0.007 * row, HEAD[1] + dy, G + 0.04), (0.012, 0.012, 0.04), BRISTLE, 0, 2.6, 3.0, 8, 4)
    elif lod == 1:
        for i in range(5):
            x = HEAD[0] - HALF_W + 0.045 + (2 * HALF_W - 0.09) * i / 4
            b.add_superellipsoid((x, HEAD[1], G + 0.04), (0.04, 0.03, 0.04), BRISTLE, 0, 4.0, 3.0, 8, 4)
    else:
        b.add_superellipsoid((HEAD[0], HEAD[1], G + 0.04), (HALF_W - 0.01, 0.03, 0.04), BRISTLE, 0, 6.0, 4.0, 8, 4)
    return b


prod.tool_main(ASSET_ID, build, NAMES, lambda: [kit.add_socket("socket_contact", (HEAD[0], HEAD[1], G))], hold_frame=True, ao_distance=0.08)
