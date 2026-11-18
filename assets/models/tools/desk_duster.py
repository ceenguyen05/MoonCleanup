"""Source script: desk_duster (T1 Desk Duster, production, M1-W4-T07).

Brightside's ceremonial desk brush (naming bible T1): polished wood handle, brass ferrule and crescent plate, graphite
bristle tufts; 17.8 cm, absurdly small in the glove. Same grip origin, axis and contact socket as desk_duster_v0, so
the W3-T07 scrub pose (bristle tips pinned to the stroke) carries over. Original procedural asset.

    blender --background --python assets/models/tools/desk_duster.py -- --out <raw.glb> --report <json> --texdir <dir>
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

ASSET_ID = "desk_duster"
WOOD, BRASS, BRISTLE = 10, 11, 12
NAMES = {WOOD: "wood", BRASS: "brass", BRISTLE: "bristle"}
HEAD_Y = -0.096
TIP_Z = -0.0155
ROT_X = Matrix.Rotation(math.radians(90.0), 4, "X")


def build(lod):
    b = kit.Builder(f"{ASSET_ID}_LOD{lod}")
    nu = (24, 12, 6)[lod]
    # Handle: tapered oval wood, rounded pommel at the back, origin = grip.
    b.add_tube(
        [(0.0, 0.05, 0.0), (0.0, 0.03, 0.0), (0.0, 0.0, 0.0), (0.0, -0.035, 0.001), (0.0, -0.058, 0.0015)],
        [0.0078, 0.0094, 0.0092, 0.0069, 0.0062],
        WOOD, 0, nu, (3, 1, 1)[lod], 0.8, (True, False),
    )
    if lod < 2:
        b.add_torus((0.0, 0.043, 0.0), 0.0083, 0.0016, BRASS, 0, nu, (6, 4)[lod], (1.0, 0.8), ROT_X)
    b.add_tube([(0.0, -0.056, 0.0015), (0.0, -0.075, 0.002)], [0.0074, 0.0076], BRASS, 0, nu, 1, 0.82, (False, False))
    # Head block: rounded wood with a brass crescent plate on top.
    b.add_superellipsoid((0.0, HEAD_Y, 0.002), (0.0118, 0.026, 0.007), WOOD, 0, 4.0, 4.0, (24, 12, 6)[lod], (10, 6, 4)[lod])
    if lod == 0:
        arc = [(0.006 * math.cos(math.radians(a)), HEAD_Y + 0.009 * math.sin(math.radians(a)), 0.0092) for a in range(110, 251, 20)]
        b.add_tube(arc, [0.0014] * len(arc), BRASS, 0, 6, 1, 0.6, (True, True))
        for i in range(8):
            y = -0.077 + (-0.116 + 0.077) * i / 7
            for x in (-0.0068, 0.0, 0.0068):
                b.add_superellipsoid((x, y, -0.0098), (0.003, 0.0024, 0.006), BRISTLE, 0, 2.6, 3.0, 8, 4)
    elif lod == 1:
        for i in range(4):
            y = -0.08 + (-0.112 + 0.08) * i / 3
            b.add_superellipsoid((0.0, y, -0.0098), (0.0098, 0.0045, 0.0058), BRISTLE, 0, 4.0, 3.0, 8, 4)
    else:
        b.add_superellipsoid((0.0, HEAD_Y, -0.0098), (0.0098, 0.022, 0.0058), BRISTLE, 0, 5.0, 5.0, 6, 4)
    return b


prod.tool_main(ASSET_ID, build, NAMES, lambda: [kit.add_socket("socket_contact", (0.0, HEAD_Y, TIP_Z))], ao_distance=0.02)
