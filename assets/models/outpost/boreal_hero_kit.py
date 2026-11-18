"""Source script: boreal_hero_kit (Outpost Boreal hero hardware v1, M1-W5-T03).

Four pieces in one GLB so they share one trim-sheet material and one texture set (one download, one material,
one draw per piece per LOD):

  assay_counter   waist-high square counter island: four grated weighing decks (one per pour slot, logistics
                  `assayCounter.pourSlots` = 4), yellow grab rails, central readout tower with four LED panels
                  and a teal status beacon (art-direction 7.2: "big flip-digit/LED readout")
  receiving_gate  arch over a Glide Rail end with a scanner ring (teal emissive bore) (7.2)
  dump_plate      4 m grated pad (sim DUMP_PLATE_RADIUS_M = 2) with yellow/graphite chevron edges and corner lamps (7.2)
  flood_mast      6 m tripod work-light mast, twin warm floods (7.1 "warm work-light masts")

Each piece is `<piece>_LOD0..2` (pivot = ground centre, +X = the piece's front: the Gate's puck travel direction,
the floods' aim) plus anchor empties for the VFX / readout / light layers (`<piece>_<anchor>`). Original procedural
asset for Clean The Moon!: kitbash library v0 + Brightside trim sheet v1; no external meshes or textures.

    blender --background --python assets/models/outpost/boreal_hero_kit.py -- --out <raw.glb> --report <json> --texdir <dir>
"""

import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "tools", "asset-pipeline", "src", "blender"))

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import ctm_kit as kitlib  # noqa: E402
import ctm_lib as lib  # noqa: E402
import ctm_trim as trim  # noqa: E402

ASSET_ID = "boreal_hero_kit"
CLASS = "outpostHeroKit"
UP = (0.0, 0.0, 1.0)
# Box V-band density per LOD (fraction of the 320 px/m U density): LOD0 meets the 256 px/m bar (art-direction 13.3).
V_BANDS = {0: 0.8, 1: 0.35, 2: 0.15}


def T(x, y, z):
    return Matrix.Translation((x, y, z))


def RZ(angle):
    return Matrix.Rotation(angle, 4, "Z")


def vertical(origin):
    return kitlib.frame_x(origin, UP)


# ------------------------------------------------------------------------------------------ Assay Counter

COUNTER_TOP = 1.09  # waist height (the custodian is ~1.8 m)
DECK_R = 0.80  # radial centre of each weighing deck


def assay_counter(kit, lod, anchors):
    d = kit.detail
    kit.box((2.36, 2.36, 0.14), T(0, 0, 0.07), "graphite", bevel=0.02)
    kit.box((2.12, 2.12, 0.80), T(0, 0, 0.54), "panel", bevel=0.03)
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            kit.box((0.18, 0.18, 0.86), T(sx * 1.06, sy * 1.06, 0.57), "teal", bevel=0.03)
            if d["bolts"]:
                for k in range(3):
                    z = 0.30 + 0.25 * k
                    kit.bolt(kitlib.frame_x((sx * 1.15, sy * 1.06, z), (sx, 0.0, 0.0)), radius=0.018, height=0.016)
                    kit.bolt(kitlib.frame_x((sx * 1.06, sy * 1.15, z), (0.0, sy, 0.0)), radius=0.018, height=0.016)
    kit.box((2.24, 2.24, 0.08), T(0, 0, 0.98), "teal_deep", bevel=0.015)
    kit.box((2.40, 2.40, 0.07), T(0, 0, COUNTER_TOP - 0.035), "ivory", bevel=0.025)

    for k in range(4):
        a = k * math.pi / 2.0
        rot = RZ(a)
        # Weighing deck: dark recess, grated pan, brushed tray rim.
        kit.box((0.56, 0.96, 0.02), rot @ T(DECK_R, 0, COUNTER_TOP + 0.005), "graphite", bevel=0.006)
        kit.box((0.48, 0.86, 0.028), rot @ T(DECK_R, 0, COUNTER_TOP + 0.02), "grate", bevel=0.004)
        for side in (-1.0, 1.0):
            kit.box((0.56, 0.04, 0.045), rot @ T(DECK_R, side * 0.46, COUNTER_TOP + 0.025), "steel", bevel=0.008)
            kit.box((0.04, 0.88, 0.045), rot @ T(DECK_R + side * 0.26, 0, COUNTER_TOP + 0.025), "steel", bevel=0.008)
        # Yellow grab rail along the outer face (safety colour: grab rails only).
        y0, y1, xo = -0.82, 0.82, 1.26
        pts = [(1.07, y0, 0.86), (xo, y0, 0.86), (xo, y1, 0.86), (1.07, y1, 0.86)]
        kit.tube([rot @ Vector(p) for p in pts], 0.024, "yellow", corner=0.07)
        # Pour-slot indicator lamp on the face, under the rail.
        kit.box((0.04, 0.30, 0.06), rot @ T(1.075, 0, 0.70), "teal_deep", bevel=0.01)
        kit.box((0.02, 0.22, 0.03), rot @ T(1.095, 0, 0.70), "emit_teal", bevel=0.004)
        anchors.append((f"pour_{k}", rot @ Vector((DECK_R, 0.0, COUNTER_TOP + 0.04))))

    # Readout tower: collar, column, LED head with four faces, ivory cap, beacon.
    kit.box((0.64, 0.64, 0.10), T(0, 0, COUNTER_TOP + 0.05), "teal_deep", bevel=0.015)
    kit.box((0.50, 0.50, 1.25), T(0, 0, COUNTER_TOP + 0.10 + 0.625), "panel", bevel=0.03)
    head_z = 2.70
    kit.box((1.20, 1.20, 0.56), T(0, 0, head_z), "teal_deep", bevel=0.04)
    kit.box((1.28, 1.28, 0.08), T(0, 0, head_z + 0.32), "ivory", bevel=0.025)
    kit.box((1.10, 1.10, 0.06), T(0, 0, head_z - 0.31), "teal", bevel=0.015)
    for k in range(4):
        rot = RZ(k * math.pi / 2.0)
        kit.box((0.04, 1.02, 0.42), rot @ T(0.615, 0, head_z), "graphite", bevel=0.012)
        kit.box((0.02, 0.88, 0.28), rot @ T(0.640, 0, head_z), "emit_amber", bevel=0.004)
        anchors.append((f"readout_{k}", rot @ Vector((0.652, 0.0, head_z))))
    kit.disc(0.0, 0.16, 0.05, "steel", vertical((0, 0, head_z + 0.36)), chamfer=0.01)
    kit.disc(0.0, 0.12, 0.09, "emit_teal", vertical((0, 0, head_z + 0.50)), chamfer=0.03)
    anchors.append(("flash", Vector((0.0, 0.0, head_z + 0.70))))


# ----------------------------------------------------------------------------------------- Receiving Gate

RING_Z = 1.25


def receiving_gate(kit, lod, anchors):
    d = kit.detail
    for sy in (-1.0, 1.0):
        y = sy * 1.55
        kit.box((0.70, 0.62, 0.16), T(0, y, 0.08), "teal_deep", bevel=0.02)
        kit.box((0.44, 0.40, 2.70), T(0, y, 0.16 + 1.35), "panel", bevel=0.03)
        for sx in (-1.0, 1.0):
            kit.box((0.06, 0.06, 2.62), T(sx * 0.21, y - sy * 0.19, 1.51), "teal", bevel=0.012)
        if d["bolts"]:
            for sx in (-1.0, 1.0):
                for k in range(3):
                    kit.bolt(kitlib.frame_x((sx * 0.35, y + (k - 1) * 0.2, 0.16), UP), radius=0.02)
    kit.box((0.50, 3.60, 0.50), T(0, 0, 3.05), "panel", bevel=0.035)
    kit.box((0.58, 3.72, 0.08), T(0, 0, 3.34), "teal", bevel=0.02)
    kit.box((0.52, 3.00, 0.06), T(0, 0, 2.78), "teal_deep", bevel=0.015)
    for sx in (-1.0, 1.0):
        kit.box((0.02, 3.0, 0.06), T(sx * 0.255, 0, 3.12), "emit_teal", bevel=0.004)

    # Scanner ring around the rail axis (+X), teal shell, emissive bore band.
    ring = T(0, 0, RING_Z)
    kit.ring(-0.12, 0.12, 1.0, 1.18, "teal", ring, chamfer=0.02, inner=True, u_tiles=3)
    kit.ring(-0.07, 0.07, 0.975, 1.0, "emit_teal", ring, chamfer=0.0, inner=True, u_tiles=3)
    for sy in (-1.0, 1.0):
        kit.beam((0, sy * 1.16, RING_Z), (0, sy * 1.36, RING_Z), 0.12, 0.12, "steel", bevel=0.012)
    kit.beam((0, 0, RING_Z + 1.16), (0, 0, 2.76), 0.12, 0.12, "steel", bevel=0.012, up=(1.0, 0.0, 0.0))
    anchors.append(("ring", Vector((0.0, 0.0, RING_Z))))

    # Glide Rail end: sleepers, rail body, teal emitter strip, rounded end.
    for x in (-3.0, -2.0, -1.0, 0.0):
        kit.box((0.25, 0.70, 0.08), T(x, 0, 0.04), "graphite", bevel=0.012)
    kit.box((4.2, 0.46, 0.22), T(-1.1, 0, 0.19), "teal_deep", bevel=0.03)
    kit.box((4.2, 0.12, 0.02), T(-1.1, 0, 0.31), "emit_teal", bevel=0.004)
    kit.disc(0.08, 0.30, 0.23, "teal_deep", vertical((1.0, 0, 0)), chamfer=0.03, cap_strip="ivory")
    anchors.append(("rail_end", Vector((1.0, 0.0, 0.32))))


# --------------------------------------------------------------------------------------------- Dump Plate


def dump_plate(kit, lod, anchors):
    # Light apron frame (four deck boxes, so the 4.3 m slab does not need a full-size banded top) around a grated field.
    for k in range(4):
        rot = RZ(k * math.pi / 2.0)
        kit.box((4.30 - 0.40, 0.40, 0.10), rot @ T(0.20, 1.95, 0.05), "deck", bevel=0.02)
    kit.box((3.50, 3.50, 0.12), T(0, 0, 0.07), "grate", bevel=0.006)
    for k in range(4):
        rot = RZ(k * math.pi / 2.0)
        kit.box((0.20, 3.10, 0.04), rot @ T(1.93, 0, 0.12), "hazard", bevel=0.008)
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            kit.box((0.42, 0.42, 0.12), T(sx * 1.93, sy * 1.93, 0.13), "teal", bevel=0.02)
            kit.disc(0.0, 0.06, 0.07, "emit_amber", vertical((sx * 1.93, sy * 1.93, 0.19)), chamfer=0.015)
    anchors.append(("center", Vector((0.0, 0.0, 0.13))))


# --------------------------------------------------------------------------------------------- Flood Mast

MAST_H = 6.2
AIM = Vector((0.8, 0.0, -0.6)).normalized()


def flood_mast(kit, lod, anchors):
    d = kit.detail
    hub = Vector((0.0, 0.0, 1.5))
    for k in range(3):
        a = math.radians(90.0 + 120.0 * k)
        foot = Vector((1.1 * math.cos(a), 1.1 * math.sin(a), 0.06))
        kit.beam(hub, foot, 0.10, 0.10, "teal", bevel=0.015)
        kit.disc(0.0, 0.06, 0.16, "graphite", vertical((foot.x, foot.y, 0.0)), chamfer=0.012)
    kit.ring(0.0, 0.40, 0.07, 0.14, "teal_deep", vertical((0, 0, 1.30)), chamfer=0.02)
    # Pole as a swept tube: U runs along the 6 m length at full density, V wraps the circumference.
    kit.tube([(0.0, 0.0, 0.0), (0.0, 0.0, MAST_H)], 0.07, "steel", segs=d["small"])
    kit.ring(0.0, 0.10, 0.07, 0.10, "teal", vertical((0, 0, 3.0)), chamfer=0.015)
    # Junction box with a status lamp and the cable up the mast.
    kit.box((0.18, 0.26, 0.36), T(0.15, 0, 1.95), "ivory", bevel=0.02)
    kit.box((0.02, 0.10, 0.04), T(0.245, 0, 2.06), "emit_teal", bevel=0.004)
    if d["greebles"]:
        kit.tube([(0.10, 0.0, 2.13), (0.10, 0.0, MAST_H - 0.2), (0.0, 0.0, MAST_H - 0.05)], 0.016, "graphite", corner=0.08)
    # Head: crossbar, two flood housings aimed along AIM.
    top = MAST_H + 0.08
    kit.box((0.14, 1.50, 0.14), T(0, 0, top), "teal", bevel=0.02)
    for k, sy in enumerate((-1.0, 1.0)):
        centre = Vector((0.12, sy * 0.52, top - 0.40))
        frame = kitlib.frame_x(centre, AIM)
        # Closed housing: graphite back, ivory shell, warm lens (lathe walks axis -> out -> front -> axis).
        if d["bevel"]:
            profile = [(-0.24, 0.0), (-0.24, 0.18), (-0.18, 0.26), (0.01, 0.26), (0.04, 0.23), (0.04, 0.0)]
            spans = [(0, 2, "graphite"), (2, 4, "ivory"), (4, 5, "emit_warm")]
        else:
            profile = [(-0.24, 0.0), (-0.24, 0.18), (-0.18, 0.26), (0.04, 0.26), (0.04, 0.0)]
            spans = [(0, 2, "graphite"), (2, 3, "ivory"), (3, 4, "emit_warm")]
        kit.lathe(profile, spans, frame, segs=d["small"])
        kit.ring(0.0, 0.07, 0.24, 0.29, "teal_deep", frame, chamfer=0.012)
        kit.beam((0.0, sy * 0.52, top - 0.07), (0.06, sy * 0.52, top - 0.22), 0.05, 0.05, "steel", bevel=0.008, up=(0.0, 1.0, 0.0))
        anchors.append((f"lamp_{k}", centre + AIM * 0.06))


PIECES = (
    ("assay_counter", assay_counter, (15000, 7500, 3750)),
    ("receiving_gate", receiving_gate, (15000, 7500, 3750)),
    ("dump_plate", dump_plate, (6000, 3000, 1500)),
    ("flood_mast", flood_mast, (6000, 3000, 1500)),
)


def main():
    args = lib.cli_args()
    steps = lib.Steps()
    lib.reset_scene()
    lib.ensure_world(0.8)
    sheet = trim.TrimSheet(trim.STRIPS_V1)
    images, texture_bytes = sheet.generate(args.texdir, "trim_boreal_v1")
    material = lib.pbr_material("trim_boreal_v1", base=images["basecolor"], normal=images["normal"], orm=images["orm"], emissive=images["emissive"], vertex_ao=True)
    steps.mark("trim sheet v1")

    meshes, empties, pieces = [], [], {}
    for piece, build, caps in PIECES:
        info = {"lodTriangles": [], "lodCaps": list(caps)}
        for lod in (0, 1, 2):
            kit = kitlib.Kit(sheet, lod, v_bands=V_BANDS[lod])
            anchors = []
            build(kit, lod, anchors)
            if lod == 0:
                info["paletteAreaShares"] = kit.area_shares()
                for name, at in anchors:
                    empty = bpy.data.objects.new(f"{piece}_{name}", None)
                    empty.location = at
                    bpy.context.scene.collection.objects.link(empty)
                    empties.append(empty)
                info["anchors"] = {name: [round(c, 4) for c in at] for name, at in anchors}
            obj = kit.to_object(f"{piece}_LOD{lod}")
            lib.triangulate(obj)
            lib.shade(obj, sharp_angle_deg=50.0, weighted=True)
            lib.assign_material(obj, material)
            obj["ctm_lod"] = lod
            obj["ctm_piece"] = piece
            obj["ctm_class"] = CLASS
            info["lodTriangles"].append(lib.triangle_count(obj))
            meshes.append(obj)
            if lod == 0:
                low, top = lib.bounds(obj)
                info["sizeM"] = [round(top[i] - low[i], 3) for i in range(3)]
                info["texelDensityPxPerM"] = lib.texel_density(obj, trim.SIZE, trim.SIZE)
        pieces[piece] = info
    steps.mark("geometry (4 pieces x 3 LODs)")

    # Vertex AO per object with only that object and a ground plane visible (pieces share the origin).
    ground_bm = bmesh.new()
    bmesh.ops.create_grid(ground_bm, x_segments=1, y_segments=1, size=20.0)
    ground = lib.object_from_bmesh("ctm_ground", ground_bm)
    for obj in meshes:
        for other in meshes:
            other.hide_render = other is not obj
        lib.bake_vertex_ao(obj, samples=32)
    for obj in meshes:
        obj.hide_render = False
    bpy.data.objects.remove(ground)
    steps.mark("vertex AO bake")

    raw_bytes = lib.export_glb(args.out, meshes + empties, vertex_color=True)
    steps.mark("glTF export")
    metrics = {
        "id": ASSET_ID,
        "class": CLASS,
        "pieces": pieces,
        "segmentsPer360": {"shellAndRibs": kitlib.DETAIL[0]["segs"], "smallHeroCylinders": kitlib.DETAIL[0]["small"]},
        "bevelSegments": kitlib.DETAIL[0]["bevel"],
        "textureSize": trim.SIZE,
        "texturePngBytes": texture_bytes,
        "materials": 1,
        "rawGlbBytes": raw_bytes,
        "steps": steps.items,
        "blenderSeconds": steps.total(),
    }
    lib.write_report(args.report, metrics)
    summary = ", ".join(f"{p} {i['lodTriangles']}" for p, i in pieces.items())
    print(f"[ctm] {ASSET_ID}: {summary}; raw {raw_bytes} bytes, {steps.total()}s")


main()
