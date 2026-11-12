# Animation specification: Clean The Moon!

Direction: `docs/design/REFERENCE_TARGET.md` overrides retired naming/style/custom-gate rules.

Status: **Planning baseline (2026-11-12).** Owner: animation-engineer. Reviewers: visual-qa-reviewer (look, acceptance), performance-reviewer (budgets). The lead approves changes.
Title note: **Clean The Moon!** is the owner-selected game title; use exact capitalization and punctuation. Keep package/save IDs stable.
Decision record: [ADR-0011](../adr/0011-animation-pipeline.md) (pipeline), [ADR-0027](../adr/0027-3d-art-production-path.md) (production path). Inputs: [art-direction §4–§6, §9–§13](art-direction.md), [naming-bible](naming-bible.md), [GDD §9](GDD.md#9-controls), [progression-and-economy §3–§4, §7](progression-and-economy.md), [scope-tiers](scope-tiers.md), [performance-budgets](../architecture/performance-budgets.md), [rendering-pipeline §3, §10, §14](../architecture/rendering-pipeline.md), [netcode §4.5, §5, §6](../architecture/netcode.md), [world-and-dust-simulation §4.4](../architecture/world-and-dust-simulation.md), [module-boundaries](../architecture/module-boundaries.md), [visual-target](visual-target.md).

Scope: this file covers everything that moves in `apps/client/src/animation/**`. That means the custodian, the vehicles, the robots, the machines and the world motion, plus the clip data in `assets/animations/**`. Animation is a **pure consumer**. It reads sim state and events and never mutates sim state. It emits only presentation events (§3.6).

Names: use the editable naming catalog. Ordinary descriptive labels are allowed; preserve clip/bone/event IDs unless a contract migration requires a change. §A9 supplies current defaults.

---

## 0. Numbers used throughout

| Quantity | Value | Source |
| --- | --- | --- |
| Lunar gravity g | 1.62 m/s² (Ballast Soles: 9.81 for the wearer) | economy §1 |
| Sweep-walk / Walk / Lope | 2.2 / 3.4 / 5.0 m/s; Cadence up to +20 %, Second Wind +8 % | economy §3, §7 |
| Jump apex | 1.6 m (Loft +20 % / +40 % → 1.92 / 2.24 m) | economy §3 |
| Jump take-off speed v₀ = √(2 g h) | 2.28 m/s (Loft II: 2.69 m/s) | derived |
| Flat-ground air time 2 v₀ / g | **2.81 s** (Loft II: 3.33 s) | derived |
| Hop Pack burst | +3.0 m/s forward-up impulse, 2–4 bursts | economy §3 |
| Tool stroke (one traverse of the sim sweep) | Desk Duster 0.45 · Crescent Squeegee 0.55 · Bristle Broom 0.70 · Lane Broom 0.80 · Static Rake 0.90 · Ion Curtain 1.00 s | economy §4 |
| Tool reach | 1.2 / 1.4 / 1.8 / 2.0 / 2.6 / 3.0 m (T1→T6) | economy §4 |
| Pour at the Assay Counter | 6 s × (1 − Quick Pour) × (0.5 with Smooth Handoff), so 1.2–6 s | economy §6–§8 |
| Custodian | 1.85 m tall, crotch 44 % (hip joint ≈ 0.86 m), boot print 30 × 12 cm | art-direction §4.1, §3.5 |
| Sim tick / snapshot | 20 Hz / 10 Hz; remote interpolation delay 150–250 ms | netcode N4, §6 |
| Moon radius (Standard Contract) | 2,000 m; up = normalize(position) | ADR-0007/0008 |

---

## 1. Pipeline

### 1.1 Skeleton standard: custodian (`rig.custodian`)

One canonical skeleton serves every custodian (all liveries, all 16 player colours and all LODs). There are no proportion variants. M1-W4-T07 (technical-artist) builds the mesh to this joint list and publishes the bind-pose numbers in its report. Joint names are exact, lowercase snake_case, with side suffix `_l`/`_r`. No namespace prefixes are allowed (`mixamorig:`, `Armature|`, `DEF-`).

| # | Joint | Parent | Deform | Notes |
| --- | --- | --- | --- | --- |
| 0 | `root` | (skin root) | no weights | On the ground under the pelvis. **Never animated** (identity in every clip) |
| 1 | `pelvis` | root | yes | The **only joint with translation keys** |
| 2–4 | `spine_01`, `spine_02`, `spine_03` | pelvis → … | yes | spine_03 = chest; pack and Holster Rig ride on it |
| 5 | `neck` | spine_03 | yes | |
| 6 | `head` | neck | yes | Helmet is rigid on the head; Crown Lamp ring included |
| 7–18 | `clavicle_l`, `upperarm_l`, `upperarm_twist_l`, `forearm_l`, `forearm_twist_l`, `hand_l`, `thumb_01_l`, `thumb_02_l`, `index_01_l`, `index_02_l`, `grip_01_l`, `grip_02_l` | chain | yes | `grip_*` = middle+ring+little merged (EVA glove, art-direction §4.1). Twist joints are **procedural** (50 % of the hand roll), never keyed |
| 19–30 | same as 7–18 with `_r` | chain | yes | |
| 31–34 | `thigh_l`, `calf_l`, `foot_l`, `ball_l` | pelvis → … | yes | |
| 35–38 | `thigh_r`, `calf_r`, `foot_r`, `ball_r` | | yes | |
| 39 | `pack` | spine_03 | yes | Life-support pack; spring (§4.7) |
| 40–43 | `hose_l_01`, `hose_l_02`, `hose_r_01`, `hose_r_02` | pack | yes | Spring chains (§4.7) |
| 44 | `dust_cell` | pelvis | yes | Hip-mounted Dust Cell; spring |
| 45 | `holster` | spine_03 | yes | Holster Rig harness; carries the holster sockets |

**46 joints** against the 64 cap (art-direction §9), which leaves 18 spare for v1.0 (for example visor-flip or cosmetic dangles). Skinning uses ≤ 4 influences per vertex, normalised, with weights < 0.01 pruned.

**Sockets** are plain glTF nodes parented under joints. They are not skin joints and cost nothing in the bone buffer. Each socket's position and rotation are fixed in the rig spec.

| Socket | Parent | Use |
| --- | --- | --- |
| `socket_tool_r`, `socket_tool_l` | hand_r / hand_l | Tool primary / secondary grip (two-handed tools: §4.6) |
| `socket_holster_01` … `_06` | holster | Clipped tools, by Holster Rig level |
| `socket_cell_window` | dust_cell | Cell tap and pour target |
| `socket_puck_r`, `socket_stack` | hand_r / spine_03 | Carried Dust Puck / Puck Stack |
| `socket_hop_nozzle_01` … `_04` | pack | Hop Pack plume VFX anchors (visuals reads them) |
| `socket_eye` | head | First-person camera anchor |
| `socket_nametag` | head | UI label anchor (+0.35 m) |
| `socket_lamp` | head | Crown Lamp light origin |

**Conventions:** glTF +Y up, +Z forward, metres, unit scale. There is no non-uniform or animated scale anywhere. The bind pose is an **A-pose** (arms 45° down, palms in), which deforms suit bellows better than a T-pose. The bind pose is never displayed (§9).

### 1.2 Other rigs

| Rig | Joints / parts | Method |
| --- | --- | --- |
| `rig.sandpiper` | 14 rigid parts: root, body, neck_01, neck_02, head, beak_brush, hip/knee/ankle/toe × 2 | **Instanced rigid skinning** (§6.1): each vertex weighted 1.0 to one part; ≤ 24 parts (art-direction §9) |
| `rig.plover` | 16: Sandpiper set + `collar`, `beak_brush_b` (second brush beak) | same |
| `rig.albatross` | 20: root, body, neck, head, wing_l_01–03, wing_r_01–03, claw_l, claw_r, nozzle_cluster, hip/knee/foot × 2 | same |
| Vehicles | Node hierarchy, no skin: `chassis` → `body` (sprung, §5.1), `susp_<id>` → `wheel_<id>` / `steer_<id>`, `drum` / `roller_<n>`, `seat_<n>` (+ `seat_<n>_socket`), `handle_grip_l/r` (Trundle), `hopper` (tip pivot), `mast` (Carryall), `body_rear` + `hitch` (Bulldust), `track_l/r` (Behemoth, §5.6) | Rigid node transforms; Behemoth track belts are the only skinned vehicle parts (≤ 9 joints per belt) |
| Machines | Node hierarchy per machine (§7) | Rigid node transforms |

Wheel IDs use `fl, fr, ml, mr, rl, rr` (front/mid/rear, left/right). M1-W7-T02 (technical-artist) builds the Trundle and Skiff to these node names. This is the "suspension/bone naming spec" that M1-W7-T02 waits on.

### 1.3 Root motion policy

- **All clips are in place.** The sim owns movement (ADR-0010). `root` is identity in every clip, and the import check fails a clip if `root` moves by more than 1 mm or rotates by more than 0.1°.
- `pelvis` may translate. Horizontal sway is limited to ±6 cm, and forward drift across a loop is ≤ 1 mm (the loop closes).
- Speed matching: playback rate `r = v_sim / v_authored`, clamped to **[0.75, 1.25]**. Outside that range the 1D blend moves to the neighbouring clip (§3.2). Foot locking (§4.3) absorbs the leftover mismatch.
- Facing comes from the sim yaw. Animation never turns the avatar on its own. It only adds a visual yaw smoother (τ 90 ms) on top of the sim yaw for remote avatars.
- Vertical bob during locomotion comes from the clip, corrected by the low-g bounce gain (§4.1). The sim position does not bob.

### 1.4 Source data, export and delivery

| Step | Rule |
| --- | --- |
| Authoring | Original keyframed clips (art-direction §13.1 animation path). With headless Blender (Q23): `.blend` pose libraries + scripted keys. Without Blender: JSON pose libraries + key curves in `assets/animations/<rig>/src/`, built by a Node recipe into glTF. Big sources stay out of git (ADR-0017); committed sources ≤ 1 MB per file |
| Clip glTF | One **animation-only** `.glb` per rig: `<rig>.anims.glb`, holding the joint node hierarchy (no meshes) and one glTF `animation` per clip, whose `animation.name` = clip ID. Tool-specific v1.0 clips go in a second pack, `custodian.anims.v1.glb`, loaded on first equip or behind the lobby |
| Channels | Rotation (quaternion) for every keyed joint; translation for `pelvis` only; **no scale channels**. Sampler interpolation **LINEAR** only (CUBICSPLINE triples the memory; STEP is forbidden) |
| Sampling | Author at 30 fps. Loops: the first key equals the last key (quaternion dot ≥ 0.99999). Clips start at t = 0 |
| Sidecar | `<rig>.anims.meta.json` (§1.6) holds what glTF cannot: events, foot-plant masks, sync markers, authored speed, layer, additive reference, licence |
| Build (glTF-Transform) | `prune` → `dedup` → **`resample` (tolerance 1e-4 rad / 0.5 mm)** → strip scale tracks, translation tracks except pelvis, and constant tracks equal to bind → **`meshopt` (EXT_meshopt_compression) with the QUATERNION filter (16-bit) for rotations and 16-bit translations** → Brotli at the CDN. The recipe lives in `tools/asset-pipeline/` (technical-artist) at animation-engineer's request |
| Output | `apps/client/public/assets/animations/<rig>.anims.<hash>.glb` + `.meta.<hash>.json` (content-hashed, module-boundaries §3) |
| Runtime | GLTFLoader + meshopt decoder (already in the asset path). Clips are shared: **one `AnimationClip` per clip ID per process**, bound by joint name to each avatar's skeleton |

### 1.5 Retargeting

- Default: **none at runtime.** Every clip is authored on `rig.custodian`.
- An external CC0 clip (§1.8) is retargeted **offline** in the build recipe and baked to `rig.custodian`. The recipe maps bone names from a table, aligns rest poses with rotation-only deltas, scales pelvis translation by the hip-height ratio (target 0.95 m pelvis height), and re-derives the foot-plant masks.
- `SkeletonUtils.retargetClip` is not used at runtime, because of its cost and allocations.
- Validation for each release: a unit test plays every locomotion clip on the bind skeleton and asserts the foot-plant masks still hold (foot speed < 0.15 m/s during plant).

### 1.6 Clip IDs and the sidecar

**Clip ID:** `<rig>.<group>.<subject>[.<variant>]`, lowercase snake segments. `rig` ∈ `cust`, `sandpiper`, `plover`, `albatross`. `group` ∈ `idle`, `loco`, `air`, `land`, `gear`, `tool`, `carry`, `pour`, `interact`, `veh`, `emote`, `react`. Tool subjects use the naming-bible tool ID without `tool.` (`bristle_broom`) or a tool class (`palm`, `blade`, `broom`, `bar`, `comb`, `curtain`, §2.6). Examples: `cust.loco.lope`, `cust.tool.broom.sweep`, `cust.veh.ride_open.mount`, `cust.emote.hail`.

**Event ID:** snake_case, unique within a clip (§2 tables). **Sidecar entry (per clip):**

```
{ id, durationS, loop, layer: "base"|"upper"|"additive_upper"|"additive_full",
  mask: "full"|"lower"|"upper", authoredSpeedMps?, syncGroup?, syncMarkers: [{name, t}],
  events: [{id, t}], footPlant: {l: [[t0,t1]...], r: [...]}, additiveRef?: {clip, frame},
  tier: "mvp"|"v1", source: {origin: "original"|"cc0", author, license, ledgerRow} }
```

animation-engineer owns the zod schema for this file (in `apps/client/src/animation/`). The build fails if a clip has no sidecar entry, if an event time is out of range, or if `ledgerRow` is missing.

### 1.7 Budgets

| Budget | MVP (M1) | v1.0 (M2) |
| --- | --- | --- |
| Custodian joints | 46 (cap 64) | ≤ 64 |
| Robot parts | Sandpiper 14 | ≤ 24 each |
| Custodian clips | ≤ 70 (§2 lists 65) | ≤ 130 |
| Clip download (Brotli, all rigs) | ≤ 350 KB | ≤ 900 KB (lazy v1 pack included) |
| Clip memory (JS heap, decoded Float32) | ≤ 2.5 MB | ≤ 6 MB |
| Active `AnimationAction`s per avatar | ≤ 10 with weight > 0 | ≤ 10 |
| Skinned draws per player | 1 skinned body (body + helmet merged) + 1 rigid tool (rendering-pipeline §10.2: ≤ 2) | same |
| CPU | §8.2 | §8.2 |

### 1.8 Sourcing and licences

| Source | Allowed | Rule |
| --- | --- | --- |
| Original (animation-engineer) | Yes, the default | Ledger row: origin original, author role, date |
| CC0 (for example Kenney animation packs) | Placeholders, or bases that are retargeted and re-keyed | Ledger row with URL, licence and download date; never shipped unmodified for a hero action |
| Commissioned | Only if Cee funds it (ADR-0027) | Work-for-hire terms in the ledger |
| CMU mocap (original site) | Only after the human confirmation in art-direction §11 | Never the 4TU NC conversion |
| **Mixamo, Quaternius** | **Prototype only, private storage, never committed** (ADR-0011, ADR-0027) | The CI ban-list greps `assets/**` for `mixamo`, `mixamorig` and `quaternius` (case-insensitive) |
| AI-generated motion | No, until OPEN_QUESTIONS Q15 closes | — |

Every clip gets a row in `docs/ASSET_LICENSES.md` before its task row goes to `in-review`.

---

## 2. Custodian clip list

Columns: **Dur** = seconds at rate 1. **Loop** = Y/N. **Events** are times in seconds inside the clip. **Layer**: B = base full body, B-L = base lower body only, U = upper-body override, A = additive (upper or full). **Tier**: MVP = M1 / `v0.2.0` per [scope-tiers](scope-tiers.md); v1 = M2.

Event consumers: **audio** (footsteps, contact, gear), **visuals** (grain kicks, plumes, puffs), **terrain/marks** (footprints), **gameplay** (gamepad haptics). Events never create dust. Dust strokes are authored by the sim (WDS §4.4), and the tool clips are **phase-locked to the sim** (§2.6).

### 2.1 Idle

| Clip ID | Layer | Dur | Loop | Events | Tier | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `cust.idle.base` | B | 4.0 | Y | — | MVP | Breathing (chest ±4 mm), weight shift at 2.0 s |
| `cust.idle.cell_tap` | U | 3.2 | N | `cell_tap` 1.10, 1.45 | MVP | Taps the Dust Cell window and peers in (art-direction §4.6) |
| `cust.idle.earth_glance` | U | 4.5 | N | — | MVP | Look-at weight to the Earth direction: 0→1 over 0.6–1.0 s, hold to 3.4 s, out by 4.2 s. Used only when the Earth is > 5° above the horizon, else replaced by `cell_tap` |
| `cust.idle.fuss` | U | 3.6 | N | `fuss_wipe` 1.2, 2.0 | MVP | Desk Duster only: buffs the tiny brush on the chest (comedy) |
| `cust.idle.lean_tool` | U | 5.0 | Y | — | v1 | Leans on a long tool (broom, bar, comb) |
| `cust.idle.on_break_enter` / `_loop` / `_exit` | B | 1.4 / 6.0 / 0.9 | N / Y / N | `sit_contact` 1.1 (enter) | MVP | AFK **On Break**: slow low-g sit-down, legs crossed, glances around |
| `cust.loco.turn_l90`, `cust.loco.turn_r90` | B-L | 0.70 | N | `foot_l` 0.20, `foot_r` 0.45 (mirrored in r90) | MVP | Played when accumulated yaw change at speed < 0.3 m/s exceeds 45°; the rate scales with the remaining angle |

Idle fidget scheduling: after **8–14 s** (uniform random per avatar, seeded by player slot) of continuous idle with no tool stroke, pick one variant without repeating the previous one.

### 2.2 Locomotion (sync group `gait`; markers `l_down` at 0, `r_down` at 0.5 normalised)

| Clip ID | Layer | Dur (cycle) | Loop | Authored speed | Events | Tier |
| --- | --- | --- | --- | --- | --- | --- |
| `cust.loco.shuffle_fwd` | B | 0.84 | Y | 2.2 m/s | `foot_l` 0.00, `foot_r` 0.42 | MVP |
| `cust.loco.shuffle_bwd` / `_left` / `_right` | B | 0.84 | Y | 2.2 m/s | same | MVP |
| `cust.loco.walk` | B | 1.00 | Y | 3.4 m/s | `foot_l` 0.00, `foot_r` 0.50, `foot_l_off` 0.30, `foot_r_off` 0.80 | MVP |
| `cust.loco.lope` | B | 1.20 | Y | 5.0 m/s | `foot_l` 0.00, `foot_r` 0.60, `foot_l_off` 0.15, `foot_r_off` 0.75 | MVP |
| `cust.loco.jog_ballast` | B | 0.74 | Y | 3.4 m/s | `foot_l` 0.00, `foot_r` 0.37 | v1 |
| `cust.loco.run_ballast` | B | 0.69 | Y | 5.0 m/s | `foot_l` 0.00, `foot_r` 0.345 | v1 |

There is no separate "sprint" clip: **Lope** is the top gait. "Run" in the request maps to Walk, which is a low-g skip-jog at 3.4 m/s. The gait parameters are in §4.1.

### 2.3 Air and landing

| Clip ID | Layer | Dur | Loop | Events | Tier | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `cust.air.takeoff` | B | 0.25 | N | `push_off` 0.00 | MVP | Starts **at** push-off. There is no pre-jump crouch, because the sim launches on the input tick |
| `cust.air.rise` / `cust.air.apex` / `cust.air.fall` | B | 2.0 each | Y | — | MVP | Slow, subtle loops, 1D-blended by v_up (§3.2) |
| `cust.air.hang` | A (full) | 2.4 | Y | — | MVP | Slow arm "paddle" and leg cycle; fades in after airTime > 0.8 s (§4.2) |
| `cust.air.land_prep` | B | 0.30 | N (hold last) | — | MVP | Legs reach down; entered when time-to-ground < 0.25 s |
| `cust.land.soft` | B | 0.45 | N | `land` 0.00 | MVP | Impact 2.0–3.2 m/s (the normal jump lands at 2.28) |
| `cust.land.hard` | B | 0.80 | N | `land` 0.00, `hand_plant` 0.18 | MVP | Impact 3.2–8.0 m/s (≤ 19.7 m fall): deep crouch, one hand touches down |
| `cust.land.stumble` | B | 2.20 | N | `land` 0.00, `hand_plant` 0.30, `body_impact` 0.35, `brush_off` 1.90 | MVP | On-foot **Faceplant**, impact > 8.0 m/s (`movement.faceplantMps`; a fall > 19.7 m): pitches forward, push-up, brushes off. Comedy, no damage |

Impacts below 2.0 m/s get no clip, only the additive compression from §4.2.

### 2.4 Suit gear

| Clip ID | Layer | Dur | Loop | Events | Tier | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `cust.gear.lamp_cycle` | A (upper) | 0.50 | N | `lamp_click` 0.22 | MVP | Touches the helmet crown (N key: Crown Lamp / Lowlight Visor / off) |
| `cust.gear.holster_swap` | U | 0.40 | N | `holster_out` 0.12, `holster_in` 0.28 | MVP | The tool moves between `socket_tool_r` and `socket_holster_nn` at the event times |
| `cust.gear.hop_pack_burst` | A (full) | 0.35 | N | `hop_push` 0.00 | v1 | Legs tuck 25°, arms down and back, torso pitch −8°. Restarts on each burst (2–4). The plume anchors are `socket_hop_nozzle_*` |
| `cust.gear.ballast_toggle` | B | 0.60 | N | `ballast_clack` 0.32 | v1 | Stomp; the sole plate tab glows (material). Switches the gait set (§4.1) |

### 2.5 Pour, puck and interaction

| Clip ID | Layer | Dur | Loop | Events | Tier | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `cust.pour.enter` | U | 0.40 | N | `cell_unclip` 0.18 | MVP | Lifts the Dust Cell to the weighing deck |
| `cust.pour.loop` | U | 1.00 | Y | `pour_tick` 0.00, 0.50 | MVP | Tilts and shakes; runs until the sim pour ends (1.2–6 s) |
| `cust.pour.exit` | U | 0.35 | N | `cell_clip` 0.22 | MVP | Also used at the Puck Former (v1) |
| `cust.carry.form_puck` | U | 0.60 | N | `cell_tap` 0.15, `puck_pop` 0.32 | MVP | F tap: the puck appears in `socket_puck_r` at `puck_pop` |
| `cust.carry.band_stack` | U | 0.80 | Y | `tape_wrap` 0.40 | MVP | Hold F |
| `cust.carry.puck.hold` | U | 3.0 | Y | — | MVP | One hand, puck at the hip |
| `cust.carry.stack.hold` | U | 3.0 | Y | — | MVP | Two hands at the chest (20 kg weighs 3.2 kgf on the Moon, so the arms bend only slightly) |
| `cust.carry.two.hold` | U | 3.0 | Y | — | v1 | Railhand: 2 units |
| `cust.carry.pickup` | B | 0.55 | N | `grab` 0.28 | MVP | Low-g squat-pick |
| `cust.carry.drop` | U | 0.35 | N | `release` 0.15 | MVP | |
| `cust.carry.puck.windup` | U | 0.30 | N (hold last) | — | MVP | Overarm backswing while Q is held |
| `cust.carry.puck.release` | U | 0.45 | N | `release` 0.08 | MVP | Puck hand-off: §3.5 |
| `cust.carry.stack.windup` / `.release` | U | 0.35 / 0.55 | N | `release` 0.12 | MVP | Two-hand chest push |
| `cust.carry.pour_back` | U | 0.60 | N | `puck_insert` 0.35 | MVP | Puck back into the Cell |
| `cust.interact.console_enter` / `_loop` / `_exit` | U | 0.35 / 2.5 / 0.30 | N / Y / N | `key_tap` 0.4, 1.1, 1.7, 2.2 (loop) | MVP | Requisitions Desk, Ops Console, Roost panel, Motor Pool |
| `cust.interact.press` | U | 0.50 | N | `press` 0.22 | MVP | Buttons, gates |

### 2.6 Tool clips (sweep / clean per tool class)

**How a sweep works.** The sim computes a tool-head contact point every tick as a deterministic triangle wave with smoothstep easing. The sweep phase comes from `inputSeq` (WDS §4.4). One **stroke** is one traverse of that wave, at the economy durations, and a sweep cycle is two strokes (left→right, right→left). The clip's normalised time is **locked to the sim phase**: `clipTime = phase × cycleDuration`. Tool-head IK (§4.6) then pins the head to the sim contact point. The 80–120 ms **anticipation** lives in the body: shoulders and hips lead each reversal by that amount while the head stays on the ground. Follow-through overshoots the reversal by 3–6° of torso twist.

| Class | Tools | Clip IDs | Cycle (2 strokes) | Events | Tier | Pose / motion |
| --- | --- | --- | --- | --- | --- | --- |
| **palm** | Desk Duster | `cust.tool.palm.hold` (U, 3.0 s loop), `cust.tool.palm.sweep` (A, sync) | 0.90 s | `stroke_turn` 0.00, 0.45; `stroke_mid` 0.22, 0.67 | MVP | Half crouch, one hand cupped. A cosmetic circular wobble of radius 3 cm at 4 Hz is added round the sim head point ("small fussy circles") |
| | Detailing (RMB) | `cust.tool.desk_duster.detailing` (B, 1.2 s loop) | — | `scrub` 0.0, 0.6 | MVP | Kneels on one knee and scrubs a 0.5 m disc with both hands |
| **blade** | Crescent Squeegee | `cust.tool.blade.hold`, `cust.tool.blade.sweep` | 1.10 s | `stroke_turn` 0.00, 0.55; `stroke_mid` 0.27, 0.82 | MVP | One-hand pull, wrist flick at each reversal |
| | Flick (sweeps in the air) | `cust.tool.crescent_squeegee.flick` (A, sync) | 1.10 s | as sweep | MVP | Upper-body sweep layered over the air pose |
| **broom** | Bristle Broom | `cust.tool.broom.hold`, `cust.tool.broom.sweep` | 1.40 s | `stroke_turn` 0.00, 0.70 (shaft-ring audio, audio-direction §2); `stroke_mid` 0.35, 1.05 | MVP | Two hands, alternating sides, torso twist ±25° |
| **bar** | Lane Broom | `cust.tool.bar.hold`, `cust.tool.bar.sweep` | 1.60 s | `stroke_turn` 0.00, 0.80; `stroke_mid` 0.40, 1.20 | MVP | Both hands on the T-handle, torso twist ±20° |
| | Lane Lock | `cust.tool.bar.lane_lock` (A, sync) | 1.60 s | as sweep | MVP | Straight-arm push, twist ±6°; the head path follows the locked sim angle |
| **comb** | Static Rake | `cust.tool.comb.hold`, `cust.tool.comb.sweep` | 1.80 s | `stroke_turn` 0.00, 0.90; `comb_lift` 0.78, 1.68 | v1 | Drag, then an upward lift of 8 cm at the reversal (sells the grains rising, art-direction §3.6) |
| **curtain** | Ion Curtain | `cust.tool.curtain.hold`, `cust.tool.curtain.sweep`, `cust.tool.curtain.aim` (A, pitch pose) | 2.00 s | `stroke_turn` 0.00, 1.00 | v1 | Bar held level at the waist; Twin Pass cleans both ways, so there is no follow-through lift |
| Assembly Gun | — | `cust.tool.assembly_gun.draw` (U 0.45), `.aim` (U 2.0 loop), `.place` (A 0.30), `.reclaim` (A 1.0 loop), `.holster` (U 0.40) | — | `build_fire` 0.05 (place), `gun_out` 0.30 (draw) | v1 | Two-handed. Aim IK (§4.5) points the projector at the placement ghost |
| tool down / up | all | from `hold` to `sweep` | — | `tool_down` when the sim's toolActive rises, `tool_up` when it falls | MVP | Generated by the state machine, not keyed |

### 2.7 Vehicles (per seat type)

| Seat type | Vehicles | Clip IDs | Dur | Loop | Events | Tier |
| --- | --- | --- | --- | --- | --- | --- |
| `walk_behind` | Trundle | `cust.veh.walk_behind.grab` / `.push` / `.pull` / `.idle` / `.release` | 0.40 / 0.95 / 1.10 / 3.0 / 0.35 | N / Y / Y / Y / N | `handle_grab` 0.30; push: `foot_l` 0.00, `foot_r` 0.475; pull: `foot_l` 0.00, `foot_r` 0.55 | MVP |
| `walk_behind` | Trundle cargo | `cust.veh.load_cargo` | 0.60 | N | `cargo_place` 0.38 | MVP |
| `ride_open` | Skiff, Bulldust | `cust.veh.ride_open.mount` / `.drive` / `.steer_l` / `.steer_r` (A poses) / `.boost` (A 0.40) / `.dismount` | 0.70 / 3.0 / pose / pose / 0.40 / 0.60 | N / Y / — / — / N / N | `seat_contact` 0.55 (mount); `foot_l` 0.50 (dismount) | v1 (Skiff: see §11 item 2) |
| `bench` | Carryall driver + 7 passengers | `cust.veh.bench.board` / `.drive` / `.ride_a` / `.ride_b` / `.ride_c` / `.alight` | 0.60 / 3.0 / 4.0 ×3 / 0.55 | N / Y / Y / N | `seat_contact` 0.45; `foot_r` 0.45 (alight) | v1 |
| `cab` | Behemoth | `cust.veh.cab.climb_in` / `.drive` / `.climb_out` | 1.60 / 3.0 / 1.20 | N / Y / N | climb_in: `foot_l` 0.30, 0.90, `foot_r` 0.60, 1.20, `door_close` 1.50; climb_out mirrored | v1 |
| any seat | — | `cust.veh.jolt` (A full) | 0.50 | N | — | v1 |
| any seat | — | `cust.veh.faceplant_react` (A full) | 1.20 | N | — | v1 |

### 2.8 Emotes and reactions

| Clip ID | Display name (naming-bible §A9) | Layer | Dur | Events | Tier |
| --- | --- | --- | --- | --- | --- |
| `cust.emote.hail` | **Hail** | B | 2.0 | `wave_peak` 0.6, 1.3 | MVP |
| `cust.emote.top_marks` | **Top Marks** | U | 1.6 | `nod` 0.8 | MVP |
| `cust.emote.brush_off` | **Brush-Off** | B | 2.4 | `pat` 0.5, 0.9, 1.4, 1.8 (each a 6-grain puff in visuals) | MVP |
| `cust.emote.slide_deck` | **Slide Deck** | B | 3.0 | `flourish` 1.6 | v1 |
| `cust.emote.clock_watch` | **Clock Watch** | U | 2.2 | `tap` 0.7, 1.0 | v1 |
| `cust.emote.not_my_department` | **Not My Department** | U | 1.8 | — | v1 |
| `cust.emote.earthrise` | **Earthrise** | B | 4.0 | — (look-at to the Earth) | v1 |
| `cust.emote.visor_buff` | **Visor Buff** | U | 2.6 | `squeak` 0.9, 1.5 | v1 |
| `cust.react.stamp_nod` | — | A (upper) | 1.2 | — | MVP |
| `cust.react.bump` | — | A (full) | 0.4 | — | v1 |

**No swim, climb, ragdoll, death or damage clips.** The game is no-fail (GDD §3). The Behemoth ladder (`cab.climb_in`) is the only climb.

**MVP total: 65 clips** (7 idle + 2 turn + 6 loco + 6 air + 3 land + 2 gear + 11 tool + 11 carry + 3 pour + 4 interact + 6 Trundle + 3 emote + 1 react). The v1 additions bring the total to about 115.

---

## 3. State machine and blend tree

### 3.1 Layers (three.js mapping)

three's `AnimationMixer` has no per-bone masks, and two full-weight normal actions on one bone blend 50/50 rather than override. Masks are therefore **baked at load**: each base clip is split once into a `lower` track set (root, pelvis, spine_01, legs, dust_cell) and an `upper` track set (all other joints). Each half becomes its own action.

| # | Layer | Content | Blend mode | Weight rule |
| --- | --- | --- | --- | --- |
| L0 | Base lower | Locomotion blend, air, land, seated, pour stance, emote (B), stumble | Normal | Weights sum to 1.0 at all times |
| L1 | Base upper | Same states as L0 (upper halves) | Normal | `1 − w_U` |
| L2 | Upper override | Tool hold, carry, pour, console, holster swap, U emotes | Normal | `w_U` ∈ [0, 1]; L1 + L2 sum to 1.0 |
| L3 | Additive | Tool sweep, Flick, Lane Lock, hop burst, lamp touch, jolt, reactions, `air.hang` | Additive (`makeClipAdditive` once at load; reference = the class `hold` frame 0 for tool clips, `cust.idle.base` frame 0 otherwise) | Each additive weight 0–1 |
| L4 | Procedural (after the mixer) | Twist joints, foot IK + pelvis, slope lean, look-at/aim, tool-head IK, landing compression, low-g bounce gain, springs | Direct bone writes | §4 |

Actions are created once per avatar at spawn: the MVP set plus the equipped tool class. A tool class's actions are created on first equip, never per frame. Actions with weight 0 are `stop()`ped, so the mixer skips them.

### 3.2 Locomotion blend

- **1D (free facing).** Parameter: planar speed `s` (m/s, tangent to the sphere). Nodes: idle 0 → `shuffle_fwd` 2.2 → `walk` 3.4 → `lope` 5.0 (Ballast Soles on: `jog_ballast` at 3.4 and `run_ballast` at 5.0 replace walk and lope). At most two adjacent clips have weight > 0. They play in the **same normalised phase** (sync group `gait`, matched at `l_down`/`r_down`) at rate `r = s / v_blended`, with r clamped to [0.75, 1.25].
- **2D (strafe).** Used while the upper layer is a tool, carry-aim or build-aim state, **or** while the angle between velocity and yaw has exceeded 35° for more than 150 ms. Parameter: local velocity (forward, right). Nodes: the four shuffle clips at 2.2 m/s on a circle plus idle at the centre. Weights: the two adjacent directional clips by angle (linear in angle), scaled by `min(s / 2.2, 1)`. The remainder goes to idle. Above 2.2 m/s, rate = s / 2.2 up to 1.25; beyond that it leaves strafe mode for 1D.
- Switching between 1D and 2D crossfades over **250 ms**, phase-preserving.
- **Air (1D by v_up)**: rise (v_up ≥ +1.0) → apex (|v_up| ≤ 0.4) → fall (v_up ≤ −1.0), linear between nodes.
- **Procedural lean** (L4): forward pitch = clamp(a_fwd × 1.2 °/(m/s²), −6°, +10°); bank = clamp(s × yawRate[rad/s] × 4.0°, ±12°), applied on spine_01–03 at 0.3/0.3/0.4.

### 3.3 Inputs from the sim (`AvatarAnimInput`, one struct per avatar per frame)

The local and remote paths fill the same struct, so there is one code path (§3.5).

| Field | Local avatar | Remote avatar |
| --- | --- | --- |
| `pos`, `up`, `yaw`, `pitch` | Predicted sim state, alpha-interpolated (`frame.alpha`) + reconciliation visual offset | Interpolation buffer (netcode §6) |
| `vel` (world), `s`, `vLocal`, `vUp` | Predicted sim velocity (never the derivative of the displayed position, which carries correction offsets) | Finite difference of the interpolated position over a 100 ms window, then critically damped smoothing τ = 80 ms; s < 0.15 m/s → 0 |
| `grounded`, `airTime`, `impactSpeed` | Sim move-state; impactSpeed = −vUp on the airborne → grounded edge | From `actionState` (§3.4); impactSpeed = −vUp of the last airborne frame |
| `actionState` (u6) | Sim | Entity record "anim state 6 b" (netcode §4.5) |
| `toolId`, `toolActive`, `sweepPhase`, `headTarget` | Sim tool state; phase from `inputSeq`; head = sim contact point | `toolId`, `cleaning` flag; head = endpoint of the latest DustStroke for this `actorSlot`, delayed like the avatar; with no strokes in interest, free-run at the tool period |
| `hopThrust`, `lamp`, `visor`, `seated`, `afk`, `ballast` | Sim move-state / flags | Entity flags (`ballast` from `actionState`) |
| `vehicleId`, `seatType`, `seatIndex` | Sim | Vehicle record `driverSlot` + seat occupancy (contract proposal P3) |
| `carry`, `throwCharge`, `emoteId` | Sim | `actionState` |

### 3.4 `AvatarActionState` (u6, proposal P1: written only by the sim)

`0 none · 1 airborne · 2 hop_burst · 3 seated · 4 sweep · 5 trait_detailing · 6 trait_flick · 7 lane_lock · 8 pour_assay · 9 pour_former · 10 form_puck · 11 band_stack · 12 carry_puck · 13 carry_stack · 14 carry_two · 15 throw_windup_puck · 16 throw_windup_stack · 17 throw_release · 18 pickup · 19 drop · 20 pour_back · 21 holster_swap · 22 interact_console · 23 interact_press · 24 build_aim · 25 build_place · 26 build_reclaim · 27 vehicle_enter · 28 vehicle_exit · 29 ballast_on · 30 ballast_toggle · 31 lamp_cycle · 32 on_break · 33–40 emote_1…8 · 41–63 reserved`

This is gameplay state that the sim already knows. It is **not** animation timing. It travels in the existing 6-bit field, so no message is added.

### 3.5 States, transitions and blend times

**Base layer (L0/L1).** Priority runs high → low: a higher-priority state may interrupt a lower one at any time.

| Priority | State | Enter when | Blend in (ms) | Exit to | Blend out (ms) | Interruptible by |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `vehicle` (seat type) | `actionState` = vehicle_enter / seated | 150 (enter clip), then 200 into drive | `locomotion` on vehicle_exit (exit clip) | 200 | Nothing; the sim forces it |
| 2 | `stumble` | Landing with impactSpeed > `movement.faceplantMps` (8.0 m/s) | 60 | `locomotion` | 250 | Move input after 0.80 s, jump after 0.50 s, vehicle |
| 3 | `land_hard` | Impact 3.2–8.0 m/s | 50 | `locomotion` | 200 | Move after 0.30 s, jump after 0.20 s |
| 3 | `land_soft` | Impact 2.0–3.2 m/s | 60 | `locomotion` | 150 | Move at any time (crossfade 150), jump after 0.10 s |
| 4 | `air` | !grounded for ≥ 50 ms (jump: immediately on `push_off`) | 80 (jump, via takeoff) / 200 (walked off an edge) | `land_*` or `locomotion` (impact < 2.0) | — / 120 | Vehicle, landing |
| 4a | `air.land_prep` | In air, v_up < 0, time-to-ground < 0.25 s (§4.2) | remaining time-to-ground, at least 60 | `land_*` | — | — |
| 5 | `pour` (stance) | pour_assay / pour_former | 200 | `locomotion` | 250 | The sim ending the pour; move input cancels it in the sim |
| 5 | `pickup` | pickup | 100 | `locomotion` | 150 | Jump |
| 5 | `detailing` | trait_detailing | 180 | `locomotion` | 220 | Move input |
| 6 | `emote` (B) | emote_n | 250 | `locomotion` | 200 | Any move, jump or tool input (crossfade 200) |
| 6 | `on_break` | on_break | 600 (enter clip) | `locomotion` (exit clip) | 300 | Any input |
| 7 | `locomotion` | default | — | — | — | — |

**Upper layer (L2 weight `w_U` and clip):**

| State | `w_U` | Blend in / out (ms) | Notes |
| --- | --- | --- | --- |
| empty hands | 0 | — / 200 | Arms from the locomotion clip |
| tool hold (class) | 1 | 200 / 200 | On equip; `holster_swap` plays between two holds |
| tool sweep | hold + additive sweep 1 | sweep weight 0→1 over 120 on `tool_down`, 1→0 over 150 on `tool_up` | Phase-locked (§2.6) |
| carry (puck / stack / two) | 1 | 150 / 150 | |
| throw windup → release | 1 | 80 / release clip, then 200 back to carry or empty | release starts on the sim's throw tick |
| pour / console / form / band / pour_back | 1 | 150 / 200 | |
| build aim | 1 | 200 (draw clip) / 250 (holster clip) | v1 |
| U emotes | 1 | 200 / 200 | Ended by tool input |

Additive one-shots (lamp, hop burst, jolt, stamp_nod) blend in over 50 ms and out over 120 ms, and never block anything. Rules:

1. **The sim always wins.** If `actionState` contradicts the current state (for example sweep while airborne without Flick), switch to what the sim says within 100 ms.
2. Only these transitions may happen with **0 ms** blend: teleport (Relay Pad, Outpost Recall, snap > 2 m), spawn, and an LOD wake-up from frozen (§8). On teleport, reset IK, foot locks and springs.
3. **Predicted interactions** (pour, enter vehicle, pick up puck: netcode §5) start at once on the local client. If the server rejects one (no confirmation within 400 ms of the expected echo), the clip cancels with a 150 ms blend back.
4. A state never stays more than 2 s past its sim condition. A watchdog resets it to `locomotion` and logs `anim_state_stuck` in the debug metrics.

### 3.6 Networking rules

- **There are no animation sync messages.** Remote avatars animate entirely from interpolated sim state, existing entity flags, `actionState`, stroke records and existing events (netcode §4.2–§4.5, §6).
- Remote clip phases are free-running and local to each client. Two clients may show a remote avatar at different gait phases, and that is acceptable.
- Jitter: the inputs are already smoothed (§3.3). State changes driven by thresholds use hysteresis: speed bands ±0.2 m/s; grounded needs 2 consecutive interpolated samples; a base-state change at most every 150 ms except priority 1–3.
- Underflow (netcode §6: extrapolate 250 ms, then hold): when the speed estimate reaches 0, crossfade to idle over 300 ms. Never T-pose and never freeze mid-stride.
- Own-avatar reconciliation offsets (150 ms decay) move the visual root but never feed speed or phase.

### 3.7 Presentation events emitted by animation (proposal P4: client event catalog)

| Event | Payload | Emitted for | Consumers |
| --- | --- | --- | --- |
| `anim.foot_planted` | slot, foot L/R, world pos, heading, impact 0–1 (from foot vertical speed), ballast | Avatars ≤ 25 m from the camera focus, update bucket ≥ 30 Hz | terrain/marks (prints), audio (footsteps, ≤ 6 for others), visuals (≤ 4 grains per step on grime) |
| `anim.landed` | slot, pos, impactSpeed, class soft/hard/stumble | All avatars in entity interest | audio (thump, ground-layer return), visuals, gameplay (haptics, local only) |
| `anim.tool_turn` | slot, toolId, head pos | ≤ 25 m | audio (Bristle Broom shaft ring), haptics |
| `anim.tool_contact` | slot, toolId, down/up | ≤ 25 m | audio, haptics |
| `anim.puck_released` | slot, kind puck/stack, hand pos | all | visuals (hand-off, §3.8) |
| `anim.cue` | slot or entity, cueId (sidecar event ID), pos | ≤ 25 m | audio (gear clicks, pats, door close…) |
| `anim.wheel_landed` | vehicleId, wheel, compression rate | ≤ 60 m | audio (Skiff seat "boing"), visuals (dust puff) |
| `anim.machine_cue` | structureId, cueId, t | in interest | audio, visuals (§7) |

Events are pooled objects with no allocation. Events crossed inside a skipped update are emitted in the next update with their original time offsets. They are never dropped for buckets ≥ 30 Hz.

### 3.8 Hand-offs with sim-owned objects

- **Puck throw:** the puck's trajectory comes from the sim (local prediction or a remote spawn). The visual puck stays in `socket_puck_r` until `release`. It then interpolates from the socket to the sim trajectory with an offset that decays over 100 ms. The release clip starts on the sim's throw tick (so the event is at most 80 ms after it).
- **Strokes:** the dust result is sim-only. The animation's job is to make the head sit on the sim point (§4.6 residual ≤ 2 cm).
- **Vehicle enter/exit:** the sim seats or places the avatar immediately. Animation moves the visual root from the previous visual position to `seat_n_socket` (or back to the ground exit point) along the enter/exit clip over its duration. The sim never waits.

---

## 4. Low-gravity motion

### 4.1 Gait table (g = 1.62 m/s²; Ballast rows at 9.81)

Ballistic apex during a flight of length T: **h = g T² / 8**.

| Gait | Speed | Step length | Cadence (steps/s) | Flight per step | Ballistic apex | Stance dip (pelvis) | Total pelvis excursion |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Shuffle (sweep-walk) | 2.2 m/s | 0.92 m | 2.38 | 0 (8 % double support) | — | 3.0 cm | 3.0 cm |
| Walk (skip-jog) | 3.4 m/s | 1.70 m | 2.00 | 0.20 s | 0.8 cm | 4.0 cm | 4.8 cm |
| Lope | 5.0 m/s | 3.00 m | 1.67 | 0.45 s | 4.1 cm | 6.5 cm | 10.6 cm |
| Lope + Cadence III + Second Wind | 6.5 m/s | 3.6 m (rate 1.25 cap; the stride warps the rest) | 1.80 | 0.50 s | 5.1 cm | 7.0 cm | 12.1 cm |
| Trundle push | 3.0 m/s | 1.43 m | 2.11 | 0.12 s | 0.3 cm | 3.5 cm | 3.8 cm |
| Jog, Ballast | 3.4 m/s | 1.26 m | 2.70 | 0.10 s | 1.2 cm | 5.0 cm | 6.2 cm |
| Run, Ballast | 5.0 m/s | 1.72 m | 2.90 | 0.14 s | 2.4 cm | 6.0 cm | 8.4 cm |

- Arm counter-swing: Lope ±35° at the shoulder, Walk ±25°, Shuffle ±8° (tool arms are overridden).
- **Low-g bounce gain (ADR-0011 "bounce curve").** When the playback rate r ≠ 1, a flight lasts T/r. So that the arc stays ballistic at 1.62 m/s², the pelvis's vertical deviation from the clip mean is multiplied by **G = 1 / r²**, clamped to [0.6, 1.6], during flight segments only (from the plant masks). Stance dip is not scaled. With Ballast on, use g = 9.81 in every formula.
- Readability: these are physical values. If visual-qa rules them unreadable at the 4 m camera, the only allowed knob is `BOUNCE_EXAGGERATION` ∈ [1.0, 1.5] (default 1.0), which multiplies the ballistic apex. Any use of it is a documented departure from physics (art-direction §2.4).

### 4.2 Air, hang time and landing

- Jump air time is 2.81 s on flat ground. The poses follow v_up (§3.2). `cust.air.hang` fades in over 400 ms once airTime > 0.8 s, so long flights never hold a frozen pose.
- **Time to ground** (each frame while v_up < 0): solve `Δh = −v_up·t + ½ g t²` for t, where Δh = height of the sole above `ground(pos)` (§4.3). When t < 0.25 s, blend into `land_prep` with a blend time equal to t.
- **Landing compression** (L4, additive on the pelvis, independent of the land clip):
  - drop `d = clamp(0.055 s × impactSpeed, 0.02, 0.32) m`, which gives 12.5 cm for a normal jump (2.28 m/s) and 27.5 cm at 5 m/s;
  - reached in 90 ms (ease-out), then recovered by a damped spring with **f = 1.8 Hz, ζ = 0.55** (overshoot ≈ 13 %, settled to ±1 cm in 0.55–0.70 s);
  - knees bend through foot IK, because the feet stay planted while the pelvis drops;
  - the torso pitches forward by 0.4 × (d / 0.32) × 18°.
- Thresholds (with fall heights): no clip < 2.0 m/s (1.23 m) · `land.soft` 2.0–3.2 (≤ 3.16 m) · `land.hard` 3.2–8.0 (≤ 19.7 m) · `land.stumble` > 8.0 m/s (game-feel-and-controls §5.5 is canonical; read `movement.faceplantMps`, not a local constant).
- Hop Pack (v1): each `hop_burst` restarts the additive. Air poses keep following v_up, which jumps by up to +3 m/s per burst. Hop Pack time does not reset `airTime`.

### 4.3 Foot IK on the sphere

| Parameter | Value |
| --- | --- |
| Ground query | **The same function the sim uses to ground the avatar** (`packages/world` height sampling + any structure surface the sim grounds on), never the render mesh. Proposal P5: export it as `groundAt(dir) → {height, normal}` |
| Sample point | Ball and heel of each foot projected along −up; 2 feet × (1 height + 2 extra samples for the normal, finite difference over 0.08 m) = **6 samples per avatar per update** |
| Search window | 0.6 m above to 0.6 m below the animated sole; beyond that the foot is unplanted (IK weight 0) |
| Sole offset | Ankle joint 0.095 m above the sole |
| Foot alignment | To the ground normal, clamped to pitch ±30° and roll ±18° relative to root up |
| Solver | Analytic two-bone (thigh–calf–foot), law of cosines, chain stretch capped at 0.999; knee pole = the clip's knee direction (keeps the style) |
| IK weight | From the sidecar plant mask, ramped over 60 ms; 0 in air; 0.5 in `land_prep` toward the predicted landing point |
| **Foot lock** | While planted, the foot target is locked in world space; released when the mask ends or when the lock error exceeds 0.12 m (80 ms blend out). This is the anti-slide mechanism |
| Pelvis offset | `clamp(min(Δl, Δr), −0.35, +0.05) m`, Δ = ground target − animated foot height; smoothed exponentially with τ 70 ms going up and 50 ms going down |
| Slope stance | Above 10°: pelvis shifts downhill 4 mm/°, at most 6 cm; torso leans uphill 0.3°/°, at most 8° |
| Sphere frame | up = normalize(pos). The tangent frame comes from the sim yaw by **parallel transport of the previous frame's forward vector**, never `cross(up, worldY)`. Outpost Boreal sits on the north pole, so the pole singularity must be tested (unit tests at ±89.9° latitude, at the exact pole and crossing it) |

### 4.4 Twist joints

`upperarm_twist` = 0.35 × the upper-arm roll; `forearm_twist` = 0.5 × the hand roll about the forearm axis. They are computed after IK.

### 4.5 Look-at and aim IK

| Parameter | Value |
| --- | --- |
| Target priority | (1) tool-head target or build ghost while tool or build is active; (2) Earth during `earth_glance` / Earthrise; (3) Inspector's Stamp centre during `react.stamp_nod`; (4) local avatar: camera look direction; remote: the yaw/pitch from the entity record |
| Limits | Yaw ±75°, pitch −45° / +35°; beyond the limits the weight fades to 0 over 15° |
| Distribution | spine_02 0.15 · spine_03 0.25 · neck 0.25 · head 0.35 |
| Speed / smoothing | ≤ 240 °/s; exponential τ 90 ms |
| Aim (Assembly Gun, Ion Curtain aim) | Additive spine rotation that points `socket_tool_r`'s forward axis at the target; yaw ±60°, pitch ±50°; residual ≤ 2° |

### 4.6 Tool-head IK (pins the tool head to the sim contact point)

1. Take the clip's tool pose and read the clip's tool-head position `h_clip`.
2. Error `e = h_sim − h_clip`, where h_sim is the sim contact point interpolated to the frame (local: alpha between ticks; remote: along the latest stroke segment).
3. Spend e in order: rotate the tool about the primary grip (≤ 0.25 m of head travel) → move the primary hand by two-bone arm IK (≤ 0.35 m) → spine aim (≤ 20°).
4. Two-handed tools (broom, bar, comb, curtain, Assembly Gun): the off hand follows the tool's `grip_secondary` node by two-bone IK, elbow pole 30° outward and down.
5. **Telescoping Pole:** the tool's `shaft_ext` node slides by (reach − base reach), clamped to [0, 0.6] m.
6. Report the residual |e|. Target ≤ 2 cm in 95 % of contact frames.

### 4.7 Secondary motion (springs)

These are damped angular springs in parent space, integrated exactly (closed form) per update. The drive is root acceleration in local space plus gravity along −up at the current g. A spring sleeps after 0.5 s below 0.2° of motion.

| Joint | f (Hz) | ζ | Max angle | Notes |
| --- | --- | --- | --- | --- |
| `hose_l_01/02`, `hose_r_01/02` | 2.2 | 0.25 | 20° | Slow, wide sway (the low-g read); the `_02` drive lags by 40 ms |
| `dust_cell` | 3.0 | 0.40 | 8° | Plus a vertical kick on `land` |
| `pack` | 4.0 | 0.50 | 2.5° | Mostly for landings |
| Holstered tools (socket children) | 2.5 | 0.30 | 12° | |
| Carried Puck Stack | 3.5 | 0.45 | 5° | |
| Crown Lamp pod (Searchlight level) | 5.0 | 0.50 | 3° | v1 |

---

## 5. Vehicles

### 5.1 Common model (sim → visual)

- **Chassis pose** comes from the sim: predicted and alpha-interpolated for your own vehicle; Hermite plus slerp from the interpolation buffer for remote ones (netcode §6). It is never smoothed beyond that.
- **Wheel placement (kinematic, exact):** hub = suspension anchor − compression × suspension axis. Compression comes from the sim tick state for your own vehicle (alpha-interpolated). Remote vehicles do not carry compression in the record (netcode §4.5), so it is **recomputed per frame** from `groundAt` under each interpolated anchor: one sample per wheel, clamped to the travel.
- **Body spring (cosmetic):** the `body` node rides on `chassis` with heave, pitch and roll springs driven by chassis acceleration (local frame) plus `wheel_landed` impulses. These springs carry the low-g wobble without touching the sim pose.
- **Wheel spin:** ω = v_long at the contact patch / r while in contact. In the air, the spin decays with τ = 2.5 s (vacuum, bearing drag only). Brushes and rollers: ω = v/r + intake spin while the intake is active (`intake` flag).
- **Steer:** the sim steer value (i8 own / 6 b remote) × the vehicle's max angle, low-pass τ 60 ms.
- **Dust kick-up hooks:** after its update, animation fills a pooled `VehicleVisualState` for each vehicle: per wheel `{contact, contactPos, compression, compressionRate, ω, slip}`, per brush/roller `{socket, ω, active}`, per hopper `{tilt}`. Visuals reads it (frame order: animation runs before visuals) to emit rooster tails and drum parabolas (VT-M2-03). `anim.wheel_landed` fires when the compression rate exceeds 0.8 m/s.
- **Hopper tip** (unload at the Dump Plate; Fast Tip shortens it): `hopper` pivots 0 → 40° over the sim unload time (ease in-out), holds, and returns over 0.8 s. MVP for the Trundle.

### 5.2 Per-vehicle parameters

| Vehicle | Running gear | Wheel r | Susp. travel | Body spring (f, ζ) / limits | Steer | Cleaning parts | Seat / driver | Tier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Trundle** | 2 rear wheels + front drum (also the front support) | 0.20 m | 0.05 m | 3.0 Hz, 0.50 / heave ≤ 2 cm, pitch ≤ 2° | None (the cart yaws with the handle) | Drum r 0.18 m, ω = v/0.18 + 9 rad/s while the intake is active, counter-rotating | `walk_behind` (§5.3) | MVP |
| **Skiff** | 4 balloon tyres | 0.42 m | 0.18 m | **1.6 Hz, 0.35** / heave ≤ 6 cm, pitch ≤ 4°, roll ≤ 5° (VT-M2-04: compression + ≤ 2 visible rebounds over ≥ 0.8 s) | Front ±28° | Front brush deck roller r 0.15, ω = v/0.15 + 12 rad/s; **deck lifts 20°** after 0.15 s airborne (rise 0.25 s), returns on landing with a spring of 2.5 Hz, ζ 0.4 | `ride_open`; seat spring 2.2 Hz, ζ 0.3, travel 6 cm | v1 (§11 item 2) |
| **Carryall** | 6 wheels | 0.45 m | 0.22 m | 1.4 Hz, 0.40 / heave ≤ 7 cm | Front axle ±24° | None. Mast beacon 1 rev/s while moving or lit; mast whip spring 1.2 Hz, ζ 0.15, ±6° | `bench`: driver + 7; passenger hands IK to the grab-rail sockets | v1 |
| **Bulldust** | 2 axles, 4 wheels (one axle per body) | 0.55 m | 0.20 m | Each body 1.5 Hz, 0.40 | **Articulated** ±35° at `hitch`: uses the sim articulation angle if exposed, else steer × 35° low-passed (τ 150 ms) | Intake roller r 0.30, ω = v/0.30 + 10 rad/s; **skirt ripple** through two material uniforms set by animation: amplitude = clamp(v / 6.2, 0, 1) × 4 cm, ripple frequency 2.5 Hz + 0.4 Hz per m/s (vertex node by technical-artist) | `ride_open` (roll-cage seat) | v1 |
| **Behemoth** | 2 tracks: 7 road wheels/side r 0.35, sprocket r 0.50, idler r 0.45 | 0.35 m | 0.15 m per road wheel | **0.9 Hz, 0.50** / heave ≤ 5 cm (slow, majestic); cab rock ±1.5° | Skid-steer: side speed v ± ω_yaw × 1.8 m (gauge 3.6 m) | Multi-roller head: 3 rollers r 0.30, ω = v/0.30 + 8 rad/s; track UV scroll = side speed / UV length; belt skinned to 9 joints/side (7 road wheels + sprocket + idler) following road-wheel heights | `cab` (ladder enter/exit; driver visible through the glass at LOD0 only) | v1 |

### 5.3 Trundle walk-behind (MVP)

- The avatar stands on the sim's handle offset (the sim seats the avatar in "walk-behind" mode). Base = `cust.veh.walk_behind.push` / `pull` / `idle`, 1D-blended by signed speed (−1.5 … 0 … 3.0 m/s) and rate-matched as in §3.2.
- **Handle IK:** two-bone arm IK puts the hands on `handle_grip_l/r` (elbow pole 30° out and down; error ≤ 1.5 cm). The torso leans forward 12° at 3.0 m/s, scaled by speed.
- The legs use foot IK on the terrain as normal. Stride is matched to the cart speed, and foot lock is on.
- Enter: `grab` (0.40 s, visual root slides to the handle offset). Exit: `release` (0.35 s).
- The handle node pitches with the cart's chassis pitch, and the hands follow.

### 5.4 Ride-on seats (`ride_open`, `bench`, `cab`)

- The pelvis is parented to `seat_n_socket`, so it inherits the seat spring. The hands go to the steering sockets (`steer_grip_l/r`) by IK.
- Steering pose: additive `steer_l` / `steer_r` weight = |steer|. The torso rolls into turns: clamp(a_lat × 2.5 °/(m/s²), ±12°).
- `cust.veh.jolt` on any `wheel_landed` with a rate above 1.5 m/s. `cust.veh.boost` while the Afterburner is on.
- Vehicle **Faceplant** (wipeout callout): `cust.veh.faceplant_react`. Animation never moves the chassis.
- Passengers (Carryall) pick `ride_a/b/c` by seat index mod 3, with a phase offset of seatIndex × 0.37 s.

---

## 6. Robots (shorebird motion)

### 6.1 Method

- Robots are **mostly procedural**, so they have no clip files in MVP. Each robot class is one merged mesh whose vertices are weighted 1.0 to a part index. Per-instance part matrices (instances × parts × mat4) live in a data texture or storage buffer that animation writes. The vertex shader fetches by (instanceId, partIndex). That gives **one draw per robot class per pass**. The render module (`render` instancing helpers) owns the GPU side; animation computes the matrices.
- Fallback if the TSL node path fails on WebGL2: one `InstancedMesh` per part type.
- Inputs: interpolated position and heading (snapshots arrive every 2nd frame, about 5 Hz), `state` (4 b), `cargo` (3 b), and robot plot intents (WDS `robot.plot`) for the Work Front direction. Albatross positions use **cubic Hermite** interpolation (finite-difference velocity) so hop arcs stay curved (VT-M2-06).
- **Burst rhythm (cosmetic):** Sandpipers move along the interpolated path with a visual offset of up to **±0.25 m** in a burst/stop rhythm: burst 0.6 s at 1.6× path speed, stop 0.35 s, peck. The average stays on the sim path. The offset is clamped and decays to 0 within 0.3 s of a state change.
- **State lights are material** (technical-artist, art-direction §6.3). Animation only sets the crown-light state index uniform.

### 6.2 Gait parameters

| Robot | Height | Motion | Step length | Cadence | Body bob | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **Sandpiper** | 0.45 m | Skitter, backward-knee legs | 0.12 m | v / 0.12 (cap 9 Hz) | 6 mm | Head stays world-stable during bursts (bird head-lock, τ 40 ms), then snaps forward |
| **Plover** | 0.70 m | Steadier trot | 0.20 m | v / 0.20 (cap 7 Hz) | 10 mm | No burst rhythm; the two brush beaks alternate |
| **Albatross** | 1.2 m body, 3.2 m span | Ballistic hops on cold-gas puffs; waddle on the ground | Ground waddle 0.25 m | v / 0.25 | 15 mm (waddle roll ±6°) | Wings fold to 0° over 0.30 s at take-off, unfold to the panel pose over 0.60 s on landing; **no gliding, no flapping in vacuum** |

Foot IK for robots: per-foot `groundAt` at ≤ 20 m only (1 sample per foot, no normal). Beyond 20 m the feet follow the body height.

### 6.3 State → motion map (naming-bible §8 states)

| State | Sandpiper / Plover motion | Albatross motion | Blend in |
| --- | --- | --- | --- |
| **Foraging** | Body pitched down 35°; beak brush sweeps ±25° at 4 Hz (Plover: two beaks in antiphase); peck dip of 4 cm every 0.5 s; burst/stop walk between pecks | Wings out as panels; belly brush skirt lowered 6 cm; waddle at ≤ 0.5 m/s | 250 ms |
| **Flying** (travelling) | Skitter run, body level, neck forward 15° | Hop cycle: crouch 0.20 s → puff (`anim.machine_cue` `puff` for audio/VFX) → ballistic arc → wings unfold on landing → 0.4 s settle | 200 ms |
| **Inbound** | As Flying, toward the Roost | As Flying, toward the Nest | 200 ms |
| **Molting** (emptying the crop) | At the Roost pad: two body shakes of 0.8 s (roll ±10° at 5 Hz); crop hatch opens 70° | Over the Nest: claw opens 0 → 45° over 0.4 s, Bale released (the sim's cargo goes 1 → 0) | 200 ms |
| **Patch Picked Clean** | Head bob ×2 (0.3 s each), then a look-around (head yaw ±60° over 1.2 s) | Wing panels tilt 10° up and back | 150 ms |
| **Roost Brimming** | Perched on the Roost; head turns every 3–6 s | — | 300 ms |
| **Crop Full** | As Inbound plus a faster cadence (1.2×) | As Inbound; claw closed on the Bale | 200 ms |
| **Grounded** (switched off) | Legs fold, body lowers 40 %, head tucks over 1.0 s, then **frozen** (no further updates) | Wings fold flat, body settles over 1.2 s, then frozen | 1,000 ms (settle) |
| **Resting** | Breathing bob 0.5 Hz, 3 mm; a preen (head to wing, 1.4 s) every 8–15 s | Panels angled toward the sun (yaw slew ≤ 10 °/s), 1 Hz update | 300 ms |

Charm detail: Sandpipers and Plovers emit `anim.foot_planted` with `kind: "bird"` within 15 m, for the 3-toe prints (art-direction §3.5).

---

## 7. Machines and world motion

All machine motion runs from a sim structure state (FRAME events: machine state change, 3 b) plus timing constants. Where several modules must agree on one timeline, the constants live in a shared **cue timeline** table (proposal P6: `packages/shared/src/client/cue-timelines.ts`). Animation, visuals and audio all read the same numbers.

| Machine / object | Motion (animation) | Hand-off to visuals / audio | Tier |
| --- | --- | --- | --- |
| **Assay Counter** | Weighing deck sinks 1.5 cm when a pour starts (spring 3 Hz, ζ 0.4) and bobs ±2 mm on each `pour_tick`; flip-digit flaps turn 180° over 120 ms per digit change | `anim.machine_cue` `kaching` on the sale event → visuals: lumen-gold flash; audio | MVP |
| **Receiving Gate** | Scanner ring rotates 90 °/s idle and 360 °/s for 0.5 s per arriving unit | `scan` cue per unit → visuals: teal ring flash | MVP |
| **Railshot** | Timeline from the launch event at t = 0: **−2.0 s** the sled slides into the breech over 1.0 s (ease-out); **−1.0 s** charge hold (sled shudder ±2 mm at 12 Hz); **0.0 s** launch: constant acceleration 120 m/s² along the 60 m rail, **exit after 1.00 s at 120 m/s**; then a straight line at 120 m/s for 4.0 s, after which visuals takes over as a "moving star" sprite; **+3.0 s** the next sled rises from the loader (2.0 s) | Animation publishes `railshotProgress` 0–1 along the rail every frame; visuals lights coil i when progress ≥ i/N (art-direction §7.2); cues `breech_lock` −1.0 s, `launch` 0.0 s, `exit` 1.0 s | MVP (one every 2 t) |
| **Dump Plate** | Static pad; the vehicle hopper tips (§5.1) | — | MVP |
| **Motor Pool** | Roll-up door: 2.0 s up, 2.0 s down (ease in-out), 12 slat nodes or a UV-scroll roll | `door` cue | MVP (pre-built) |
| **Roost** | Charging-pad ring rotates 20 °/s while a robot is docked | — | MVP |
| **Glide Rail pucks** | Position = the sim's rail function (rail graph + `spawnTick`, netcode §4.5). Visual: hover gap **2.5 cm**, bob ±3 mm at 1.3 Hz (phase = hash(spawnTick)), bank into curves clamp(v²κ × 30°/(m/s²), ±8°); bob only within 30 m (beyond: static gap); written into instance matrices up to the preset's visible puck cap | — | v1 |
| **Puck Former** | Press cycle per Puck Stack, **1.60 s**: descend 0.35 s (ease-in) → impact at 0.35 s (`press` cue; the logo stamp decal is visuals) → dwell 0.15 s → rise 0.60 s (ease-out) → eject push 0.50 s; idle when the buffer is empty | `press`, `eject` cues | v1 |
| **Bead Kiln** | Drum 5 rpm while running; 2 s spin-up and spin-down | Sight-window glow is material (visuals); beads trickle as particles | v1 |
| **Tile Sinterer** | Stamp cycle **3.0 s**: press 0.5 s → dwell 0.4 s → lift 0.8 s → tile slides out 1.3 s | `stamp` cue | v1 |
| **Heliostat / Sun Fan** | Heliostat tracks the sun, slew ≤ 3 °/s, updated at 2 Hz; Sun Fan opens its fan over 1.5 s after placement | — | v1 |
| **Nest** | Bowl rim ring compresses 3 cm when a Bale lands (spring 2 Hz, ζ 0.4) | `catch` cue | v1 |
| **Inspector's Stamp** | **Animation does not own the stamp.** The VFX belongs to technical-artist (VT-M1-22). Shared timeline (P6), from `plot.polished` at t₀: outline trace 0.0–0.8 s → stamp descends 0.80–1.00 s → impact at 1.00 s → overshoot spring 4 Hz, ζ 0.35, settled by 1.4 s → fade 2.5–3.0 s. Animation's part: the credited custodian within 30 m who is idle or walking and not sweeping plays `cust.react.stamp_nod` from t₀ + 0.2 s (look-at the stamp centre) with a small fist pump peaking at t₀ + 1.0 s; robots within 15 m turn their heads toward it | Visuals and audio read the same constants | MVP |

---

## 8. LOD and performance

### 8.1 Update rate by on-screen size

Buckets are chosen by projected height (art-direction §10: by screen size). Each bucket also has a distance equivalent for a 1.85 m custodian at 1080p and vFOV 60° (h_px ≈ 1730 / d). There is 10 % hysteresis. Updates are staggered across frames by `slot mod N` so skipped work spreads evenly.

| Bucket | Custodian h_px (≈ distance) | Rate | Features on |
| --- | --- | --- | --- |
| U0 | Local avatar, or ≥ 110 px (≤ 16 m) | Every frame (60 Hz on A; 30 Hz on 30-fps tiers) | All: mixer, foot IK + lock, look-at, tool-head IK, springs, events |
| U1 | 43–110 px (16–40 m) | 30 Hz | Mixer, foot IK (no lock), tool-head IK, look-at; springs off (held at rest); events (footprints/audio only ≤ 25 m) |
| U2 | 17–43 px (40–100 m) | 15 Hz (art-direction §10) | Mixer, pelvis offset only (no leg IK), no look-at; no events except `landed` |
| U3 | 10–17 px (100–170 m) | 7.5 Hz | Mixer only, locomotion + air states only (upper layer frozen on its hold pose) |
| U4 | < 10 px, culled, below the horizon or impostor | **Frozen**: no mixer update; only the phase accumulator advances so a wake-up resumes in phase (0 ms blend) | — |

Tier B/C (target 30 fps) caps: at most **6** avatars in U0 besides the local one, and leg IK is off beyond 25 m. On Tier A, at most **10** in U0. Overflow goes one bucket down, nearest first.

Robots: full rate within 20 m; 15 Hz to 60 m; 5 Hz to the preset's robot render distance; Grounded robots frozen once settled. Vehicles: wheel spin every frame (cheap); suspension and body springs within 60 m; wheels only beyond; impostor beyond 150 m (no animation). Machines: animate only within 120 m, or while their cue is audible or visible.

### 8.2 CPU budget (main thread, p95; ceilings from performance-budgets §2)

| Line | Tier A (ms) | Tier B / C (ms) |
| --- | --- | --- |
| 16 avatars (mixers, bone matrices, IK, springs, events) | **0.30** (M1-W5-T04 acceptance; ≈ 18 µs per avatar at U0) | 0.60 |
| Robots (≤ 32 animated near on A, ≤ 16 on B) | 0.25 | 0.35 |
| Vehicles (≤ 16) | 0.20 | 0.30 |
| Machines, rail pucks, cue timelines | 0.15 | 0.25 |
| Event dispatch | 0.05 | 0.10 |
| Slack | 0.55 | 0.40 |
| **Total animation** | **≤ 1.5** | **≤ 2.0 design target** (performance-budgets ceiling 2.5; rendering-pipeline §3.1 says 2.0, see §11 item 4) |

Rules:
- **Zero per-frame allocations** in the animation update (scratch vectors and quaternions pooled per module; events pooled).
- Mixers are pooled and returned on despawn.
- `skeleton.update` runs only on frames where that avatar updated.
- **GPU skinning only**: vertex-shader skinning from the bone buffer (WebGPU storage or uniform buffer; WebGL2 bone texture). There is no CPU skinning.
- Bone buffer: 46 × 64 B ≈ 2.9 KB per avatar per update.

Skinned characters per frame (performance-budgets §4): Tier A 16 avatars + 24 robots at full rate; Tier B/C 16 + 12 (the rest on LOD or impostor); animated robots ≤ 32 near on A, ≤ 16 on B/C. Draws: avatars ≤ 2 per player per pass; robots 1 per class per pass (§6.1).

Mesh LOD (technical-artist) shares the one skeleton across LOD0–LOD3, so a LOD switch never re-binds or pops the pose.

---

## 9. Acceptance criteria and how they are checked

### 9.1 Measurement tooling (built by animation-engineer as part of M1-W5-T04)

- `animation.debug` service (registry key) that exposes a per-avatar metrics ring: foot-lock drift per stance (cm), sole penetration/float (cm), base-layer weight sum, state history with timestamps, max per-frame joint delta (°), tool-head residual (cm), CPU µs per avatar and per line. The F3 HUD page "Anim" (performance-profiler) draws it; screenshot captures dump it as a JSON sidecar.
- Debug draw (F3): skeleton lines, foot-plant markers (green planted, red sliding > 2 cm), slide traces, state names.
- Requested capture scenes (the scene list belongs to visual-qa-reviewer and qa-test-engineer; proposal P7):
  - **S19 Gait lab:** custodian on flat ground, on a 20° slope and on a crater rim, at shuffle, walk, lope and with Trundle push; side camera 4 m; 60 fps frame sequence, 3 cycles each.
  - **S20 Landing lab:** jump from flat ground, drops of 1, 3 and 8 m; side camera 4 m.
  - **S21 Tool lab:** T1–T4 (v1: T5, T6, Assembly Gun), 3 cycles each, side and front.
  - S09 and S10 reused for vehicles and the crowd.

### 9.2 M1 (MVP): M1-W5-T04 and M1-W8-T02

| ID | Criterion (pass bar) | How it is checked |
| --- | --- | --- |
| AN-M1-01 | **No T-pose or bind pose.** In a 10-min 16-bot `/bot-test` with clients rendering, zero frames where a visible avatar's base-layer weight sum is < 0.999, and zero frames showing the A-pose bind | Metrics sidecar (automated); visual-qa spot-checks S10 |
| AN-M1-02 | **Foot sliding** (planted foot world drift per stance): local ≤ **2.0 cm** on slopes ≤ 15°, ≤ 3.0 cm on 15–25°; remote under netsim 120 ± 30 ms, 1 % loss ≤ **5.0 cm**; across 0–5 m/s and every gait | `animation.debug` drift, p95 over S19 + bot run; red markers in the S19 capture |
| AN-M1-03 | **Ground contact** while planted: penetration ≤ 1.0 cm, float ≤ 1.0 cm (VT-M0-04b, VT-M1-07 "no peter-panning at boots") | Metrics + the S05 shadow capture |
| AN-M1-04 | **No blend pops.** Max per-frame rotation of any joint ≤ max(2 × the largest per-frame delta in the active source clips + 4°, 6°) outside the 0 ms transitions listed in §3.5; layer weight changes per frame ≤ 1 / (blend ms × fps / 1000) | Automated over S19–S21 and the bot run; visual-qa reviews flagged frames |
| AN-M1-05 | **Landing reads.** Normal jump: pelvis drop 10–16 cm within 150 ms of `land`, settles to ±1 cm in 0.45–0.70 s; 3 m drop plays `land.hard`; 8 m drop plays `land.hard`; a 20 m drop plays `land.stumble` | S20 frame strip at fixed times (visual-qa judges the read) + metrics |
| AN-M1-06 | **Low-g gait timing:** per-step flight (from foot events) Walk 0.20 s ± 15 %, Lope 0.45 s ± 10 %; cadence within ±10 % of §4.1; arc apex within ±20 % of g T²/8 | S19 telemetry |
| AN-M1-07 | **Stroke sync:** tool-head residual ≤ 2 cm in 95 % of contact frames (local), ≤ 6 cm (remote); `stroke_turn` within ±17 ms of the sim reversal (local) | Metrics on S21 + bot run |
| AN-M1-08 | **Tool readability:** each of T1–T4 shows an 80–120 ms body lead before each reversal and a visible follow-through; Desk Duster circles visible at 3 m | S21 contact sheet, visual-qa checklist |
| AN-M1-09 | **CPU:** 16 avatars ≤ 0.30 ms p95 on Tier A (S10 crowd); animation total ≤ 1.5 ms A / ≤ 2.0 ms B; 0 allocations from `animation/**` across 600 frames (heap-profile diff) | `/perf-check` (performance-reviewer) |
| AN-M1-10 | **Remote stability:** for a bot walking straight under netsim, ≤ 1 base-state change per 500 ms and no planted-foot jitter > 1 cm per frame | Metrics |
| AN-M1-11 | **Licensing:** every clip has a sidecar `ledgerRow` and an `ASSET_LICENSES.md` row; the ban-list grep is clean | CI + code-reviewer |
| AN-M1-12 | **Trundle:** hands on the grips ≤ 1.5 cm; push stride slide ≤ 3 cm; grab/release blends have no pop (AN-M1-04); wheel surface speed within 5 % of the cart speed; drum spins while the intake is active; hopper tips at the Dump Plate | S09 + metrics |
| AN-M1-13 | **Machines (MVP):** Assay Counter deck and flaps synced to the pour and sale; Receiving Gate per unit; Railshot timeline within ±1 frame of P6 and coil sync error ≤ 1 coil; Motor Pool door | S14, S17-preview captures (60 fps) |
| AN-M1-14 | **Sandpiper:** all 9 states mapped (§6.3); state transitions blend with no pop; burst offset ≤ 0.25 m; ≤ 0.25 ms for 3 Roosts' flock on Tier A | S15-preview + metrics |
| AN-M1-15 | **Emotes (3):** each plays, is interrupted by movement within 200 ms, and syncs to remote clients through `actionState` | 2-client e2e (qa-test-engineer) |

### 9.3 v1.0 (M2)

| ID | Criterion |
| --- | --- |
| AN-M2-01 | Hop Pack: each burst visibly retucks (additive restarts); plume sockets track the nozzles with < 1 cm error |
| AN-M2-02 | Ballast Soles: the gait switches within 300 ms of the toggle; the Ballast gait table holds (AN-M1-06 method, g = 9.81) |
| AN-M2-03 | Skiff passes **VT-M2-04** (1 m bump: visible compression, ≤ 2 rebounds over ≥ 0.8 s); brush deck lifts on jumps |
| AN-M2-04 | All five vehicles: enter/exit for every seat type without pops; ladder feet on the rungs ≤ 2 cm; Behemoth track UV speed within 5 % of the side speed; Bulldust articulation follows the sim |
| AN-M2-05 | Albatross passes **VT-M2-06** (ballistic hop, wings fold for the hop and unfold on landing, no gliding) |
| AN-M2-06 | Plover two-beak antiphase; the flock of ≤ 32 near robots fits 0.25 ms (A) |
| AN-M2-07 | Assembly Gun aim residual ≤ 2°; the build ghost stays in the projector cone |
| AN-M2-08 | Machines (Puck Former, kilns, Tile Sinterer, Heliostat, Glide Rail pucks) match §7 timings ±1 frame; rail pucks bank, with no hover jitter > 1 mm per frame |
| AN-M2-09 | All 8 emotes; the full clip set within the §1.7 v1.0 budgets |
| AN-M2-10 | Every M1 criterion still passes with v1.0 content on Tier B |

visual-qa-reviewer judges the "reads" items (AN-M1-05/08, VT links) at native resolution against visual-target. The numeric items are automated, and the reviewer verifies them from the sidecars.

---

## 10. Contract proposals (for contracts-architect, coordinated when technically needed)

| # | Proposal | Contract file |
| --- | --- | --- |
| P1 | `AvatarActionState` u6 enum (§3.4) for the existing entity "anim state 6 b" field; sim writes, animation reads | `shared/sim/components.ts` |
| P2 | `emote` control message `{emoteId u8}` (rate-limited 1/s) → sim sets `actionState` emote_n for the clip duration | `shared/protocol/messages.ts`, `sim/input.ts` |
| P3 | Vehicle seat occupancy (seat index per avatar) visible to remote clients; seat type per vehicle in `vehicles.json` (`walk_behind`, `ride_open`, `bench`, `cab`) | `sim/components.ts`, game-data |
| P4 | Client-local presentation events `anim.*` (§3.7) in the event catalog | `shared/events/catalog.ts` |
| P5 | Export the sim's grounding query `groundAt(dir) → {height, normal}` (terrain + walkable structures) | `packages/world` / `packages/sim` barrel |
| P6 | Cue timelines (Inspector's Stamp, Railshot, Puck Former, Tile Sinterer) as shared constants | `shared/client/cue-timelines.ts` |
| P7 | Capture scenes S19–S21 (§9.1) | visual-target scene list (visual-qa-reviewer / qa-test-engineer) |
| P8 | `VehicleVisualState` and `railshotProgress` as service-registry keys (animation writes, visuals reads) | `shared/client/module.ts` registry keys |

---

## 11. Open issues and doc drift found

1. **Title.** Current game title is Clean The Moon!; the naming catalog is editable. Older title-exception/risk rules are retired.
2. **Skiff in MVP.** *(Resolved 2026-11-12)* scope-tiers is canonical: the Skiff is v1.0 (built in M2-W3-T01/T02). Skiff clips stay marked v1; M1 builds the Trundle only.
3. **Stale names** to fix in their owners' docs: art-direction §4.2/§5.3/§6.3/§7.2/§13.1 still use Ballast Soles, Crescent Squeegee, Spot Ring/Wide Halo, the 11 old robot states, Tile Sinterer, Dust Vault and Running Lamps. netcode §4.1/§4.5 uses `anchorBoots`, `plotScan`, "hopper level" and "11 UI states" (the bible now has 9). M1-W7-T01 uses Cargo Expander and Pilot Review.
4. **Animation CPU budget:** *(Resolved 2026-11-12)* Tier B is 2.0 ms everywhere (performance-budgets §2, rendering-pipeline §3.1, ADR-0011). The M1-W5-T04 target of 0.3 ms for 16 avatars is tight (≈ 18 µs per avatar). If measured above it, the fallback is bucket caps (§8.1), not cutting IK on the local avatar.
5. **Emote binding:** the GDD has no emote input. The proposal is a "Gestures" sub-ring on the ping wheel (Z / D-pad Down hold); this is game-designer's call.
6. **Sim facing behaviour:** the yaw rules for free vs strafe facing are assumed (§3.2). gameplay-systems-engineer must confirm, or animation derives the mode from the velocity/yaw angle (already the fallback).
7. **Clip build recipe** lives in `tools/asset-pipeline/` (technical-artist). animation-engineer requests the resample/meshopt animation step before M1-W5-T04.
