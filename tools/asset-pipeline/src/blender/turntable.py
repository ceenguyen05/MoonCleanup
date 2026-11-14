"""Headless Blender turntable: 8 views at 45 degrees, noon key and night-near sets, 1920x1080 PNG.

METHOD PREVIEW ONLY (M0-W0-T06): rendered offline with Blender (EEVEE Next by default, Cycles with --engine cycles), not captured in the game engine. The lights
follow art-direction section 2.1/2.2 in relative units (noon: sun 60 degrees elevation + 15 % warm-gray fill;
night-near: earthshine key + Crown Lamp; the EV100 14.3 -> 7.3 exposure change is folded into the night light
strengths), view transform AgX. The in-engine capture replaces this in M0-W1 (screenshot harness, VT-M1-35).

    blender --background --python turntable.py -- --glb <raw.glb> --outdir <dir> --name <asset id>
        [--sets noon,night] [--views 8] [--lamp-cd 6000] [--palette <json out>] [--scratch <dir>]
"""

import argparse
import json
import math
import os
import re
import sys
import time

import bpy
import numpy as np
from mathutils import Vector

SUN_REL = 5.0  # Blender sun strength (W/m2) standing for the 115,900 lux noon key on flat ground / sin(60)
LUX_TO_REL_NIGHT = SUN_REL * math.sin(math.radians(60.0)) / 115900.0 * 2.0 ** (14.3 - 7.3)

PALETTE = {
    "ivory": (0xE4, 0xDC, 0xCB),
    "teal": (0x1C, 0x8C, 0x84),
    "teal-deep": (0x0E, 0x5E, 0x5C),
    "yellow": (0xF2, 0xB7, 0x05),
    "graphite": (0x2B, 0x2F, 0x34),
    "steel": (0xC9, 0xCC, 0xCF),
    "deck-gray": (0xB4, 0xB2, 0xAC),
    "glass": (0x15, 0x18, 0x1B),
    "emissive-teal": (0x12, 0x4E, 0x49),
    "emissive-amber": (0x59, 0x3E, 0x10),
}


def linear(hex_color):
    out = []
    for i in (1, 3, 5):
        c = int(hex_color[i : i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return out


def parse():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--glb", required=True)
    parser.add_argument("--outdir", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--sets", default="noon,night")
    parser.add_argument("--views", type=int, default=8)
    parser.add_argument("--only-view", type=int, default=-1)
    parser.add_argument("--samples", type=int, default=24)
    parser.add_argument("--resolution-percent", type=int, default=100)
    parser.add_argument("--engine", default="eevee", choices=("eevee", "cycles"))
    parser.add_argument("--lamp-cd", type=float, default=6000.0)
    parser.add_argument("--palette", default="")
    parser.add_argument("--scratch", default="")
    args = parser.parse_args(argv)
    for key in ("glb", "outdir", "palette", "scratch"):
        if getattr(args, key):
            setattr(args, key, os.path.abspath(getattr(args, key)))
    os.makedirs(args.outdir, exist_ok=True)
    return args


def direction(elevation_deg, azimuth_deg):
    el, az = math.radians(elevation_deg), math.radians(azimuth_deg)
    return Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))


def aim(obj, toward):
    """Point the object's -Z axis along `toward` (lights and cameras look down -Z)."""
    obj.rotation_euler = Vector(toward).to_track_quat("-Z", "Y").to_euler()


def add_sun(name, hex_color, strength, angle_deg, from_direction):
    data = bpy.data.lights.new(name, "SUN")
    data.color = linear(hex_color)
    data.energy = strength
    data.angle = math.radians(angle_deg)
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    aim(obj, -from_direction)
    return obj


def set_world(hex_color, radiance):
    world = bpy.context.scene.world or bpy.data.worlds.new("turntable")
    bpy.context.scene.world = world
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputWorld")
    fill = nodes.new("ShaderNodeBackground")
    fill.inputs["Color"].default_value = (*linear(hex_color), 1.0)
    fill.inputs["Strength"].default_value = radiance
    black = nodes.new("ShaderNodeBackground")
    black.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    path = nodes.new("ShaderNodeLightPath")
    mix = nodes.new("ShaderNodeMixShader")
    links.new(path.outputs["Is Camera Ray"], mix.inputs["Fac"])
    links.new(fill.outputs["Background"], mix.inputs[1])
    links.new(black.outputs["Background"], mix.inputs[2])
    links.new(mix.outputs["Shader"], out.inputs["Surface"])


def ground_plane():
    bpy.ops.mesh.primitive_plane_add(size=400.0, location=(0.0, 0.0, 0.0))
    ground = bpy.context.active_object
    ground.name = "turntable_ground"
    material = bpy.data.materials.new("turntable_regolith")
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.95
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 1.6
    noise.inputs["Detail"].default_value = 8.0
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*linear("#8E8A83"), 1.0)
    ramp.color_ramp.elements[1].color = (*linear("#A19D95"), 1.0)
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    fine = nodes.new("ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = 60.0
    fine.inputs["Detail"].default_value = 6.0
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.25
    bump.inputs["Distance"].default_value = 0.02
    links.new(fine.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    ground.data.materials.append(material)
    return ground


def main():
    args = parse()
    started = time.perf_counter()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=args.glb)
    subject = []
    for obj in list(scene.objects):
        if obj.type != "MESH":
            continue
        if re.search(r"_LOD[1-9]$", obj.name):
            obj.hide_render = True
        else:
            subject.append(obj)
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ Vector(corner) for obj in subject for corner in obj.bound_box]
    low = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    top = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    center = (low + top) * 0.5
    radius = (top - low).length * 0.5
    ground = ground_plane()

    if args.engine == "cycles":
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = args.samples
        scene.cycles.use_denoising = True
        scene.cycles.seed = 0
    else:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
        scene.eevee.taa_render_samples = args.samples
        scene.eevee.use_shadows = True
        scene.eevee.use_raytracing = True
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1920, 1080, args.resolution_percent
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.compression = 90
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.14  # matches x = 1.753 * albedo at the noon key (art-direction 2.3)

    camera_data = bpy.data.cameras.new("turntable_camera")
    camera_data.lens = 35.0
    camera_data.sensor_width = 36.0
    camera = bpy.data.objects.new("turntable_camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    vfov = 2.0 * math.atan((36.0 * 9.0 / 16.0) / (2.0 * 35.0))
    distance = radius / math.sin(vfov * 0.5) * 0.76
    target = center + Vector((0.0, 0.0, -0.08 * radius))

    def place_camera(view):
        offset = direction(11.0, view * 360.0 / args.views + 22.5)
        camera.location = target + offset * distance
        aim(camera, -offset)
        return offset

    lights = {}
    sun_direction = direction(60.0, 130.0)
    lights["noon"] = [add_sun("sun", "#FFF4EA", SUN_REL, 0.53, sun_direction)]
    earth_direction = direction(52.0, 200.0)
    earth_strength = 300.0 * LUX_TO_REL_NIGHT
    lamp_data = bpy.data.lights.new("crown_lamp", "SPOT")
    lamp_data.color = linear("#FFE7C8")
    lamp_data.energy = args.lamp_cd * LUX_TO_REL_NIGHT * 4.0 * math.pi * math.pi  # Cycles: W -> W/sr is / (4 pi^2)
    lamp_data.spot_size = math.radians(40.0)
    lamp_data.spot_blend = 0.35
    lamp_data.shadow_soft_size = 0.03
    lamp = bpy.data.objects.new("crown_lamp", lamp_data)
    scene.collection.objects.link(lamp)
    lights["night"] = [add_sun("earthshine", "#CFE0FF", earth_strength, 2.4, earth_direction), lamp]
    fills = {
        "noon": ("#8C8478", 0.15 * SUN_REL * math.sin(math.radians(60.0)) / math.pi),
        "night": ("#8C8478", 0.15 * earth_strength * math.sin(math.radians(52.0)) / math.pi),
    }

    views = range(args.views) if args.only_view < 0 else [args.only_view]
    written = []
    for set_name in args.sets.split(","):
        for key, group in lights.items():
            for light in group:
                light.hide_render = key != set_name
        set_world(*fills[set_name])
        for view in views:
            offset = place_camera(view)
            if set_name == "night":
                # Crown Lamp: a custodian standing between the camera and the asset, lamp at helmet height.
                side = Vector((-offset.y, offset.x, 0.0)).normalized()
                position = target + offset * max(3.5, distance * 0.72) + side * 0.5
                position.z = 1.75
                lamp.location = position
                aim(lamp, (target - position).normalized())
            path = os.path.join(args.outdir, f"{args.name}-{set_name}-{view * 360 // args.views:03d}.png")
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            written.append(path)
            print(f"[ctm] turntable {os.path.basename(path)} at {time.perf_counter() - started:.1f}s", flush=True)

    if args.palette:
        # Palette share on the turntable: flat emission of the base colour, classified per pixel.
        scratch = args.scratch or args.outdir
        os.makedirs(scratch, exist_ok=True)
        ground.hide_render = True
        for group in lights.values():
            for light in group:
                light.hide_render = True
        set_world("#000000", 0.0)
        for obj in subject:
            for slot in obj.material_slots:
                source = slot.material
                image = next((n.image for n in source.node_tree.nodes if n.type == "TEX_IMAGE" and n.image and n.image.colorspace_settings.name == "sRGB" and "emissive" not in n.image.name.lower()), None)
                flat = bpy.data.materials.new(source.name + "_flat")
                flat.use_nodes = True
                nodes, links = flat.node_tree.nodes, flat.node_tree.links
                nodes.clear()
                out = nodes.new("ShaderNodeOutputMaterial")
                emission = nodes.new("ShaderNodeEmission")
                if image is not None:
                    tex = nodes.new("ShaderNodeTexImage")
                    tex.image = image
                    links.new(tex.outputs["Color"], emission.inputs["Color"])
                links.new(emission.outputs["Emission"], out.inputs["Surface"])
                slot.material = flat
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = 2
        scene.cycles.use_denoising = False
        scene.render.film_transparent = True
        scene.render.image_settings.color_mode = "RGBA"
        scene.view_settings.view_transform = "Standard"
        scene.view_settings.exposure = 0.0
        scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 960, 540, 100
        names = list(PALETTE)
        table = np.array([PALETTE[n] for n in names], np.float32)
        table_norm = table / table.max(axis=1, keepdims=True)
        table_luma = table @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        counts = np.zeros(len(names), np.float64)
        per_view = []
        for view in range(args.views):
            place_camera(view)
            path = os.path.join(scratch, f"{args.name}-palette-{view}.png")
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            image = bpy.data.images.load(path)
            width, height = image.size
            pixels = np.empty(width * height * 4, np.float32)
            image.pixels.foreach_get(pixels)
            pixels = pixels.reshape(-1, 4)
            rgb = pixels[pixels[:, 3] > 0.98][:, :3] * 255.0
            norm = rgb / np.maximum(rgb.max(axis=1, keepdims=True), 1.0)
            luma = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
            score = np.linalg.norm(norm[:, None, :] - table_norm[None, :, :], axis=2) * 255.0 + 0.5 * np.abs(luma[:, None] - table_luma[None, :])
            nearest = score.argmin(axis=1)
            view_counts = np.bincount(nearest, minlength=len(names)).astype(np.float64)
            counts += view_counts
            per_view.append({names[i]: round(float(view_counts[i] / max(1.0, view_counts.sum())), 4) for i in range(len(names))})
            bpy.data.images.remove(image)
        shares = {names[i]: round(float(counts[i] / max(1.0, counts.sum())), 4) for i in range(len(names))}
        grouped = {
            "ivory": shares["ivory"],
            "teal": round(shares["teal"] + shares["teal-deep"], 4),
            "yellow": shares["yellow"],
            "graphite": shares["graphite"],
            "steel": shares["steel"],
            "deck-gray": shares["deck-gray"],
            "glass": shares["glass"],
            "emissive": round(shares["emissive-teal"] + shares["emissive-amber"], 4),
        }
        with open(args.palette, "w", encoding="utf-8") as handle:
            json.dump({"method": "flat base-colour emission render, 960x540, 8 views, nearest palette token per visible pixel", "visibleAreaShares": grouped, "maxYellowShareInAnyView": max(v["yellow"] for v in per_view)}, handle, indent=2, sort_keys=True)
            handle.write("\n")
        print(f"[ctm] palette shares {grouped}")

    print(f"[ctm] turntable {args.name}: {len(written)} images in {time.perf_counter() - started:.1f}s")


main()
