"""Source script: crescent_squeegee (T2 Crescent Squeegee, production, M1-W4-T07).

Stiff hand squeegee shaped like Brightside's crescent logo (naming bible T2): ivory crescent holder with a teal inlay,
black rubber blade (0.28 m, the sim contact width), scuffed orange grip (the only orange, kept small), steel neck.
Same grip frame as the Desk Duster (handle along the hand, head ahead). Original procedural asset.

    blender --background --python assets/models/tools/crescent_squeegee.py -- --out <raw.glb> --report <json> --texdir <dir>
"""

import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "tools", "asset-pipeline", "src", "blender")
)

from mathutils import Matrix  # noqa: E402

import ctm_blockout as kit  # noqa: E402
import ctm_production as prod  # noqa: E402

ASSET_ID = "crescent_squeegee"
SUIT, BELLOWS, GRAPHITE, STEEL, RUBBER, GRIP = 0, 1, 2, 3, 14, 15
NAMES = {SUIT: "ivory", BELLOWS: "teal", GRAPHITE: "graphite", STEEL: "steel", RUBBER: "rubber", GRIP: "orangeGrip"}
HALF_W = 0.14
HEAD_Y = -0.115
BOW = 0.03
ROT_X = Matrix.Rotation(math.radians(90.0), 4, "X")


def arc(n, dz=0.0, span=1.0):
    pts = []
    for i in range(n + 1):
        s = -span + 2.0 * span * i / n
        pts.append((s * HALF_W, HEAD_Y - BOW * (1.0 - s * s), dz))
    return pts


def build(lod):
    b = kit.Builder(f"{ASSET_ID}_LOD{lod}")
    nu = (24, 12, 6)[lod]
    n = (24, 12, 4)[lod]
    # Orange grip with finger ribs, graphite end cap, steel neck to the holder.
    b.add_tube(
        [(0.0, 0.125, 0.0), (0.0, 0.08, 0.0), (0.0, 0.04, 0.0), (0.0, 0.0, 0.0), (0.0, -0.02, 0.0)],
        [0.0155, 0.0165, 0.0165, 0.0155, 0.013], GRIP, 0, nu, 1, 0.85, (False, False),
    )
    if lod < 2:
        b.add_tube([(0.0, 0.124, 0.0), (0.0, 0.14, 0.0)], [0.0158, 0.013], GRAPHITE, 0, nu, (2, 1)[lod], 0.85, (False, True))
    if lod == 0:
        for y in (0.1, 0.075, 0.05):
            b.add_torus((0.0, y, 0.0), 0.0165, 0.0024, GRIP, 0, nu, 6, (1.0, 0.85), ROT_X)
    b.add_tube(
        [(0.0, -0.02, 0.0), (0.0, -0.06, 0.004), (0.0, HEAD_Y - BOW + 0.012, 0.008)],
        [0.009, 0.008, 0.01], STEEL, 0, (16, 8, 4)[lod], 1, 1.0, (False, False),
    )
    # Crescent holder (ivory) with a teal Brightside inlay, rubber blade under it.
    b.add_tube(arc(n, 0.012), [0.019] * (n + 1), SUIT, 0, (12, 8, 4)[lod], (2, 1, 1)[lod], 0.75, (True, True))
    if lod < 2:
        b.add_tube(arc(n // 2, 0.027, 0.55), [0.0045] * (n // 2 + 1), BELLOWS, 0, 6, 1, 0.6, (True, True))
    b.add_tube(arc(n, -0.014), [0.009] * (n + 1), RUBBER, 0, (10, 6, 4)[lod], 1, 2.2, (True, True))
    if lod == 0:
        for s in (-0.7, 0.7):
            b.add_superellipsoid((s * HALF_W, HEAD_Y - BOW * (1.0 - s * s), -0.002), (0.008, 0.012, 0.016), GRAPHITE, 0, 4.0, 4.0, 8, 4)
    return b


prod.tool_main(ASSET_ID, build, NAMES, lambda: [kit.add_socket("socket_contact", (0.0, HEAD_Y - BOW, -0.034))], ao_distance=0.03)
