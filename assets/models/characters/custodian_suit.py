"""Source script: custodian_suit (production custodian, M1-W4-T07).

The Brightside EVA custodian at the proportions of art-direction 4.1 (1.85 m, helmet 0.40 x 0.36 m = 4.6
helmet-heights, shoulders 0.62 m with pauldrons, crotch 44 %, gloves 1.15x, boots 1.2x, pack 0.50 x 0.38 x 0.20 m),
silhouette components of 4.2 (Crown Lamp Clip Light, smoked visor without LED eyes, ivory suit with teal bellows,
Holster Rig harness, life-support pack with Hop Pack nozzles and a player-colour strip, hip Dust Cell with its fill
window, Ballast Soles with the yellow mag-plate tab) and the colour slots of 4.3, incl. the player-colour slots and
the numeral glyph slot (shoulders, 4.4).

Joints, sockets and the rigid part partition are identical to the W3-T07 blockout, so the animator rig profile and the
blockout poser tuning carry over unchanged. A glTF skin (16 bones, 1 influence per vertex) is exported for W5-T04.
Original procedural asset for Clean The Moon!: no external meshes or textures.

    blender --background --python assets/models/characters/custodian_suit.py -- --out <raw.glb> --report <json> --texdir <dir>
"""

import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo

sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "tools", "asset-pipeline", "src", "blender"),
)

from mathutils import Matrix, Vector  # noqa: E402

import ctm_blockout as kit  # noqa: E402
import ctm_lib as lib  # noqa: E402
import ctm_production as prod  # noqa: E402

ASSET_ID = "custodian_suit"

# Material slots: the runtime palette (apps/client/src/visuals/characters/blockout/palette.ts) uses the same ids.
SUIT, BELLOWS, GRAPHITE, STEEL, HAZARD, PLAYER_PLATE, PLAYER_GLOW, VISOR, LAMP_LENS, SOLE = range(10)
GLYPH = 13
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
    GLYPH: "glyph",
}
# Rigid parts of the runtime shader (`material.ts`): 0 body, then thigh / shin / upper arm / forearm, left first.
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
PLATE_C = (0.214, 0.0, 1.402)
PLATE_HALF = (0.08, 0.115, 0.056)
PLATE_E = 2.6
PLATE_TILT = 12.0

# Segment factor per LOD (hero curves: helmet 48, torso 32, limbs 24 at LOD0; art-direction 13.3 >= 24 / 360 deg).
LOD_FACTOR = (0.7, 0.34, 0.27, 0.1)

# Skin (rig spec in the M1-W4-T07 report): name, parent, head, tail (Blender coords).
BONES = [
    ("root", None, (0.0, 0.0, 0.0), (0.0, 0.0, 0.12)),
    ("pelvis", "root", (0.0, 0.0, 0.93), (0.0, 0.0, 1.05)),
    ("spine", "pelvis", (0.0, 0.0, 1.05), (0.0, 0.0, 1.42)),
    ("head", "spine", (0.0, 0.0, 1.46), (0.0, 0.0, 1.85)),
]
for _side, _t in ((1, "L"), (-1, "R")):
    BONES += [
        (f"thigh_{_t}", "pelvis", (HIP[0] * _side, HIP[1], HIP[2]), (KNEE[0] * _side, KNEE[1], KNEE[2])),
        (f"shin_{_t}", f"thigh_{_t}", (KNEE[0] * _side, KNEE[1], KNEE[2]), (ANKLE[0] * _side, ANKLE[1], ANKLE[2])),
        (f"foot_{_t}", f"shin_{_t}", (ANKLE[0] * _side, ANKLE[1], ANKLE[2]), (ANKLE[0] * _side, -0.17, 0.05)),
        (f"upperarm_{_t}", "spine", (SHOULDER[0] * _side, 0.0, SHOULDER[2]), (ELBOW[0] * _side, 0.0, ELBOW[2])),
        (f"forearm_{_t}", f"upperarm_{_t}", (ELBOW[0] * _side, 0.0, ELBOW[2]), (WRIST[0] * _side, WRIST[1], WRIST[2])),
        (f"hand_{_t}", f"forearm_{_t}", (WRIST[0] * _side, WRIST[1], WRIST[2]), (GLOVE[0] * _side, -0.04, 0.73)),
    ]


def mirror(p, side):
    return (p[0] * side, p[1], p[2])


def helmet_front_y(x, z):
    """y of the helmet's front surface (facing -Y) at (x, z), from the superellipsoid's implicit form."""
    a, b, c = HELMET_HALF
    eh, ev = HELMET_E
    zz = abs((z - HELMET_C[2]) / c) ** ev
    left = max(0.0, 1.0 - zz) ** (eh / ev) - abs(x / a) ** eh
    return HELMET_C[1] - b * max(0.0, left) ** (1.0 / eh)


def plate_side_x(y, z):
    """Local |x| of the shoulder plate's outer surface at local (y, z) (superellipsoid, e = PLATE_E both ways)."""
    a, b, c = PLATE_HALF
    e = PLATE_E
    zz = abs(z / c) ** e
    left = max(0.0, 1.0 - zz) - abs(y / b) ** e
    return a * max(0.0, left) ** (1.0 / e)


def build(lod):
    f = LOD_FACTOR[lod]

    def seg(n, low=6):
        return max(low if lod < 3 else 4, int(round(n * f / 2.0)) * 2)

    b = prod.ProdBuilder(f"{ASSET_ID}_LOD{lod}")
    fine = lod == 0
    detail = lod <= 1
    mid = lod <= 2
    coarse = lod == 3
    caps = 2 if lod <= 1 else 1

    def trim(points, radii):
        return ([points[0], points[-1]], [radii[0], radii[-1]]) if coarse else (points, radii)

    # ================================================================== body: pelvis, torso, neck (bone pelvis/spine)
    b.bone = "pelvis"
    b.add_superellipsoid((0.0, 0.005, 0.905), (0.172, 0.125, 0.125), SUIT, BODY, 2.6, 2.2, seg(32), seg(12))
    if mid:
        # Holster Rig belt, front buckle, two side tool clips (holster level 1).
        b.add_torus((0.0, 0.005, 0.935), 0.18, 0.024, GRAPHITE, BODY, seg(36), seg(6, 4), (1.0, 0.75))
    if detail:
        b.add_superellipsoid((0.0, -0.142, 0.935), (0.04, 0.012, 0.03), STEEL, BODY, 4.0, 4.0, 12, 6)
        for side in (-1, 1):
            b.add_superellipsoid((side * 0.172, -0.035, 0.92), (0.012, 0.03, 0.045), GRAPHITE, BODY, 4.0, 4.0, 10, 6)
    b.bone = "spine"
    b.add_superellipsoid((0.0, 0.0, 1.17), (0.212, 0.145, 0.27), SUIT, BODY, 3.0, 2.4, seg(36), seg(16))
    # Waist bellows (teal): three soft rings.
    if detail:
        for z in (0.97, 1.005, 1.04):
            b.add_torus((0.0, 0.0, z), 0.177 - 0.004 * abs(z - 1.005) * 25, 0.022, BELLOWS, BODY, seg(36), seg(6, 4), (1.0, 0.74))
    elif mid:
        b.add_torus((0.0, 0.0, 1.0), 0.178, 0.028, BELLOWS, BODY, seg(28), 4, (1.0, 0.74))
    if mid:
        b.add_torus((0.0, 0.0, 1.455), 0.135, 0.032, STEEL, BODY, seg(36), seg(6, 4), (1.0, 0.95))
    if fine:
        # Quilted chest panel seams: two soft horizontal ribs across the ivory chest.
        for z in (1.12, 1.33):
            k = 1.0 - ((z - 1.17) / 0.27) ** 2
            b.add_torus((0.0, 0.0, z), 0.203 * max(k, 0.3) ** 0.42, 0.006, SUIT, BODY, seg(36), 4, (1.0, 0.7))
    if mid:
        # Chest control box (graphite) with two yellow pull tabs, three steel buttons and the Brightside badge.
        b.add_superellipsoid((0.0, -0.14, 1.25), (0.105, 0.032, 0.075), GRAPHITE, BODY, 4.0, 4.0, seg(20), seg(6, 4))
    if detail:
        for side in (-1, 1):
            b.add_superellipsoid((side * 0.055, -0.172, 1.25), (0.017, 0.008, 0.024), HAZARD, BODY, 4.0, 4.0, 8, 4)
        for x in (-0.02, 0.0, 0.02) if fine else ():
            b.add_tube([(x, -0.168, 1.29), (x, -0.18, 1.29)], [0.0075, 0.0075], STEEL, BODY, 10, 1, 1.0, (False, True))
        # Brightside badge on the left chest: teal disc with an ivory crescent.
        b.add_tube([(0.06, -0.118, 1.375), (0.06, -0.142, 1.375)], [0.026, 0.026], BELLOWS, BODY, seg(20), 1, 1.0, (False, True))
        crescent = [(0.06 + 0.015 * math.cos(math.radians(a)), -0.143, 1.375 + 0.015 * math.sin(math.radians(a))) for a in range(100, 261, 20)]
        b.add_tube(crescent, [0.0035] * len(crescent), SUIT, BODY, 6, 1, 1.0, (True, True))
        # Umbilical hoses: chest box sides to the pack (graphite).
        for side in (-1, 1):
            hose = [
                (side * 0.105, -0.135, 1.22),
                (side * 0.19, -0.11, 1.17),
                (side * 0.225, -0.02, 1.12),
                (side * 0.2, 0.13, 1.1),
            ]
            b.add_tube(hose, [0.014] * 4, GRAPHITE, BODY, seg(12), 1, 1.0, (False, False))
            for k in range(1, 3) if fine else ():
                p = Vector(hose[k])
                b.add_torus(tuple(p), 0.0165, 0.004, STEEL, BODY, 12, 4, (1.0, 1.0), Matrix.Rotation(math.radians(90.0), 4, "Y"))
    if mid:
        # Holster Rig chest straps over the shoulders to the pack.
        for side in (-1, 1):
            strap = [
                (side * 0.1, -0.14, 0.955),
                (side * 0.13, -0.158, 1.12),
                (side * 0.14, -0.15, 1.33),
                (side * 0.13, -0.09, 1.45),
                (side * 0.13, 0.04, 1.47),
                (side * 0.13, 0.14, 1.42),
            ]
            b.add_tube(strap, [0.011] * len(strap), GRAPHITE, BODY, seg(10), 1, 0.45, (False, False))

    # ================================================================== helmet (bone head)
    b.bone = "head"
    b.add_superellipsoid(HELMET_C, HELMET_HALF, SUIT, BODY, HELMET_E[0], HELMET_E[1], seg(48, 8), seg(24, 6))

    def visor_point(u, v, inset=0.0):
        s, t = 2.0 * u - 1.0, 2.0 * v - 1.0
        m = max(abs(s), abs(t))
        n = (abs(s) ** 4 + abs(t) ** 4) ** 0.25
        k = 0.0 if n == 0.0 else m / n
        x = 0.111 * s * k * (1.0 - inset)
        z = 1.678 + 0.09 * t * k * (1.0 - inset)
        return (x, helmet_front_y(x, z) - 0.009, z)

    b.add_patch(lambda u, v: visor_point(u, v), seg(16), seg(12), VISOR, (0.0, -1.0, 0.0), BODY)
    if mid:
        rim = []
        steps = seg(36, 12)
        for i in range(steps + 1):
            a = 2.0 * math.pi * i / steps
            p = visor_point(0.5 + 0.5 * math.cos(a), 0.5 + 0.5 * math.sin(a), -0.035)
            rim.append((p[0], p[1] + 0.004, p[2]))
        b.add_tube(rim, [0.0095] * len(rim), GRAPHITE, BODY, nu=6 if detail else 4, cap_rings=1, caps=(False, False))
    if detail:
        # Sunshade brow: a soft ivory ridge above the visor.
        brow = []
        for i in range(13):
            x = -0.12 + 0.24 * i / 12
            z = 1.8 - 0.012 * (x / 0.12) ** 2
            brow.append((x, helmet_front_y(x, z) + 0.004, z))
        b.add_tube(brow, [0.013] * len(brow), SUIT, BODY, 8, 1, 0.6, (True, True))
        # Side comm pods (graphite discs with a steel cap).
        for side in (-1, 1):
            x = side * 0.178
            b.add_tube([(x, 0.0, 1.66), (x + side * 0.022, 0.0, 1.66)], [0.045, 0.04], GRAPHITE, BODY, seg(24), 1, 1.0, (False, True))
            b.add_tube([(x + side * 0.022, 0.0, 1.66), (x + side * 0.027, 0.0, 1.66)], [0.026, 0.022], STEEL, BODY, seg(16), 1, 1.0, (False, True))
    a, bb, c = HELMET_HALF
    ring_z = 0.135
    scale = (1.0 - abs(ring_z / c) ** HELMET_E[1]) ** (1.0 / HELMET_E[1])
    b.add_torus(
        (0.0, 0.0, HELMET_C[2] + ring_z), a * scale + 0.006, 0.017, PLAYER_GLOW, BODY, seg(48, 10), seg(6, 4), (1.0, bb / a)
    )
    if mid:
        # Clip Light (Crown Lamp level 1): graphite housing, warm lens, steel clip.
        b.add_superellipsoid((0.0, -0.148, 1.79), (0.036, 0.026, 0.024), GRAPHITE, BODY, 3.0, 3.0, seg(18), seg(6, 4))
        b.add_superellipsoid((0.0, -0.172, 1.79), (0.025, 0.006, 0.017), LAMP_LENS, BODY, 2.5, 2.5, seg(16), seg(6, 4))
    if detail:
        b.add_superellipsoid((0.0, -0.12, 1.815), (0.012, 0.03, 0.006), STEEL, BODY, 4.0, 4.0, 8, 4)
    if mid:
        # Helmet neck seal (graphite) under the dome.
        b.add_torus((0.0, 0.0, 1.475), 0.142, 0.022, GRAPHITE, BODY, seg(36), seg(6, 4), (1.0, 0.95))

    # ================================================================== shoulder plates (player colour) + numeral glyphs
    b.bone = "spine"
    for side in (-1, 1):
        rot = Matrix.Rotation(math.radians(-PLATE_TILT * side), 4, "Y")
        centre = Vector(mirror(PLATE_C, side))
        b.add_superellipsoid(tuple(centre), PLATE_HALF, PLAYER_PLATE, BODY, PLATE_E, PLATE_E, seg(28), seg(12), rot)
        if mid:
            # Curved decal on the plate's outer face: numeral 1..16 (atlas cell picked per player in the shader).
            def glyph_point(u, v, side=side, rot=rot, centre=centre):
                y = (u - 0.5) * 0.105 * side
                z = (v - 0.5) * 0.075
                x = plate_side_x(y, z) + 0.0018
                return tuple(rot @ Vector((side * x, y, z)) + centre)

            b.add_decal(glyph_point, 6 if detail else 2, 4 if detail else 2, GLYPH, (side * 1.0, 0.0, 0.0), BODY)

    # ================================================================== pack (bone spine)
    b.add_superellipsoid((0.0, 0.245, 1.17), (0.19, 0.10, 0.25), GRAPHITE, BODY, 4.0, 4.0, seg(32), seg(12))
    if mid:
        b.add_superellipsoid((0.0, 0.335, 1.2), (0.15, 0.018, 0.19), SUIT, BODY, 5.0, 5.0, seg(24), seg(6, 4))
        b.add_superellipsoid((0.0, 0.355, 1.18), (0.017, 0.008, 0.15), PLAYER_GLOW, BODY, 4.0, 4.0, 8, seg(6, 4))
    if detail:
        # Vent slats on the lid, side carry handles, antenna stub.
        for z in (1.335, 1.305, 1.275):
            b.add_superellipsoid((0.0, 0.355, z), (0.12, 0.006, 0.006), GRAPHITE, BODY, 6.0, 4.0, 12, 4)
        for side in (-1, 1) if fine else ():
            handle = [(side * 0.19, 0.2, 1.3), (side * 0.215, 0.24, 1.3), (side * 0.215, 0.24, 1.08), (side * 0.19, 0.2, 1.08)]
            b.add_tube(handle, [0.008] * 4, STEEL, BODY, 8, 1, 1.0, (False, False))
        b.add_tube([(-0.13, 0.27, 1.41), (-0.13, 0.27, 1.53)], [0.007, 0.005], STEEL, BODY, 8, 1, 1.0, (False, True))
        b.add_superellipsoid((-0.13, 0.27, 1.54), (0.012, 0.012, 0.012), GRAPHITE, BODY, 2.0, 2.0, 10, 6)
    for side in (-1, 1) if mid else ():
        # Hop Pack nozzles (level 1: two), steel bell with a graphite throat.
        b.add_tube(
            [(side * 0.1, 0.25, 0.94), (side * 0.1, 0.25, 0.905), (side * 0.1, 0.25, 0.875)],
            [0.026, 0.03, 0.036], STEEL, BODY, seg(20), 1, 1.0, (False, False)
        )
        if detail:
            b.add_tube([(side * 0.1, 0.25, 0.9), (side * 0.1, 0.25, 0.876)], [0.022, 0.028], GRAPHITE, BODY, seg(16), 1, 1.0, (False, False))

    # ================================================================== Dust Cell on the left back hip (bone pelvis)
    b.bone = "pelvis"
    if mid:
        b.add_tube([(0.165, 0.11, 0.835), (0.165, 0.11, 0.995)], [0.053, 0.053], GRAPHITE, BODY, seg(24), caps)
        b.add_superellipsoid((0.207, 0.135, 0.915), (0.016, 0.024, 0.055), PLAYER_GLOW, BODY, 3.0, 3.0, 10, seg(6, 4))
    if detail:
        for z in (0.845, 0.985):
            b.add_torus((0.165, 0.11, z), 0.055, 0.009, STEEL, BODY, seg(24), 6)
        b.add_torus((0.165, 0.11, 0.915), 0.0545, 0.004, STEEL, BODY, seg(24), 4)  # level band I
        b.add_superellipsoid((0.165, 0.055, 0.935), (0.02, 0.012, 0.03), GRAPHITE, BODY, 4.0, 4.0, 8, 4)  # bracket

    # ================================================================== legs
    for side, thigh, shin, tag in ((1, THIGH_L, SHIN_L, "L"), (-1, THIGH_R, SHIN_R, "R")):
        hip, knee, ankle = mirror(HIP, side), mirror(KNEE, side), mirror(ANKLE, side)
        b.bone = f"thigh_{tag}"
        midp = (hip[0] * 0.5 + knee[0] * 0.5, -0.005, 0.72)
        b.add_tube(*trim([hip, midp, knee], [0.104, 0.097, 0.086]), SUIT, thigh, seg(32), caps)
        if detail:
            # Hip bearing ring and a thigh cargo pocket (right leg) / tape-strap (left leg).
            b.add_torus((hip[0], hip[1], 0.86), 0.102, 0.009, BELLOWS, thigh, seg(24), 6)
            if side < 0:
                b.add_superellipsoid((hip[0] - 0.088, -0.01, 0.7), (0.022, 0.06, 0.07), GRAPHITE, thigh, 4.0, 3.0, 12, 8)
                b.add_superellipsoid((hip[0] - 0.105, -0.01, 0.748), (0.008, 0.062, 0.018), GRAPHITE, thigh, 4.0, 4.0, 10, 4)
            else:
                b.add_torus((midp[0], midp[1], 0.74), 0.099, 0.006, GRAPHITE, thigh, seg(24), 4)
        b.bone = f"shin_{tag}"
        if detail:
            b.add_torus(knee, 0.084, 0.022, BELLOWS, shin, seg(24), seg(6, 4))
            if fine:
                b.add_torus((knee[0], knee[1], knee[2] - 0.035), 0.082, 0.018, BELLOWS, shin, seg(24), seg(6, 4))
            b.add_torus((ankle[0], ankle[1], 0.19), 0.074, 0.018, BELLOWS, shin, seg(24), seg(6, 4))
        if mid:
            # Knee pad (graphite) over the bellows.
            b.add_superellipsoid((knee[0], knee[1] - 0.075, knee[2] - 0.01), (0.06, 0.03, 0.075), GRAPHITE, shin, 3.0, 2.6, seg(16), seg(6, 4))
        b.add_tube(*trim([knee, (ankle[0], -0.006, 0.33), ankle], [0.085, 0.08, 0.074]), SUIT, shin, seg(32), caps)
        b.bone = f"foot_{tag}"
        # Boot (1.2x): graphite upper, toe cap, Ballast Sole with a yellow mag-plate tab, strap and buckle.
        b.add_superellipsoid((ankle[0], -0.035, 0.095), (0.076, 0.155, 0.082), GRAPHITE, shin, 3.0, 3.0, seg(24), seg(10))
        if mid:
            b.add_superellipsoid((ankle[0], -0.035, 0.026), (0.083, 0.168, 0.03), SOLE, shin, 6.0, 6.0, seg(24), seg(6, 4))
        if detail:
            b.add_superellipsoid((ankle[0], -0.15, 0.07), (0.07, 0.05, 0.05), SOLE, shin, 3.0, 3.0, seg(16), seg(6, 4))
            b.add_torus((ankle[0], -0.01, 0.14), 0.072, 0.008, GRAPHITE, shin, seg(20), 4, (1.0, 1.25))
            b.add_superellipsoid((ankle[0] - side * 0.074, -0.03, 0.14), (0.006, 0.016, 0.012), STEEL, shin, 4.0, 4.0, 8, 4)
        if fine:
            b.add_superellipsoid((ankle[0] + side * 0.081, -0.03, 0.05), (0.006, 0.034, 0.014), HAZARD, shin, 4.0, 4.0, 8, 4)

    # ================================================================== arms
    for side, upper, fore, tag in ((1, UPPER_L, FORE_L, "L"), (-1, UPPER_R, FORE_R, "R")):
        shoulder, elbow, wrist, glove = mirror(SHOULDER, side), mirror(ELBOW, side), mirror(WRIST, side), mirror(GLOVE, side)
        b.bone = f"upperarm_{tag}"
        b.add_tube(*trim([shoulder, (side * 0.238, 0.0, 1.23), elbow], [0.074, 0.07, 0.064]), SUIT, upper, seg(32), caps)
        if detail:
            # Shoulder bearing ring (steel) under the plate.
            b.add_torus((side * 0.228, 0.0, 1.29), 0.073, 0.01, STEEL, upper, seg(24), 6)
        b.bone = f"forearm_{tag}"
        if detail:
            b.add_torus(elbow, 0.065, 0.02, BELLOWS, fore, seg(24), seg(6, 4))
            if fine:
                b.add_torus((elbow[0], elbow[1], elbow[2] - 0.03), 0.063, 0.017, BELLOWS, fore, seg(24), seg(6, 4))
        b.add_tube(*trim([elbow, (side * 0.258, -0.015, 0.985), wrist], [0.064, 0.06, 0.055]), SUIT, fore, seg(32), caps)
        if detail and side > 0:
            # Cuff checklist pocket on the left forearm.
            b.add_superellipsoid((side * 0.262, -0.07, 0.97), (0.035, 0.012, 0.05), GRAPHITE, fore, 4.0, 4.0, 10, 6)
        if mid:
            b.add_torus((wrist[0], wrist[1], wrist[2] - 0.006), 0.058, 0.019, GRAPHITE, fore, seg(24), seg(6, 4))
        b.bone = f"hand_{tag}"
        # Glove (1.15x): gauntlet, palm, thumb, fingers (LOD0 four fingers; LOD1 mitten; far LODs a single mitt).
        if detail:
            b.add_tube(
                [(wrist[0], wrist[1], wrist[2] - 0.02), (glove[0], glove[1] + 0.003, glove[2] + 0.045)],
                [0.056, 0.05], SUIT, fore, seg(20), 1, 1.0, (False, False)
            )
        b.add_superellipsoid(glove, (0.046, 0.056, 0.062), SUIT, fore, 2.6, 2.4, seg(20), seg(10))
        if fine:
            for k in range(4):
                fy = glove[1] - 0.034 + k * 0.023
                b.add_tube(
                    [(glove[0] + side * 0.002, fy, glove[2] - 0.045), (glove[0] + side * 0.004, fy - 0.006, glove[2] - 0.095)],
                    [0.0125, 0.011], SUIT, fore, 8, 1, 1.0, (False, True)
                )
        elif detail:
            b.add_superellipsoid((glove[0], glove[1], glove[2] - 0.075), (0.03, 0.05, 0.035), SUIT, fore, 2.6, 2.4, 12, 6)
        if detail:
            b.add_tube(
                [(glove[0] - side * 0.03, glove[1] - 0.045, glove[2] + 0.02), (glove[0] - side * 0.045, glove[1] - 0.06, glove[2] - 0.03)],
                [0.017, 0.014], SUIT, fore, 10, 2, 1.0, (False, True)
            )
            # Graphite grip patch on the palm.
            b.add_superellipsoid((glove[0] - side * 0.035, glove[1] - 0.005, glove[2] - 0.01), (0.012, 0.04, 0.04), GRAPHITE, fore, 3.0, 3.0, 10, 6)
    return b


def tri_by_slot(builder):
    out = {}
    for face, slot in zip(builder.faces, builder.face_slot):
        name = SLOT_NAMES.get(slot, str(slot))
        out[name] = out.get(name, 0) + len(face) - 2
    return dict(sorted(out.items()))


def main():
    args = lib.cli_args()
    steps = lib.Steps()
    lib.reset_scene()
    lib.ensure_world(ao_distance=0.25)
    glyphs, glyph_bytes = prod.glyph_atlas(os.path.join(args.texdir, "custodian_glyphs.png"))
    material = prod.glyph_material(ASSET_ID, glyphs)
    steps.mark("glyph atlas")
    lods, builders = [], []
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
    arm = prod.build_armature(f"{ASSET_ID}_rig", BONES)
    bone_vertices = [prod.skin_to(obj, builder, arm) for obj, builder in zip(lods, builders)]
    steps.mark("skin")

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
    size = prod.export_skinned_glb(args.out, [arm] + lods + sockets)
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
            "placeholder": False,
            "sizeM": [round(top[i] - low[i], 3) for i in range(3)],
            "heightM": round(top[2] - low[2], 3),
            "helmetHeights": round((top[2] - low[2]) / (top[2] - helmet_bottom), 3),
            "lodTriangles": [lib.triangle_count(o) for o in lods],
            "bones": [b[0] for b in BONES],
            "boneVerticesLOD0": bone_vertices[0],
            "trianglesBySlotLOD0": tri_by_slot(builders[0]),
            "slotAreaM2": areas,
            "slotShare": {k: round(v / total, 4) for k, v in areas.items()},
            "glyphAtlasPngBytes": glyph_bytes,
            "sockets": [s.name for s in sockets],
            "rawBytes": size,
            "steps": steps.items,
            "totalSeconds": steps.total(),
        },
    )
    print(f"[ctm] {ASSET_ID}: LOD triangles {[lib.triangle_count(o) for o in lods]}", flush=True)


main()
