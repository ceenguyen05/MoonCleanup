"""Kitbash library v0: parametric hard-surface builders that write trim-sheet UVs. Original work (M0-W0-T06).

Everything is appended to one bmesh (one mesh, one material, one draw). Builders:
  lathe  - surface of revolution around local X, with per-span trim strips (shells, ribs, rings, pads, bolts)
  box    - bevelled box, box-projected onto one strip (struts, planks, housings)
  tube   - swept round tube along a path with rounded corners (rails, pipes, rungs)
`detail` scales segment counts and bevels so the same asset function emits every LOD.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import ctm_trim as trim

DETAIL = {
    0: {"segs": 64, "small": 24, "tube": 10, "bevel": 2, "arc": 4, "bolts": True, "greebles": True},
    1: {"segs": 32, "small": 12, "tube": 8, "bevel": 1, "arc": 2, "bolts": False, "greebles": True},
    2: {"segs": 16, "small": 8, "tube": 4, "bevel": 0, "arc": 1, "bolts": False, "greebles": False},
}

IDENTITY = Matrix.Identity(4)


def frame_x(origin, direction, up=(0.0, 0.0, 1.0)):
    """Matrix whose local +X points along `direction`, placed at `origin`."""
    x = Vector(direction).normalized()
    y = Vector(up).cross(x)
    if y.length < 1e-6:
        y = Vector((0.0, 1.0, 0.0)).cross(x)
    y.normalize()
    z = x.cross(y)
    matrix = Matrix((x, y, z)).transposed().to_4x4()
    matrix.translation = Vector(origin)
    return matrix


def rounded_path(points, radius, steps):
    """Replace every interior corner with a quadratic arc of `steps` segments."""
    points = [Vector(p) for p in points]
    if steps < 1 or len(points) < 3:
        return points
    out = [points[0]]
    for prev, corner, nxt in zip(points, points[1:], points[2:]):
        d_in = (corner - prev).normalized()
        d_out = (nxt - corner).normalized()
        r = min(radius, (corner - prev).length * 0.45, (nxt - corner).length * 0.45)
        a, b = corner - d_in * r, corner + d_out * r
        for k in range(steps + 1):
            t = k / steps
            out.append(a * (1 - t) ** 2 + corner * (2 * t * (1 - t)) + b * t**2)
    out.append(points[-1])
    return out


class Kit:
    def __init__(self, sheet, lod, density=320.0, v_bands=0.0):
        self.sheet = sheet
        self.detail = DETAIL[lod]
        self.density = density  # px per metre along U
        # v_bands (M1-W5-T03): target V density as a fraction of the U density. A box face wider than its strip can
        # carry at that density is cut into equal bands, each mapped onto the whole strip (reads as plank / panel
        # seams). 0 = off (default) so v0 assets (M0 proof) rebuild unchanged; far LODs pass a lower fraction.
        self.v_bands = v_bands
        self.bm = self._new()

    @staticmethod
    def _new():
        bm = bmesh.new()
        bm.loops.layers.uv.new("UVMap")
        bm.faces.layers.int.new("strip")
        return bm

    def _merge(self, part, matrix, fix_normals=False):
        if fix_normals:
            bmesh.ops.recalc_face_normals(part, faces=part.faces[:])
        part.transform(matrix)
        mesh = bpy.data.meshes.new("ctm_part")
        part.to_mesh(mesh)
        part.free()
        self.bm.from_mesh(mesh)
        bpy.data.meshes.remove(mesh)

    # ------------------------------------------------------------------------------------- lathe

    def lathe(self, profile, spans, matrix=IDENTITY, segs=None, u_tiles=None):
        """profile: [(axial, radius)] revolved around local X; spans: [(i0, i1, strip)] over profile indices.

        Winding: walk the profile so the outside is on the left (axis -> out at min axial, along +axial,
        back to the axis); that gives outward normals without a recalc.
        """
        segs = segs or self.detail["segs"]
        part = self._new()
        uv = part.loops.layers.uv.active
        tag = part.faces.layers.int.active
        max_radius = max(r for _, r in profile)
        if u_tiles is None:
            u_tiles = max(1, round(2.0 * math.pi * max_radius * self.density / trim.SIZE))
        rings = []
        for axial, radius in profile:
            if radius < 1e-6:
                rings.append([part.verts.new((axial, 0.0, 0.0))])
            else:
                rings.append(
                    [
                        part.verts.new((axial, radius * math.cos(2 * math.pi * j / segs), radius * math.sin(2 * math.pi * j / segs)))
                        for j in range(segs)
                    ]
                )
        mapping = {}
        for i0, i1, strip in spans:
            lengths = [math.dist(profile[k], profile[k + 1]) for k in range(i0, i1)]
            total = sum(lengths) or 1.0
            walked = 0.0
            for k, length in zip(range(i0, i1), lengths):
                mapping[k] = (strip, walked / total, (walked + length) / total)
                walked += length
        for i in range(len(profile) - 1):
            strip, t0, t1 = mapping[i]
            v0, v1 = self.sheet.v_range(strip)
            va, vb = v0 + (v1 - v0) * t0, v0 + (v1 - v0) * t1
            ring_a, ring_b = rings[i], rings[i + 1]
            if len(ring_a) == 1 and len(ring_b) == 1:
                continue
            for j in range(segs):
                j2 = (j + 1) % segs
                ua, ub = j / segs * u_tiles, (j + 1) / segs * u_tiles
                if len(ring_a) == 1:
                    verts, uvs = (ring_a[0], ring_b[j2], ring_b[j]), (((ua + ub) / 2, va), (ub, vb), (ua, vb))
                elif len(ring_b) == 1:
                    verts, uvs = (ring_a[j], ring_a[j2], ring_b[0]), ((ua, va), (ub, va), ((ua + ub) / 2, vb))
                else:
                    verts = (ring_a[j], ring_a[j2], ring_b[j2], ring_b[j])
                    uvs = ((ua, va), (ub, va), (ub, vb), (ua, vb))
                face = part.faces.new(verts)
                face[tag] = self.sheet.index(strip)
                for loop, coord in zip(face.loops, uvs):
                    loop[uv].uv = coord
        self._merge(part, matrix)

    def ring(self, a0, a1, r_in, r_out, strip, matrix=IDENTITY, chamfer=0.012, segs=None, inner=False, u_tiles=None):
        """Raised band (rib, flange). Open towards the axis unless inner=True (then the bore is modelled too)."""
        c = chamfer if self.detail["bevel"] else 0.0
        profile = [(a0, r_in), (a0, r_out - c)]
        if c:
            profile.append((a0 + c, r_out))
            profile.append((a1 - c, r_out))
        profile.append((a1, r_out - c))
        profile.append((a1, r_in + (c if inner else 0.0)))
        if inner:
            if c:
                profile.append((a1 - c, r_in))
            profile.append((a0, r_in))
        self.lathe(profile, [(0, len(profile) - 1, strip)], matrix, segs, u_tiles)

    def disc(self, a0, a1, radius, strip, matrix=IDENTITY, chamfer=0.01, segs=None, cap_strip=None, u_tiles=None):
        """Solid cylinder / puck with a chamfered front (+axial) face. Back face is omitted (it is buried)."""
        c = min(chamfer, radius * 0.4) if self.detail["bevel"] else 0.0
        profile = [(a0, radius), (a1 - c, radius)]
        if c:
            profile.append((a1, radius - c))
        side_end = len(profile) - 1
        profile.append((a1, 0.0))
        spans = [(0, side_end, strip), (side_end, side_end + 1, cap_strip or strip)]
        self.lathe(profile, spans, matrix, segs or self.detail["small"], u_tiles)

    def bolt(self, matrix, radius=0.026, height=0.022):
        self.disc(0.0, height, radius, "steel", matrix, chamfer=0.006, segs=6, u_tiles=1)

    # --------------------------------------------------------------------------------------- box

    def box(self, size, matrix, strip, bevel=0.015):
        size = Vector(size)
        part = self._new()
        bmesh.ops.create_cube(part, size=1.0)
        for vert in part.verts:
            vert.co = Vector((vert.co.x * size.x, vert.co.y * size.y, vert.co.z * size.z))
        segments = self.detail["bevel"]
        width = min(bevel, min(size) * 0.3)
        if segments and width > 0.0:
            bmesh.ops.bevel(
                part, geom=part.edges[:], offset=width, offset_type="OFFSET", segments=segments, profile=0.5, affect="EDGES", clamp_overlap=True
            )
        # Extra loops along the long axis give the vertex-AO bake something to interpolate between.
        long_axis = max(range(3), key=lambda k: size[k])
        cuts = int(size[long_axis] / 0.45) if self.detail["greebles"] else 0
        for k in range(1, cuts + 1):
            position = [0.0, 0.0, 0.0]
            position[long_axis] = -size[long_axis] * 0.5 + size[long_axis] * k / (cuts + 1)
            axis_normal = [0.0, 0.0, 0.0]
            axis_normal[long_axis] = 1.0
            bmesh.ops.bisect_plane(part, geom=part.verts[:] + part.edges[:] + part.faces[:], plane_co=position, plane_no=axis_normal)
        bands = [1, 1, 1]
        if self.v_bands > 0.0:
            band_len = self.sheet.strip_px(strip) / (self.v_bands * self.density)
            for k in range(3):
                if all(size[k] > size[m] for m in range(3) if m != k):
                    continue  # the strictly longest axis is U on every face it spans, never V
                bands[k] = max(1, math.ceil(size[k] / band_len - 0.05))
                for b in range(1, bands[k]):
                    position = [0.0, 0.0, 0.0]
                    position[k] = -size[k] * 0.5 + size[k] * b / bands[k]
                    axis_normal = [0.0, 0.0, 0.0]
                    axis_normal[k] = 1.0
                    bmesh.ops.bisect_plane(part, geom=part.verts[:] + part.edges[:] + part.faces[:], plane_co=position, plane_no=axis_normal)
        part.normal_update()
        uv = part.loops.layers.uv.active
        tag = part.faces.layers.int.active
        v0, v1 = self.sheet.v_range(strip)
        index = self.sheet.index(strip)
        for face in part.faces:
            normal = face.normal
            axis = max(range(3), key=lambda k: abs(normal[k]))
            others = [k for k in range(3) if k != axis]
            u_axis, v_axis = (others[0], others[1]) if size[others[0]] >= size[others[1]] else (others[1], others[0])
            face[tag] = index
            n = bands[v_axis]
            span = size[v_axis] / n
            band = 0
            if n > 1:
                centre = face.calc_center_median()[v_axis] + size[v_axis] * 0.5
                band = min(n - 1, max(0, int(centre // span)))
            start = -size[v_axis] * 0.5 + band * span
            for loop in face.loops:
                co = loop.vert.co
                u = (co[u_axis] + size[u_axis] * 0.5) * self.density / trim.SIZE
                t = min(1.0, max(0.0, (co[v_axis] - start) / span))
                loop[uv].uv = (u, v0 + (v1 - v0) * t)
        self._merge(part, matrix)

    def beam(self, start, end, width, depth, strip, bevel=0.015, up=(0.0, 0.0, 1.0)):
        start, end = Vector(start), Vector(end)
        matrix = frame_x((start + end) * 0.5, end - start, up)
        self.box(((end - start).length, width, depth), matrix, strip, bevel)

    # -------------------------------------------------------------------------------------- tube

    def tube(self, points, radius, strip, corner=0.06, segs=None, matrix=IDENTITY):
        segs = segs or self.detail["tube"]
        coarse = rounded_path(points, corner, self.detail["arc"])
        path = [coarse[0]]
        for point in coarse[1:]:  # split long straight runs (vertex-AO resolution); LOD2 keeps them whole
            pieces = int((point - path[-1]).length / 0.5) + 1 if self.detail["greebles"] else 1
            start = path[-1]
            for k in range(1, pieces + 1):
                path.append(start.lerp(point, k / pieces))
        part = self._new()
        uv = part.loops.layers.uv.active
        tag = part.faces.layers.int.active
        v0, v1 = self.sheet.v_range(strip)
        index = self.sheet.index(strip)
        tangents = []
        for k in range(len(path)):
            a = path[max(0, k - 1)]
            b = path[min(len(path) - 1, k + 1)]
            tangents.append((b - a).normalized())
        normal = tangents[0].orthogonal().normalized()
        rings, lengths, walked = [], [], 0.0
        for k, (point, tangent) in enumerate(zip(path, tangents)):
            normal = (normal - tangent * normal.dot(tangent)).normalized()
            binormal = tangent.cross(normal)
            rings.append(
                [
                    part.verts.new(point + (normal * math.cos(2 * math.pi * j / segs) + binormal * math.sin(2 * math.pi * j / segs)) * radius)
                    for j in range(segs)
                ]
            )
            if k:
                walked += (point - path[k - 1]).length
            lengths.append(walked * self.density / trim.SIZE)

        def wave(j):
            return v0 + (v1 - v0) * (1.0 - abs(2.0 * j / segs - 1.0))

        for k in range(len(path) - 1):
            for j in range(segs):
                j2 = (j + 1) % segs
                face = part.faces.new((rings[k][j], rings[k][j2], rings[k + 1][j2], rings[k + 1][j]))
                face[tag] = index
                coords = ((lengths[k], wave(j)), (lengths[k], wave(j + 1)), (lengths[k + 1], wave(j + 1)), (lengths[k + 1], wave(j)))
                for loop, coord in zip(face.loops, coords):
                    loop[uv].uv = coord
        for ring, center, flip in ((rings[0], path[0], True), (rings[-1], path[-1], False)):
            hub = part.verts.new(center)
            for j in range(segs):
                j2 = (j + 1) % segs
                face = part.faces.new((hub, ring[j2], ring[j]) if flip else (hub, ring[j], ring[j2]))
                face[tag] = index
                for loop in face.loops:
                    loop[uv].uv = (0.0, (v0 + v1) * 0.5)
        self._merge(part, matrix, fix_normals=True)

    # ------------------------------------------------------------------------------------ finish

    def area_shares(self):
        """Surface-area share per palette group (art-direction section 5.1 share check, mesh-space)."""
        tag = self.bm.faces.layers.int.active
        totals = {}
        for face in self.bm.faces:
            name = self.sheet.order[face[tag]]
            group = self.sheet.groups[name]
            area = face.calc_area()
            if name == "hazard":  # half yellow, half graphite
                totals["yellow"] = totals.get("yellow", 0.0) + area * 0.5
                totals["graphite"] = totals.get("graphite", 0.0) + area * 0.5
            else:
                totals[group] = totals.get(group, 0.0) + area
        whole = sum(totals.values()) or 1.0
        return {key: round(value / whole, 4) for key, value in sorted(totals.items())}

    def to_object(self, name):
        mesh = bpy.data.meshes.new(name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj
