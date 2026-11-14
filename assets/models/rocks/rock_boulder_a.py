"""Source script: rock_boulder_a (rock-kit class, 1-3 m boulder size class, variant A).

Original procedural asset for Clean The Moon! (M0-W0-T06). No external meshes or textures.
Run through the pipeline (`tools/asset-pipeline/src/build.ts`) or directly:
    blender --background --python assets/models/rocks/rock_boulder_a.py -- --out <raw.glb> --report <json> --texdir <dir>
"""

import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "tools", "asset-pipeline", "src", "blender"))

import ctm_lib as lib  # noqa: E402
import ctm_rock as rock  # noqa: E402

ASSET_ID = "rock_boulder_a"
PARAMS = {
    "seed": 4107,
    "size": (1.9, 1.5, 1.35),  # metres before the base is flattened into the ground
    "tex_size": 1024,  # art-direction section 9: 1024 px per rock size class
    "lod_tris": (2400, 300, 60),  # art-direction section 9: 1-3k -> 300 -> 60
}

args = lib.cli_args()
steps = lib.Steps()
lib.reset_scene()
lods, metrics = rock.make_rock(ASSET_ID, PARAMS["seed"], PARAMS["size"], PARAMS["tex_size"], PARAMS["lod_tris"], args.texdir, steps)
raw_bytes = lib.export_glb(args.out, lods)
steps.mark("glTF export")
metrics.update({"id": ASSET_ID, "rawGlbBytes": raw_bytes, "steps": steps.items, "blenderSeconds": steps.total()})
lib.write_report(args.report, metrics)
print(f"[ctm] {ASSET_ID}: LOD triangles {metrics['lodTriangles']}, raw {raw_bytes} bytes, {steps.total()}s")
