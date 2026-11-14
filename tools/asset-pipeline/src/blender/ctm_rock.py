"""Procedural lunar rock generator (rock-kit class). Original work (M0-W0-T06).

High-poly: an icosphere clipped by seeded random planes (angular, fractured boulder faces), displaced by
layered Perlin noise, flattened at the base so it sits on the ground. Game mesh: collapse-decimated copy with a
smart-projected UV set; normal, ambient occlusion and base colour are baked from the high-poly mesh.
LOD1/LOD2 are decimated from LOD0 and reuse its texture set.
"""

import math
import random

import bmesh
import bpy
import numpy as np
from mathutils import Vector, noise

import ctm_lib as lib


def _fbm(point, octaves, lacunarity=2.0, gain=0.5):
    total, amplitude, frequency = 0.0, 1.0, 1.0
    for _ in range(octaves):
        total += amplitude * noise.noise(point * frequency)
        amplitude *= gain
        frequency *= lacunarity
    return total


def build_high(name, seed, size, subdivisions=7):
    """size = (x, y, z) full extents in metres. Returns the high-poly object (pivot at ground contact)."""
    rng = random.Random(seed)
    offset = Vector((rng.uniform(-50, 50), rng.uniform(-50, 50), rng.uniform(-50, 50)))
    planes = []
    for _ in range(rng.randint(16, 22)):
        normal = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 0.9))).normalized()
        planes.append((normal, rng.uniform(0.52, 0.9)))

    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=1.0)
    for vert in bm.verts:
        direction = vert.co.normalized()
        radius = 1.0 + 0.22 * _fbm(direction * 1.1 + offset, 3)
        # Fracture planes: clip the blob so it gets flat, angular faces with rounded transitions.
        for normal, height in planes:
            along = direction.dot(normal)
            if along > 1e-4:
                limit = height / along
                if radius > limit:
                    radius = limit + (radius - limit) * 0.05
        point = direction * radius
        # Surface breakup: medium lumps, fine pitting, and a few shallow impact pits.
        radius += 0.030 * _fbm(point * 3.1 + offset, 4)
        radius += 0.009 * _fbm(point * 11.0 + offset, 3)
        pit = noise.noise(point * 4.3 + offset * 1.7)
        radius -= 0.03 * max(0.0, pit - 0.45) / 0.55
        vert.co = direction * radius
    # Scale to the requested extents, then flatten the buried base.
    half = Vector(size) * 0.5
    for vert in bm.verts:
        vert.co.x *= half.x
        vert.co.y *= half.y
        vert.co.z *= half.z
    base = -half.z * 0.62
    for vert in bm.verts:
        if vert.co.z < base:
            vert.co.z = base + (vert.co.z - base) * 0.05
        vert.co.z -= base
    bm.normal_update()
    obj = lib.object_from_bmesh(name, bm)
    lib.shade(obj)
    return obj


def high_material(name, seed):
    """Procedural base colour for the bake: neutral lunar gray with mottling and darker cavities."""
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    coords = nodes.new("ShaderNodeTexCoord")

    def noise_node(scale, detail, w):
        node = nodes.new("ShaderNodeTexNoise")
        node.noise_dimensions = "4D"
        node.inputs["Scale"].default_value = scale
        node.inputs["Detail"].default_value = detail
        node.inputs["W"].default_value = w
        links.new(coords.outputs["Object"], node.inputs["Vector"])
        return node

    mottle = noise_node(2.2, 6.0, seed * 1.37)
    speck = noise_node(38.0, 2.0, seed * 2.11)
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.32
    ramp.color_ramp.elements[0].color = (0.205, 0.195, 0.185, 1.0)
    ramp.color_ramp.elements[1].position = 0.72
    ramp.color_ramp.elements[1].color = (0.335, 0.325, 0.31, 1.0)
    links.new(mottle.outputs["Fac"], ramp.inputs["Fac"])
    speck_ramp = nodes.new("ShaderNodeValToRGB")
    speck_ramp.color_ramp.elements[0].position = 0.58
    speck_ramp.color_ramp.elements[0].color = (1, 1, 1, 1)
    speck_ramp.color_ramp.elements[1].position = 0.74
    speck_ramp.color_ramp.elements[1].color = (0.72, 0.72, 0.72, 1)
    links.new(speck.outputs["Fac"], speck_ramp.inputs["Fac"])
    geometry = nodes.new("ShaderNodeNewGeometry")
    cavity = nodes.new("ShaderNodeMapRange")
    cavity.inputs["From Min"].default_value = 0.44
    cavity.inputs["From Max"].default_value = 0.56
    cavity.inputs["To Min"].default_value = 0.72
    cavity.inputs["To Max"].default_value = 1.12
    links.new(geometry.outputs["Pointiness"], cavity.inputs["Value"])
    mix_a = nodes.new("ShaderNodeMix")
    mix_a.data_type = "RGBA"
    mix_a.blend_type = "MULTIPLY"
    mix_a.inputs[0].default_value = 1.0
    links.new(ramp.outputs["Color"], mix_a.inputs[6])
    links.new(speck_ramp.outputs["Color"], mix_a.inputs[7])
    mix_b = nodes.new("ShaderNodeMix")
    mix_b.data_type = "RGBA"
    mix_b.blend_type = "MULTIPLY"
    mix_b.inputs[0].default_value = 1.0
    links.new(mix_a.outputs[2], mix_b.inputs[6])
    links.new(cavity.outputs["Result"], mix_b.inputs[7])
    links.new(mix_b.outputs[2], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.92
    return material


def unwrap(obj):
    lib.select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(72.0), island_margin=0.012, area_weight=0.0)
    bpy.ops.object.mode_set(mode="OBJECT")


def make_rock(asset_id, seed, size, tex_size, lod_tris, texdir, steps):
    """Returns (lod objects, metrics). lod_tris = (lod0, lod1, lod2) triangle targets."""
    high = build_high(asset_id + "_high", seed, size)
    lib.assign_material(high, high_material(asset_id + "_bake_source", seed))
    steps.mark("high-poly")

    lod0 = lib.decimated_copy(high, asset_id + "_LOD0", lod_tris[0])
    lod0.data.materials.clear()
    lib.shade(lod0)
    unwrap(lod0)
    steps.mark("game mesh + UV")

    scratch = lib.pbr_material(asset_id + "_bake_scratch")
    lib.assign_material(lod0, scratch)
    extrusion = 0.03 * max(size)
    normal_img = lib.bake_target("n", tex_size, False, (0.5, 0.5, 1.0, 1.0))
    ao_img = lib.bake_target("ao", tex_size, False, (1.0, 1.0, 1.0, 1.0))
    color_img = lib.bake_target("c", tex_size, True, (0.5, 0.5, 0.5, 1.0))
    normal = lib.bake_selected_to_active(lod0, high, scratch, normal_img, "NORMAL", 4, extrusion)
    ao = lib.bake_selected_to_active(lod0, high, scratch, ao_img, "AO", 96, extrusion)
    color = lib.bake_selected_to_active(lod0, high, scratch, color_img, "DIFFUSE", 8, extrusion, {"COLOR"})
    steps.mark("bake normal/AO/base colour")

    # ORM: occlusion (R), roughness (G, slightly rougher in cavities), metallic (B = 0).
    occlusion = np.clip(ao[..., 0], 0.0, 1.0)
    orm = np.zeros_like(ao)
    orm[..., 0] = occlusion
    orm[..., 1] = np.clip(0.97 - 0.09 * occlusion, 0.0, 1.0)
    base_tex, base_bytes = lib.save_texture(asset_id + "_basecolor", color, True, f"{texdir}/{asset_id}_basecolor.png")
    normal_tex, normal_bytes = lib.save_texture(asset_id + "_normal", normal, False, f"{texdir}/{asset_id}_normal.png")
    orm_tex, orm_bytes = lib.save_texture(asset_id + "_orm", orm, False, f"{texdir}/{asset_id}_orm.png")
    material = lib.pbr_material(asset_id, base=base_tex, normal=normal_tex, orm=orm_tex)
    lib.assign_material(lod0, material)
    steps.mark("textures")

    lods = [lod0]
    for index, target in enumerate(lod_tris[1:], start=1):
        lod = lib.decimated_copy(lod0, f"{asset_id}_LOD{index}", target)
        lib.shade(lod)
        lods.append(lod)
    for index, lod in enumerate(lods):
        lod["ctm_lod"] = index
        lod["ctm_class"] = "rock"
    bpy.data.objects.remove(high)
    steps.mark("LOD chain")

    low, top = lib.bounds(lod0)
    metrics = {
        "class": "rock",
        "seed": seed,
        "sizeM": [round(top[i] - low[i], 3) for i in range(3)],
        "lodTriangles": [lib.triangle_count(lod) for lod in lods],
        "textureSize": tex_size,
        "texturePngBytes": {"basecolor": base_bytes, "normal": normal_bytes, "orm": orm_bytes},
        "texelDensityPxPerM": lib.texel_density(lod0, tex_size, tex_size),
        "materials": 1,
    }
    return lods, metrics
