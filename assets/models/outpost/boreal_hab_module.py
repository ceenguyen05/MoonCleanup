"""Source script: boreal_hab_module (outpost module, hard-surface class).

A pre-fab horizontal capsule on teal legs (art-direction section 7.1): ivory panel shell, teal frame ribs with
arrayed fasteners, end hatch with yellow grab rails, entry platform with a hazard edge and a ladder, portholes,
roof vents, service pipes, antenna beacon and a work lamp. Original procedural asset for Clean The Moon!
(M0-W0-T06): kitbash library v0 + Brightside trim sheet v0, no external meshes or textures.

    blender --background --python assets/models/outpost/boreal_hab_module.py -- --out <raw.glb> --report <json> --texdir <dir>
"""

import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "tools", "asset-pipeline", "src", "blender"))

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix  # noqa: E402

import ctm_kit as kitlib  # noqa: E402
import ctm_lib as lib  # noqa: E402
import ctm_trim as trim  # noqa: E402

ASSET_ID = "boreal_hab_module"
R = 1.5  # shell radius (m)
LH = 2.0  # half length of the cylindrical section: 5 panel rings of 0.8 m
DX = 0.91  # dome ellipse semi-axis along the module
RE = 0.85  # radius of the flat end faces
ZC = 2.0  # height of the module axis above the ground
PHI_E = math.acos(RE / R)
XE = LH + DX * math.sin(PHI_E)  # x of the flat end faces
G = -ZC  # ground plane in module space
RIBS = (-2.0, -1.2, -0.4, 0.4, 1.2, 2.0)
DOME_STEPS = {0: 8, 1: 4, 2: 2}


def rot_x(angle):
    return Matrix.Rotation(angle, 4, "X")


def build(kit, lod):
    detail = kit.detail
    frame = kitlib.frame_x

    # --- Shell: one closed surface of revolution; each panel ring / dome gore band is one trim span.
    steps = DOME_STEPS[lod]
    profile = [(-XE, 0.0), (-XE, 0.44), (-XE, 0.56), (-XE, RE)]
    spans = [(0, 3, "panel")]
    start = len(profile) - 1
    for k in range(1, steps + 1):
        phi = PHI_E * (1.0 - k / steps)
        profile.append((-LH - DX * math.sin(phi), R * math.cos(phi)))
    spans += [(start, start + steps // 2, "panel"), (start + steps // 2, start + steps, "panel")]
    for left, right in zip(RIBS, RIBS[1:]):
        start = len(profile) - 1
        inner = (0.10, 0.24) if lod < 2 else ()
        for offset in inner:
            profile.append((left + offset, R))
        for offset in reversed(inner):
            profile.append((right - offset, R))
        profile.append((right, R))
        spans.append((start, len(profile) - 1, "panel"))
    start = len(profile) - 1
    for k in range(1, steps + 1):
        phi = PHI_E * k / steps
        profile.append((LH + DX * math.sin(phi), R * math.cos(phi)))
    spans += [(start, start + steps // 2, "panel"), (start + steps // 2, start + steps, "panel")]
    start = len(profile) - 1
    profile += [(XE, 0.76), (XE, 0.0)]
    spans.append((start, start + 2, "teal_deep"))
    kit.lathe(profile, spans, u_tiles=3)

    # --- Teal frame ribs with arrayed fasteners.
    for a in RIBS:
        kit.ring(a - 0.07, a + 0.07, R - 0.02, R + 0.07, "teal", chamfer=0.015, u_tiles=3)
        if detail["bolts"]:
            for k in range(24):
                kit.bolt(rot_x(2 * math.pi * (k + 0.5) / 24) @ Matrix.Translation((a, R + 0.066, 0.0)) @ Matrix.Rotation(math.pi / 2, 4, "Z"))

    # --- Hatch end (+X): frame, quartered door, porthole, hinge, latch, grab rails, status light.
    kit.ring(XE - 0.02, XE + 0.09, 0.56, 0.72, "teal", chamfer=0.015, inner=True)
    kit.lathe([(XE + 0.02, 0.56), (XE + 0.05, 0.53), (XE + 0.065, 0.24), (XE + 0.065, 0.0)], [(0, 1, "ivory"), (1, 2, "panel"), (2, 3, "ivory")], u_tiles=1)
    kit.ring(XE + 0.05, XE + 0.09, 0.15, 0.21, "steel", chamfer=0.008, inner=True, segs=detail["small"])
    kit.disc(XE + 0.04, XE + 0.075, 0.155, "glass", segs=detail["small"], chamfer=0.0)
    kit.box((0.07, 0.10, 0.34), Matrix.Translation((XE + 0.10, -0.64, 0.0)), "steel", bevel=0.012)
    for side in (-1.0, 1.0):
        kit.tube([(XE - 0.05, side * 0.80, -0.40), (XE + 0.14, side * 0.80, -0.40), (XE + 0.14, side * 0.80, 0.40), (XE - 0.05, side * 0.80, 0.40)], 0.021, "yellow")
    kit.box((0.10, 0.24, 0.09), Matrix.Translation((XE + 0.03, 0.0, 0.80)), "teal_deep", bevel=0.012)
    kit.box((0.03, 0.17, 0.045), Matrix.Translation((XE + 0.085, 0.0, 0.80)), "emit_teal", bevel=0.006)
    if detail["greebles"]:
        kit.tube([(XE + 0.06, 0.30, 0.0), (XE + 0.14, 0.30, 0.0), (XE + 0.14, 0.47, 0.0), (XE + 0.06, 0.47, 0.0)], 0.016, "steel", corner=0.03)
        for k in range(12):
            kit.bolt(rot_x(2 * math.pi * k / 12) @ Matrix.Translation((XE + 0.085, 0.64, 0.0)), radius=0.02)

    # --- Work lamp over the hatch (amber lens = emissive strip) on a bracket.
    lamp_origin = (LH + 0.42, 0.0, 1.50)
    kit.box((0.09, 0.09, 0.26), Matrix.Translation((LH + 0.36, 0.0, 1.42)), "teal_deep", bevel=0.012)
    kit.disc(-0.11, 0.11, 0.12, "graphite", frame(lamp_origin, (0.85, 0.0, -0.5)), chamfer=0.015, cap_strip="emit_amber")

    # --- Blank end (-X): porthole with a bolted steel ring.
    blank = frame((-XE, 0.0, 0.0), (-1.0, 0.0, 0.0))
    kit.ring(-0.02, 0.06, 0.30, 0.40, "steel", blank, chamfer=0.012, inner=True)
    kit.disc(-0.02, 0.03, 0.305, "glass", blank, chamfer=0.0, segs=detail["segs"] // 2)
    if detail["bolts"]:
        for k in range(12):
            kit.bolt(blank @ rot_x(2 * math.pi * k / 12) @ Matrix.Translation((0.0, 0.5, 0.0)), radius=0.022)

    # --- Side portholes, service pipes and brackets.
    for side in (-1.0, 1.0):
        alpha = math.radians(14.0)
        direction = (0.0, side * math.cos(alpha), math.sin(alpha))
        port = frame([c * (R - 0.03) for c in direction], direction)
        kit.ring(0.0, 0.09, 0.22, 0.30, "teal", port, chamfer=0.012, inner=True, segs=detail["small"] * 2)
        kit.disc(0.0, 0.05, 0.225, "glass", port, chamfer=0.0)
        beta = math.radians(-27.0)
        radial = (0.0, side * math.cos(beta), math.sin(beta))
        near = [c * (R - 0.02) for c in radial]
        far = [c * (R + 0.12) for c in radial]
        if detail["greebles"]:
            kit.tube([(-1.8, near[1], near[2]), (-1.8, far[1], far[2]), (1.8, far[1], far[2]), (1.8, near[1], near[2])], 0.035, "steel", corner=0.08)
            for a in (-1.6, -0.8, 0.0, 0.8, 1.6):
                angle = beta if side > 0 else math.pi - beta
                kit.box((0.07, 0.12, 0.11), rot_x(angle) @ Matrix.Translation((a, R + 0.07, 0.0)), "teal_deep", bevel=0.01)

    # --- Roof: vents, antenna mast with beacon.
    for a in (-0.8, 0.8):
        kit.box((0.56, 0.42, 0.10), Matrix.Translation((a, 0.0, R + 0.02)), "teal_deep", bevel=0.015)
        kit.box((0.50, 0.36, 0.12), Matrix.Translation((a, 0.0, R + 0.12)), "graphite", bevel=0.02)
    mast = (-1.6, 0.0, R - 0.02)
    kit.disc(0.0, 0.09, 0.075, "teal_deep", frame(mast, (0.0, 0.0, 1.0)), chamfer=0.012)
    kit.tube([mast, (-1.6, 0.0, R + 1.15)], 0.018, "steel")
    kit.disc(0.0, 0.06, 0.035, "emit_amber", frame((-1.6, 0.0, R + 1.13), (0.0, 0.0, 1.0)), chamfer=0.012, segs=max(8, detail["small"] // 2))

    # --- Legs: two pairs of splayed teal struts, cross beams, jack pads, tie tubes.
    for a in (-1.2, 1.2):
        kit.beam((a, -1.68, -1.61), (a, 1.68, -1.61), 0.12, 0.10, "teal_deep", bevel=0.015, up=(1.0, 0.0, 0.0))
        for side in (-1.0, 1.0):
            kit.beam((a, side * 1.20, -0.95), (a, side * 1.85, G + 0.16), 0.16, 0.14, "teal", bevel=0.02, up=(1.0, 0.0, 0.0))
            pad = frame((a, side * 1.85, G), (0.0, 0.0, 1.0))
            kit.disc(0.0, 0.07, 0.26, "graphite", pad, chamfer=0.015)
            kit.disc(0.07, 0.22, 0.07, "steel", pad, chamfer=0.01, segs=max(8, detail["small"] // 2))
    if detail["greebles"]:
        for side in (-1.0, 1.0):
            kit.tube([(-1.2, side * 1.85, G + 0.2), (1.2, side * 1.85, G + 0.2)], 0.03, "steel")

    # --- Entry platform: deck planks, hazard edge beams, braces, legs, yellow handrails, ladder.
    zd = -0.66
    for k in range(4):
        kit.box((0.25, 1.5, 0.05), Matrix.Translation((2.92 + 0.27 * k, 0.0, zd - 0.025)), "deck", bevel=0.008)
    for side in (-1.0, 1.0):
        kit.beam((2.78, side * 0.78, zd - 0.06), (3.87, side * 0.78, zd - 0.06), 0.07, 0.12, "hazard", bevel=0.012)
        kit.beam((2.45, side * 0.60, -1.13), (3.75, side * 0.60, zd - 0.11), 0.08, 0.08, "teal", bevel=0.012)
        kit.beam((3.80, side * 0.72, zd - 0.05), (3.80, side * 0.86, G + 0.05), 0.09, 0.09, "teal", bevel=0.012, up=(1.0, 0.0, 0.0))
        kit.disc(0.0, 0.05, 0.15, "graphite", frame((3.80, side * 0.86, G), (0.0, 0.0, 1.0)), chamfer=0.012, segs=max(8, detail["small"] // 2))
        kit.tube([(2.86, side * 0.74, zd - 0.02), (2.86, side * 0.74, zd + 0.95), (3.82, side * 0.74, zd + 0.95), (3.82, side * 0.74, zd - 0.02)], 0.022, "yellow", corner=0.09)
        kit.tube([(3.88, side * 0.28, zd + 0.02), (4.27, side * 0.28, G + 0.02)], 0.022, "steel")
        if detail["greebles"]:
            kit.tube([(2.86, side * 0.74, zd + 0.48), (3.82, side * 0.74, zd + 0.48)], 0.014, "steel")
    if detail["greebles"]:
        for k in range(1, 6):
            t = k / 6.0
            x = 3.88 + (4.27 - 3.88) * t
            z = (zd + 0.02) + (G + 0.02 - zd - 0.02) * t
            kit.tube([(x, -0.28, z), (x, 0.28, z)], 0.014, "steel")


def main():
    args = lib.cli_args()
    steps = lib.Steps()
    lib.reset_scene()
    lib.ensure_world(0.8)
    sheet = trim.TrimSheet()
    images, texture_bytes = sheet.generate(args.texdir, "trim_boreal_v0")
    material = lib.pbr_material("trim_boreal_v0", base=images["basecolor"], normal=images["normal"], orm=images["orm"], emissive=images["emissive"], vertex_ao=True)
    steps.mark("trim sheet")

    lods, shares = [], None
    for lod in (0, 1, 2):
        kit = kitlib.Kit(sheet, lod)
        build(kit, lod)
        if lod == 0:
            shares = kit.area_shares()
        bmesh.ops.translate(kit.bm, verts=kit.bm.verts[:], vec=(0.0, 0.0, ZC))
        obj = kit.to_object(f"{ASSET_ID}_LOD{lod}")
        lib.triangulate(obj)
        lib.shade(obj, sharp_angle_deg=50.0, weighted=True)
        lib.assign_material(obj, material)
        obj["ctm_lod"] = lod
        obj["ctm_class"] = "outpostModule"
        lods.append(obj)
    steps.mark("geometry (3 LODs)")

    # Vertex AO, baked with a temporary ground plane so legs and the belly get contact occlusion.
    ground_bm = bmesh.new()
    bmesh.ops.create_grid(ground_bm, x_segments=1, y_segments=1, size=20.0)
    ground = lib.object_from_bmesh("ctm_ground", ground_bm)
    for obj in lods:
        for other in lods:
            other.hide_render = other is not obj
        lib.bake_vertex_ao(obj, samples=48)
    for obj in lods:
        obj.hide_render = False
    bpy.data.objects.remove(ground)
    steps.mark("vertex AO bake")

    raw_bytes = lib.export_glb(args.out, lods, vertex_color=True)
    steps.mark("glTF export")
    low, top = lib.bounds(lods[0])
    density = lib.texel_density(lods[0], trim.SIZE, trim.SIZE)
    metrics = {
        "id": ASSET_ID,
        "class": "outpostModule",
        "sizeM": [round(top[i] - low[i], 3) for i in range(3)],
        "lodTriangles": [lib.triangle_count(obj) for obj in lods],
        "segmentsPer360": {"shellAndRibs": kitlib.DETAIL[0]["segs"], "smallHeroCylinders": kitlib.DETAIL[0]["small"]},
        "bevelSegments": kitlib.DETAIL[0]["bevel"],
        "textureSize": trim.SIZE,
        "texturePngBytes": texture_bytes,
        "texelDensityPxPerM": density,
        "paletteAreaShares": shares,
        "materials": 1,
        "rawGlbBytes": raw_bytes,
        "steps": steps.items,
        "blenderSeconds": steps.total(),
    }
    lib.write_report(args.report, metrics)
    print(f"[ctm] {ASSET_ID}: LOD triangles {metrics['lodTriangles']}, raw {raw_bytes} bytes, {steps.total()}s")


main()
