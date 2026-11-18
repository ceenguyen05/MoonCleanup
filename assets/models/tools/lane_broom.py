"""Source script: lane_broom (T4 Lane Broom, production, M1-W4-T07).

Wide flat head on a T-handle (naming bible T4): graphite shaft, steel T-bar grip, ivory head shell with a teal lane
stripe, a long graphite bristle strip and safety-yellow end caps (small, under the 10 % palette share), 0.75 m wide
(the sim contact width; art-direction 5.3 says 1.2 m, the sim footprint wins). Hold-world frame like the Bristle Broom.
Original procedural asset.

    blender --background --python assets/models/tools/lane_broom.py -- --out <raw.glb> --report <json> --texdir <dir>
"""

import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "tools", "asset-pipeline", "src", "blender")
)

import ctm_blockout as kit  # noqa: E402
import ctm_production as prod  # noqa: E402

ASSET_ID = "lane_broom"
SUIT, BELLOWS, GRAPHITE, STEEL, HAZARD, BRISTLE = 0, 1, 2, 3, 4, 12
NAMES = {SUIT: "ivory", BELLOWS: "teal", GRAPHITE: "graphite", STEEL: "steel", HAZARD: "hazard", BRISTLE: "bristle"}
G = prod.HOLD_GROUND_Z
HALF_W = 0.375
HEAD = (0.18, -0.46, G + 0.075)


def build(lod):
    b = kit.Builder(f"{ASSET_ID}_LOD{lod}")
    nu = (24, 10, 6)[lod]
    # T-handle: the grip is the cross bar (origin); the shaft runs from it to the head.
    b.add_tube([(-0.085, 0.0, 0.0), (0.085, 0.0, 0.0)], [0.016, 0.016], STEEL, 0, nu, (2, 1, 1)[lod], 1.0, (True, True))
    if lod < 2:
        b.add_tube([(-0.06, 0.0, 0.0), (0.06, 0.0, 0.0)], [0.0185, 0.0185], GRAPHITE, 0, nu, 1, 1.0, (True, True))
    joint = (HEAD[0], HEAD[1] + 0.01, HEAD[2] + 0.04)
    b.add_tube([(0.0, 0.0, 0.0), joint], [0.0155, 0.0155], GRAPHITE, 0, nu, 1, 1.0, (False, False))
    if lod < 2:
        b.add_superellipsoid((0.0, 0.0, 0.0), (0.024, 0.024, 0.024), STEEL, 0, 3.0, 3.0, 12, 6)
    b.add_superellipsoid(HEAD, (HALF_W, 0.045, 0.028), SUIT, 0, 8.0, 4.0, (40, 12, 6)[lod], (8, 4, 4)[lod])
    if lod < 2:
        b.add_superellipsoid((HEAD[0], HEAD[1] - 0.04, HEAD[2] + 0.006), (HALF_W - 0.05, 0.004, 0.008), BELLOWS, 0, 8.0, 4.0, 16, 4)
        b.add_superellipsoid((joint[0], joint[1], joint[2] - 0.008), (0.03, 0.026, 0.022), STEEL, 0, 3.0, 3.0, 12, 6)
    for side in (-1, 1):
        b.add_superellipsoid(
            (HEAD[0] + side * (HALF_W + 0.006), HEAD[1], HEAD[2] - 0.006), (0.014, 0.05, 0.038), HAZARD, 0, 4.0, 4.0,
            (12, 8, 4)[lod], (6, 4, 4)[lod],
        )
    if lod == 0:
        for i in range(18):
            x = HEAD[0] - HALF_W + 0.02 + (2 * HALF_W - 0.04) * i / 17
            b.add_superellipsoid((x, HEAD[1], G + 0.025), (0.021, 0.03, 0.03), BRISTLE, 0, 3.0, 3.0, 8, 4)
    else:
        b.add_superellipsoid((HEAD[0], HEAD[1], G + 0.025), (HALF_W - 0.005, 0.03, 0.028), BRISTLE, 0, 6.0, 4.0, (12, 6)[lod - 1], 4)
    return b


prod.tool_main(ASSET_ID, build, NAMES, lambda: [kit.add_socket("socket_contact", (HEAD[0], HEAD[1], G))], hold_frame=True, ao_distance=0.08)
