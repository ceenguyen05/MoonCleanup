"""Source script: custodian_blockout (blockout custodian, M1-W3-T07).

Slightly stylised human EVA custodian at the final proportions of art-direction section 4.1 (1.85 m, helmet
0.40 x 0.36 m = 4.6 helmet-heights, shoulders 0.62 m with pauldrons, crotch 44 %, gloves 1.15x, boots 1.2x,
pack 0.50 x 0.38 x 0.20 m). Final material slots (section 4.3) incl. the player-colour slots: helmet crown ring,
shoulder plates, pack light strip, Dust Cell window. Final sockets: right/left hand, name tag, Crown Lamp, and the
limb pivots the procedural motion uses (no skeleton until M1-W4-T07). Smoked visor, no LED eyes.
Original procedural asset for Clean The Moon!: no external meshes or textures.

    blender --background --python assets/models/characters/blockout/custodian_blockout.py -- --out <raw.glb> --report <json> --texdir <dir>
"""

import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo

sys.path.insert(
    0,
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "tools", "asset-pipeline", "src", "blender"
    ),
)

from mathutils import Matrix  # noqa: E402

import ctm_blockout as kit  # noqa: E402
import ctm_lib as lib  # noqa: E402

ASSET_ID = "custodian_blockout"

# Material slots: the runtime palette (apps/client/src/visuals/characters/blockout/palette.ts) uses the same ids.
SUIT, BELLOWS, GRAPHITE, STEEL, HAZARD, PLAYER_PLATE, PLAYER_GLOW, VISOR, LAMP_LENS, SOLE = range(10)
SLOT_NAMES = {
    SUIT: "suit",
    BELLOWS: "bellows",
    GRAPHITE: "graphite",
    STEEL: "steel",
    HAZARD: "hazard",
    PLAYER_PLATE: "playerPlate",
    PLAYER_GLOW: "playerGlow",
    VISOR: "visor",
    LAMP_LENS: "lampLens",
    SOLE: "sole",
}
# Rigid parts (procedural motion, `motion.ts`): 0 body, then thigh / shin / upper arm / forearm, left before right.
BODY, THIGH_L, THIGH_R, SHIN_L, SHIN_R, UPPER_L, UPPER_R, FORE_L, FORE_R = range(9)

HEIGHT = 1.85
HELMET_C = (0.0, 0.0, 1.655)
HELMET_HALF = (0.18, 0.19, 0.20)  # 0.36 wide, 0.40 tall
HELMET_E = (2.4, 2.3)
HIP = (0.105, 0.0, 0.93)
KNEE = (0.118, -0.015, 0.505)
ANKLE = (0.12, 0.0, 0.17)
SHOULDER = (0.222, 0.0, 1.36)
ELBOW = (0.252, 0.0, 1.10)
WRIST = (0.262, -0.03, 0.875)
GLOVE = (0.265, -0.035, 0.80)

LOD_FACTOR = (0.6, 0.36, 0.2, 0.1)


def mirror(p, side):
    return (p[0] * side, p[1], p[2])


def helmet_front_y(x, z):
    """y of the helmet's front surface (facing -Y) at (x, z), from the superellipsoid's implicit form."""
    a, b, c = HELMET_HALF
    eh, ev = HELMET_E
    zz = abs((z - HELMET_C[2]) / c) ** ev
    left = max(0.0, 1.0 - zz) ** (eh / ev) - abs(x / a) ** eh
    return HELMET_C[1] - b * max(0.0, left) ** (1.0 / eh)


def build(lod):
    f = LOD_FACTOR[lod]

    def seg(n, low=6):
        return max(low if lod < 3 else 4, int(round(n * f / 2.0)) * 2)

    b = kit.Builder(f"{ASSET_ID}_LOD{lod}")
    detail = lod <= 1
    fine = lod == 0
    coarse = lod == 3
    caps = 2 if lod == 0 else 1

    def trim(points, radii):
        """LOD3 limbs: straight segments (drop the mid section)."""
        return ([points[0], points[-1]], [radii[0], radii[-1]]) if coarse else (points, radii)

    # ---- Torso, pelvis, neck (body)
    b.add_superellipsoid((0.0, 0.005, 0.905), (0.172, 0.125, 0.125), SUIT, BODY, 2.6, 2.2, seg(24), seg(10))
    b.add_superellipsoid((0.0, 0.0, 1.17), (0.212, 0.145, 0.27), SUIT, BODY, 3.0, 2.4, seg(28), seg(12))
    if not coarse:
        b.add_torus((0.0, 0.0, 1.455), 0.135, 0.032, STEEL, BODY, seg(28), seg(6, 4), (1.0, 0.95))
    if detail:
        for z in (0.975, 1.02):
            b.add_torus((0.0, 0.0, z), 0.178, 0.024, BELLOWS, BODY, seg(28), seg(6, 4), (1.0, 0.74))
    # Holster Rig belt and chest plate with the two pull tabs (safety yellow, small).
    if not coarse:
        b.add_torus((0.0, 0.005, 0.935), 0.18, 0.022, GRAPHITE, BODY, seg(28), seg(6, 4), (1.0, 0.75))
    if not coarse:
        b.add_superellipsoid((0.0, -0.137, 1.25), (0.105, 0.03, 0.075), GRAPHITE, BODY, 4.0, 4.0, seg(16), seg(6, 4))
    if detail:
        for side in (-1, 1):
            b.add_superellipsoid((side * 0.055, -0.168, 1.25), (0.017, 0.008, 0.024), HAZARD, BODY, 4.0, 4.0, 8, 4)

    # ---- Helmet: rounded-rect dome, smoked visor, player-colour crown ring, Clip Light (Crown Lamp L1)
    b.add_superellipsoid(HELMET_C, HELMET_HALF, SUIT, BODY, HELMET_E[0], HELMET_E[1], seg(40, 8), seg(20, 6))

    def visor_point(u, v, inset=0.0):
        s, t = 2.0 * u - 1.0, 2.0 * v - 1.0
        m = max(abs(s), abs(t))
        n = (abs(s) ** 4 + abs(t) ** 4) ** 0.25
        k = 0.0 if n == 0.0 else m / n
        x = 0.111 * s * k * (1.0 - inset)
        z = 1.678 + 0.09 * t * k * (1.0 - inset)
        return (x, helmet_front_y(x, z) - 0.009, z)

    b.add_patch(lambda u, v: visor_point(u, v), seg(12), seg(10), VISOR, (0.0, -1.0, 0.0), BODY)
    if detail:
        rim = []
        steps = seg(28, 12)
        for i in range(steps + 1):
            a = 2.0 * math.pi * i / steps
            u = 0.5 + 0.5 * math.cos(a)
            v = 0.5 + 0.5 * math.sin(a)
            p = visor_point(u, v, -0.035)
            rim.append((p[0], p[1] + 0.004, p[2]))
        b.add_tube(rim, [0.009] * len(rim), GRAPHITE, BODY, nu=6, cap_rings=1, caps=(False, False))
    a, bb, c = HELMET_HALF
    ring_z = 0.135
    scale = (1.0 - abs(ring_z / c) ** HELMET_E[1]) ** (1.0 / HELMET_E[1])
    b.add_torus(
        (0.0, 0.0, HELMET_C[2] + ring_z), a * scale + 0.006, 0.017, PLAYER_GLOW, BODY, seg(36, 10), seg(8, 4),
        (1.0, bb / a)
    )
    if not coarse:
        b.add_superellipsoid((0.0, -0.148, 1.79), (0.036, 0.026, 0.024), GRAPHITE, BODY, 3.0, 3.0, seg(14), seg(6, 4))
    if not coarse:
        b.add_superellipsoid((0.0, -0.172, 1.79), (0.025, 0.006, 0.017), LAMP_LENS, BODY, 2.5, 2.5, seg(12), seg(4, 4))

    # ---- Shoulder plates (player colour)
    for side in (-1, 1):
        rot = Matrix.Rotation(math.radians(-12.0 * side), 4, "Y")
        b.add_superellipsoid(
            (side * 0.214, 0.0, 1.402), (0.08, 0.115, 0.056), PLAYER_PLATE, BODY, 2.6, 2.6, seg(20), seg(8), rot
        )

    # ---- Pack: graphite shell, ivory lid, player-colour light strip, two Hop Pack nozzles
    b.add_superellipsoid((0.0, 0.245, 1.17), (0.19, 0.10, 0.25), GRAPHITE, BODY, 4.0, 4.0, seg(24), seg(10))
    if not coarse:
        b.add_superellipsoid((0.0, 0.335, 1.2), (0.15, 0.016, 0.19), SUIT, BODY, 5.0, 5.0, seg(20), seg(6, 4))
    if not coarse:
        b.add_superellipsoid((0.0, 0.353, 1.18), (0.017, 0.008, 0.15), PLAYER_GLOW, BODY, 4.0, 4.0, 8, seg(6, 4))
    for side in (-1, 1) if not coarse else ():
        b.add_tube(
            [(side * 0.1, 0.25, 0.94), (side * 0.1, 0.25, 0.885)], [0.03, 0.026], STEEL, BODY, seg(12), 1, 1.0,
            (False, True)
        )

    # ---- Dust Cell on the left back hip: graphite canister, player-colour window
    if not coarse:
        b.add_tube([(0.165, 0.11, 0.84), (0.165, 0.11, 0.99)], [0.052, 0.052], GRAPHITE, BODY, seg(16), caps)
    if not coarse:
        b.add_superellipsoid((0.205, 0.135, 0.915), (0.016, 0.022, 0.05), PLAYER_GLOW, BODY, 3.0, 3.0, 8, seg(6, 4))
    if detail:
        for z in (0.85, 0.98):
            b.add_torus((0.165, 0.11, z), 0.054, 0.008, STEEL, BODY, seg(16), 4)

    # ---- Legs: thigh (hip pivot), knee bellows + shin + boot (knee pivot)
    for side, thigh, shin in ((1, THIGH_L, SHIN_L), (-1, THIGH_R, SHIN_R)):
        hip, knee, ankle = mirror(HIP, side), mirror(KNEE, side), mirror(ANKLE, side)
        mid = (hip[0] * 0.5 + knee[0] * 0.5, -0.005, 0.72)
        b.add_tube(*trim([hip, mid, knee], [0.104, 0.097, 0.086]), SUIT, thigh, seg(16), caps)
        if detail:
            b.add_torus(knee, 0.083, 0.022, BELLOWS, shin, seg(16), seg(6, 4))
            b.add_torus((ankle[0], ankle[1], 0.185), 0.074, 0.018, BELLOWS, shin, seg(16), seg(6, 4))
        b.add_tube(*trim([knee, (ankle[0], -0.006, 0.33), ankle], [0.085, 0.08, 0.074]), SUIT, shin, seg(16), caps)
        # Boot (1.2x), Ballast Sole, yellow mag-plate tab.
        b.add_superellipsoid((ankle[0], -0.035, 0.092), (0.074, 0.155, 0.08), GRAPHITE, shin, 3.0, 3.0, seg(18), seg(8))
        if not coarse:
            b.add_superellipsoid((ankle[0], -0.035, 0.026), (0.081, 0.166, 0.028), SOLE, shin, 6.0, 6.0, seg(18), seg(6, 4))
        if fine:
            b.add_superellipsoid(
                (ankle[0] + side * 0.077, -0.03, 0.05), (0.006, 0.032, 0.014), HAZARD, shin, 4.0, 4.0, 8, 4
            )

    # ---- Arms: upper arm (shoulder pivot), elbow bellows + forearm + cuff + glove (elbow pivot)
    for side, upper, fore in ((1, UPPER_L, FORE_L), (-1, UPPER_R, FORE_R)):
        shoulder, elbow, wrist, glove = mirror(SHOULDER, side), mirror(ELBOW, side), mirror(WRIST, side), mirror(GLOVE, side)
        b.add_tube(*trim([shoulder, (side * 0.238, 0.0, 1.23), elbow], [0.074, 0.07, 0.064]), SUIT, upper, seg(16), caps)
        if detail:
            b.add_torus(elbow, 0.064, 0.02, BELLOWS, fore, seg(16), seg(6, 4))
        b.add_tube(*trim([elbow, (side * 0.258, -0.015, 0.985), wrist], [0.064, 0.06, 0.055]), SUIT, fore, seg(16), caps)
        if not coarse:
            b.add_torus((wrist[0], wrist[1], wrist[2] - 0.008), 0.058, 0.019, GRAPHITE, fore, seg(16), seg(6, 4))
        b.add_superellipsoid(glove, (0.046, 0.056, 0.07), SUIT, fore, 2.6, 2.4, seg(16), seg(8))
        if detail:
            b.add_superellipsoid(
                (glove[0] - side * 0.035, glove[1] - 0.04, glove[2] + 0.02), (0.018, 0.02, 0.034), SUIT, fore, 2.2,
                2.2, seg(10), seg(6, 4)
            )
    return b


def main():
    args = lib.cli_args()
    steps = lib.Steps()
    lib.reset_scene()
    lib.ensure_world(ao_distance=0.25)
    material = kit.flat_material(ASSET_ID)
    lods = []
    builders = []
    for lod in range(4):
        builder = build(lod)
        obj = builder.to_object(f"{ASSET_ID}_LOD{lod}", material)
        kit.shade_smooth(obj, 50.0)
        lods.append(obj)
        builders.append(builder)
    steps.mark("geometry")
    for obj in lods:
        kit.bake_ao_into_green(obj)
    steps.mark("vertex AO")

    sockets = [
        kit.add_socket("socket_hand_R", mirror(GLOVE, -1), 30.0),
        kit.add_socket("socket_hand_L", mirror(GLOVE, 1), 30.0),
        kit.add_socket("socket_nametag", (0.0, 0.0, 2.08)),
        kit.add_socket("socket_lamp", (0.0, -0.178, 1.79)),
    ]
    for side, tag in ((1, "L"), (-1, "R")):
        sockets += [
            kit.add_socket(f"pivot_hip_{tag}", mirror(HIP, side)),
            kit.add_socket(f"pivot_knee_{tag}", mirror(KNEE, side)),
            kit.add_socket(f"pivot_shoulder_{tag}", mirror(SHOULDER, side)),
            kit.add_socket(f"pivot_elbow_{tag}", mirror(ELBOW, side)),
        ]
    size = kit.export_glb(args.out, lods + sockets)
    steps.mark("export")

    low, top = lib.bounds(lods[0])
    helmet_bottom = HELMET_C[2] - HELMET_HALF[2]
    areas = kit.slot_areas(lods[0], SLOT_NAMES)
    total = sum(areas.values())
    lib.write_report(
        args.report,
        {
            "asset": ASSET_ID,
            "class": "custodian",
            "placeholder": True,
            "sizeM": [round(top[i] - low[i], 3) for i in range(3)],
            "heightM": round(top[2] - low[2], 3),
            "helmetM": {"height": round(top[2] - helmet_bottom, 3), "width": HELMET_HALF[0] * 2},
            "helmetHeights": round((top[2] - low[2]) / (top[2] - helmet_bottom), 3),
            "widthM": round(top[0] - low[0], 3),
            "shoulderWidthWithPauldronsM": round(2 * (0.214 + 0.08 * math.cos(math.radians(12)) + 0.056 * math.sin(math.radians(12))), 3),
            "crotchShare": round((0.905 - 0.125) / HEIGHT, 3),
            "lodTriangles": [lib.triangle_count(o) for o in lods],
            "slotAreaM2": areas,
            "slotShare": {k: round(v / total, 4) for k, v in areas.items()},
            "sockets": [s.name for s in sockets],
            "rawBytes": size,
            "steps": steps.items,
            "totalSeconds": steps.total(),
        },
    )
    print(f"[ctm] {ASSET_ID}: LOD triangles {[lib.triangle_count(o) for o in lods]}", flush=True)


main()
