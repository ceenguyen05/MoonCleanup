# Game feel, movement, camera and controls — Moon Cleanup

Status: **Draft v1 for build (2026-11-12).** Owner: game-designer (numbers) · implemented by gameplay-systems-engineer (`packages/sim`, `apps/client/src/gameplay`, `apps/server/src/sim`) and ui-ux-motion-designer (settings, prompts, reticle and HUD feedback). Cee (owner) may override anything.
Title: the game is titled **Moon Cleanup** (owner choice).
Canonical sources this doc must not contradict: [progression-and-economy.md](progression-and-economy.md) ("E", every balance number) · [GDD.md](GDD.md) §9, §13 (controls, accessibility) · [naming-bible.md](naming-bible.md) (every name) · [ADR-0010](../adr/0010-movement-kinematic-sim-no-server-physics.md) (kinematic sim, no server physics) · [netcode.md](../architecture/netcode.md) §2, §4.1, §5, §6 (input format, prediction, interpolation) · [world-and-dust-simulation.md](../architecture/world-and-dust-simulation.md) ("WDS": height function, strokes, R = 2,000 m) · [audio-direction.md](audio-direction.md), [art-direction.md](art-direction.md) §3.6, §4.6, §8.7 (cues, VFX, springs) · [visual-target.md](visual-target.md) (camera defaults) · [module-boundaries.md](../architecture/module-boundaries.md) §2 (event catalog).

**Reading key.** ★ = deliberately better than the reference genre game, with a one-line reason. **[tunable]** values live in `packages/game-data` (§10); code never hard-codes them. "Tick" = one `SIM_TICK_HZ` step (50 ms at the default 20 Hz). All timers in the sim are **integer tick counts** derived as `round(seconds × SIM_TICK_HZ)`, so 0.15 s = 3 ticks at 20 Hz and 5 ticks at 30 Hz.

---

## 1. Feel pillars and the "every second of cleaning feels good" checklist

### 1.1 Pillars

| # | Pillar | Means | Never |
| --- | --- | --- | --- |
| F1 | **Instant and tactile** | Every predicted action shows within **1 render frame** of the input: a clean strip, grains, a sound, a gauge tick. Mouse look is never smoothed | A stroke that appears after the round trip; "mushy" look smoothing |
| F2 | **Floaty in the air, planted on the ground** | Honest 1.62 m/s² arcs (2.8 s jumps) with real air control, jump cut, Touchdown and Hop bursts that always do something. On the ground: crisp starts and stops (≤ 0.4 s to top speed, ≤ 0.31 s to stop) and ground snap so you never bounce off pebbles while sweeping | Ice-rink ground; random launches off bumps while cleaning; a wasted Hop burst |
| F3 | **The Moon is round** | Up is always the sphere normal; the camera and controls cross the poles (Outpost Boreal is the start!) with no flips, snaps or spins | Camera roll or heading jumps near a pole; "north" glitches |
| F4 | **Readable rhythm** | Each tool has a cadence (0.45–1.00 s strokes) you hear, see and feel; grime sounds and looks different from clean ground; big tools feel heavy, small tools fussy | Uniform white-noise cleaning; feedback that does not change when the spot is done |
| F5 | **Calm comfort** | No damage, stamina or fail states; shake and FOV kicks are small, capped and fully switchable; every hold has a toggle | Screen-shaking celebrations; mandatory fast reactions |
| F6 | **Local at 120 ms** | Own avatar, vehicle, strokes and Cell gauge are predicted; corrections are invisible (p95 < 5 cm); remote players move smoothly | Rubber-banding; strokes popping in or out |

### 1.2 "Every second of cleaning feels good" checklist (testable; §11 GF-30)

While a player holds Sweep over grime, **every 1-second window** must contain all of these:

| # | Check | Bar | Owner |
| --- | --- | --- | --- |
| C1 | A visible clean strip grows at the tool head | Drawn on the first frame after the predicting tick; never waits for the server (WDS §4.4 predicted overlay) | terrain-dust-engineer + gameplay |
| C2 | Grains arc from the head | ≥ 20 grains ≥ 2 px within 0.5 s of stroke start (VT-M1-16b), same floor on every preset | technical-artist |
| C3 | At least one stroke-contact sound transient | One per contact start (§3.5); grime = full "shhh", clean = thin squeak (audio-direction §1.2) | audio-engineer |
| C4 | The Cell readout moves | While sweeping, the HUD Cell readout shows kg with **1 decimal at every size** (an exception to the integer-above-100 kg rule of ui-screens-and-flows §1.5; a Static Rake collects ≈ 0.5 kg/s into a 220 kg Cell), so it ticks ≥ 1×/s for every tool and Cell; the suit's Dust Cell window level moves | ui-ux + technical-artist |
| C5 | A berm or lane stripe forms | Berm at every strip edge; Lane Lock stripes (art-direction §3.3–3.4) | terrain-dust-engineer |
| C6 | Rhythm is felt | Gamepad: one light rumble per contact start (§3.5); camera micro-kick on T3+ tools | gameplay |
| C7 | Progress is legible | Plot Card % and the albedo / "dust removed" readout update at ≥ 2 Hz while you clean in the plot | ui-ux |
| C8 | Nothing dead | If no dust is collected for > 1 s while Sweep is held, the cause is shown within 1 frame of detection: Cell full (amber prompt), head lifted (fast turn, airborne, out of reach: dashed reticle), clean ground (thin "squeak" + ivory reticle) | gameplay + ui-ux |

And at the **minute** scale: the music Pulse layer (audio-direction §4.2 L1) is up while you clean; at least one "progress beat" (Cell 90%, pour, Stamp, Next Requisition tick, Docket goal) lands every 3 min in the first hour (GDD §8 pacing makes this true: first Stamp ≈ 6 min, Cell fills every 1–4 min).

---

## 2. Character movement (shared kinematic sim, `packages/sim`)

### 2.1 Frame, gravity and integration

| Item | Rule |
| --- | --- |
| World frame | Moon-centred, +Y north (WDS §1). Local **up** `n = normalize(p)`. Gravity `−g·n`, g = `world.gravityMps2` = **1.62 m/s²** (E §1). Ballast Soles / Earth-Feel Comfort: 9.81 m/s² for that avatar only (§2.6) |
| State per avatar | Position `p` (m), velocity `v` (m/s), body yaw (about `n`), move state (grounded, airborne, hopping, seated, tumbling, ballast), integer tick timers (§2.10) |
| Ground | `g(û) = R + H(û)` from `packages/world` (WDS §3.5). Slope from finite differences at ±0.25 m. Structures with a walkable top (Deck Plates, Gantries, ramps) raise the ground under the capsule: ground = max(terrain, structure top) |
| Integrator | Semi-implicit Euler per sub-step: `v += a·dt_s; p += v·dt_s`; then re-split `v` into tangent and normal parts against the new `n` (so a body walking 3 km around the Moon keeps its speed and stays tangent) |
| Sub-steps | Avatar: `clamp(ceil(|v|·dt / 0.15 m), 2, 8)` sub-steps per tick (2 at walking speed, more when falling fast), so a capsule never moves more than ½ its radius per sub-step (no tunnelling). Vehicles: fixed **4** sub-steps (12.5 ms) for spring stability (§5.2). The count is derived from state, so server and client agree |
| Determinism | No `Math.random`, no wall clock. Trig on gameplay paths uses the shared `packages/sim` sine table (4,096 entries generated with rational arithmetic, linear interpolation), so replays agree across JS engines; bit-exactness is not required (ADR-0010: server wins) |
| Server cost | ≤ 15 µs per avatar step and ≤ 30 µs per vehicle step (Behemoth ≤ 45 µs) in V8 Tier A; 16 avatars + 4 driven vehicles ≤ 0.4 ms per tick p95 (inside the 2.3 ms room tick of performance-budgets §6). Vehicle contact normals are sampled once per tick per probe; heights once per sub-step |

**Heading frame (pole-safe) ★.** Input yaw needs a reference direction on the sphere, and any position-only frame has two singular points (hairy-ball theorem). We use **two frames and a frame bit**: frame **A** = projection of +Y (north) onto the tangent plane, valid where |n·Ŷ| < 0.9; frame **B** = projection of +X, valid where |n·X̂| < 0.9. Every point is valid in at least one (|n_y| and |n_x| can't both be ≥ 0.8). The client switches A→B when |n·Ŷ| > 0.8 and back when |n·Ŷ| < 0.6 (hysteresis), and sends the chosen frame in the input (`yawFrame` bit, §6.8 proposal). The server uses the sent frame if it is valid at its position, else the other one. The **camera** never uses either frame: it is parallel-transported (§4.1), so the view is continuous across the poles; only the yaw *number* changes basis. Reason: Outpost Boreal sits on the north pole, where a north-referenced yaw is undefined.

### 2.2 Speeds (E §3 and the Fitness department; do not change here)

| State | Base (m/s) | Applies | With every bonus |
| --- | --- | --- | --- |
| **Walk** (default ground speed) | **3.4** | Not sweeping, Lope off | 4.35 (Cadence III + Second Wind) |
| **Lope** (run; "sprint" in other games) | **5.0** | Lope held/toggled, not sweeping | 6.72 (+ Lope Training ×1.05) |
| **Sweep-walk** (while sweeping) | **2.2** | Sweep held | 2.96 (+ Brushwork ×1.05); 3.40 with the Lane Broom locked (×1.15) |
| Steep plots, sweeping | ×0.6 | Plot class Steep (>25°), unless Sure Footing / Charge | — |

- **Speed multiplier** `s = 1 + Cadence (0.07 / 0.14 / 0.20) + Second Wind (0.08)` applies to all three (E §6, same additive form as the balance-sim formula, E §22.2). Lope Training (×1.05, Lope only), Brushwork Certification (×1.05, sweep-walk only), Lane Lock trait (×1.15, Lane Broom, sweep-walk only, while locked) and the Steep rule (×0.6) multiply after it.
- **No separate sprint.** Lope is the top ground speed. A third, faster ground state would change the hand-trip times the balance sim assumes (walk 3.4 m/s, E §22.2), and Hop bursts already give a fast "dash" over terrain. The INPUT bit called `sprint` means Lope (§6.8).
- **Analog stick:** target speed = state speed × `max(0.15, curve(deflection))`, curve exponent 1.6 after the radial deadzone (§6.6). Full deflection = walk; Lope is a button (toggle by default on gamepad).
- **Steep and local slope.** While **sweeping**, only the plot rule above applies (×0.6 on Steep plots), so the sim matches the balance sim. While **walking or loping**, local slope θ (finite differences) scales uphill speed by `1 − 0.5·clamp((θ − 20°)/(42° − 20°), 0, 1)` (×0.5 at 42°); downhill speed is not raised. Above **42°** there is no traction: the avatar slides along the gradient at `g·(sin θ − 0.4·cos θ)` (friction 0.4) until the slope drops below 42°. The terrain bake keeps > 45° to ≤ 1% of the surface (WDS §3.3).

### 2.3 Acceleration and deceleration (ground)

Velocity moves toward the target velocity with a clamped "move toward" (deterministic, frame-independent because it runs in ticks).

| Case | Rate | Result at base speeds |
| --- | --- | --- |
| Accelerate up to walk speed | **18 m/s²** × s | 0 → 3.4 m/s in **0.19 s** (4 ticks) |
| Accelerate from walk to Lope | **8 m/s²** × s | 3.4 → 5.0 m/s in 0.20 s; **0 → Lope 0.39 s** (8 ticks) |
| Release (no input) | **16 m/s²** × s | Stop from Lope in **0.31 s**, slide 0.78 m; from walk 0.21 s, 0.36 m. The short lope slide is the only "low-g skid" on the ground |
| Reverse (target opposes velocity, dot < 0) | **30 m/s²** × s | Turnaround from walk in 0.11 s |
| Lope → sweep (press Sweep while loping) | 16 m/s² | Down to 2.2 m/s in 0.18 s |

Accelerations scale with the speed multiplier `s`, so **time-to-max is the same at every Cadence level** (acceptance GF-01). The gait's visible low-g bounce (stride hang 0.45–0.6 s, art-direction §4.6) is animation over a grounded sim body, not sim airtime.

**Facing.** Not sweeping: the body yaw turns toward the movement direction at 720°/s (camera-relative movement). Sweeping: the body faces the aim direction (camera yaw) and movement strafes, so you can walk sideways along a lane. Lane Lock fixes the body yaw (§3.4).

### 2.4 Jump, jump cut, coyote time, buffer, Touchdown

| Parameter | Value | Derivation |
| --- | --- | --- |
| Jump apex (lunar) | **1.60 m** (E §3); Loft +20% / +40% → **1.92 / 2.24 m** | Launch speed `v0 = √(2·g·apex)` = **2.28 m/s** (2.49 / 2.69) |
| Time to apex / total air (flat) | **1.41 s / 2.81 s** (Loft II: 1.66 / 3.33 s) | `v0 / g` |
| Horizontal speed on takeoff | Kept (a Lope jump travels 14 m) | — |
| **Jump cut** ★ | Releasing Jump while rising multiplies upward speed by **0.45** (once per jump) | A tap gives a ≈ **0.4 m** hop with ≈ 1.4 s air; holding gives the full 1.6 m. Reason: low-g jumps are long; small hops keep you working |
| **Coyote time** | **0.15 s** (3 ticks) after leaving the ground without jumping, Jump still works as a ground jump | Lunar falls start slowly (18 mm in 0.15 s), so a longer window than Earth games feels fair |
| **Jump buffer** | Jump pressed up to **0.15 s** before landing fires on the landing tick | — |
| Ground snap | While grounded, the body is snapped down to the ground if it drops ≤ **0.40 m** per sub-step while sweeping, ≤ **0.30 m** walking, ≤ **0.15 m** loping; snap is off for 0.2 s after a jump | You keep the tool on the ground over pebbles and crater lips; at a Lope you still pop off sharp rims for a moment of low-g air (deliberate fun) |
| **Touchdown** ★ (new name) | Hold Touchdown while airborne: gravity × **2.5** (4.05 m/s²). From a 1.6 m apex you land in 0.89 s instead of 1.41 s | Lets you get back to cleaning; Touchdown landings use soft-landing rules up to 6 m/s and never Faceplant |
| Fall gravity | ×**1.0** (honest arcs) | Dust grains fly at true 1.62 m/s² (art-direction §3.6); a faster-falling body would look wrong beside them. Tuning range 1.0–1.3 if playtests call jumps too floaty |
| Jump while sweeping | Allowed; strokes stop while airborne (WDS §4.4) except the Crescent Squeegee's **Flick** (§3.3) | — |

### 2.5 Air control

| Parameter | Lunar | Earth-feel |
| --- | --- | --- |
| Air acceleration toward input | **2.5 m/s²** (≈ 7 m/s of steering over a full jump) | 6.0 m/s² |
| Air brake (input against velocity) | 4.0 m/s² | 8.0 m/s² |
| No input | Momentum kept (no air drag) | Same |
| Horizontal speed cap from air control | max(takeoff horizontal speed, walk speed × s); air control can steer and slow but never accelerates past it | Same |

### 2.6 Ballast Soles (Earth-feel) and Earth-Feel Comfort

Ballast Soles (suit gear, 1,500 LM, shared; toggle **B** / D-pad Left) switch the wearer to Earth-feel. They change feel only; walk, Lope and sweep-walk speeds are unchanged, so pacing is unchanged (E §20: a non-rate item).

| Parameter | Lunar (off) | Earth-feel (on) |
| --- | --- | --- |
| Gravity | 1.62 m/s² | **9.81 m/s²** (E §1) |
| Jump apex | 1.60 m (Loft scales both) | **0.45 m** (v0 2.97 m/s, air 0.61 s) |
| Ground accel / release decel | 18 / 16 m/s² | **30 / 30 m/s²** (stop from walk in 0.11 s) |
| Air accel / brake | 2.5 / 4.0 m/s² | 6.0 / 8.0 m/s² |
| Coyote time / jump buffer | 0.15 / 0.15 s | 0.10 / 0.15 s |
| Hop burst Δv | 3.0 m/s | ×1.6 = 4.8 m/s (≈ 0.8 m of lift per burst) |
| Landing thresholds (soft / heavy) | 3.2 / 5.0 m/s | 4 / 7 m/s |
| Toggle | Gravity blends over **0.3 s** (also mid-air); magnetic "clack" | — |

**Earth-Feel Comfort** (new name; accessibility setting, GDD §13 "Ballast Soles default-on"): when on, the player starts every session in Earth-feel and gets the B toggle **even if the shift has not bought Ballast Soles**. It grants no income or speed advantage (Earth-feel jumps are lower), so the economy is untouched. It is the "Ballast Soles default on" row of ui-screens-and-flows §3.21. *Interpretation of GDD §13; game-designer to confirm (§12 Q1).*

### 2.7 Hop Pack

Hop Pack levels (E §7, naming bible §6): **2 / 3 / 4 bursts** at L1 / L2 / L3; no Hop Pack = 0 bursts. **Second Wind** adds +1 burst (only with a Hop Pack, so 3 / 4 / 5) and recharge ×1.5.

| Parameter | Value |
| --- | --- |
| Trigger | Press Jump while airborne (after coyote time has expired), bursts > 0 |
| Δv per burst | **3.0 m/s** (E §3) along `normalize(cos 35°·up + sin 35°·moveDir)` with move input (2.46 up, 1.72 forward), or straight up without input |
| Fall arrest ★ | Before the burst is added, any downward speed is zeroed, so a burst always lifts you (+1.87 m forward burst, +2.78 m straight up from rest). Reason: the reference-style "burst wasted fighting the fall" feels bad |
| Caps | Upward speed after a burst ≤ **4.5 m/s** (a jump + immediate burst peaks 6.25 m above the burst point); horizontal ≤ **7.0 m/s** |
| Min interval | 0.25 s between bursts |
| Max climb (5 bursts, chained at each apex) | ≈ 17 m: enough for crater walls (10–20 m, WDS §3.3) and Pallet routes (E §15). A natural fall from 17 m lands at 7.5 m/s: heavy landing, no Faceplant |
| Recharge | Grounded time accumulates; when it reaches **4.0 s** (E §3; **2.67 s** with Second Wind), all bursts refill. Using a burst resets the accumulator; being airborne pauses it (does not reset) |
| Hold to chain (option) | With "Hop: Hold to chain", holding Jump fires the next burst automatically when upward speed falls below 0.5 m/s |
| Feel | Valve click + cold-gas hiss, white plume ≤ 0.3 s (art-direction §3.6), FOV +2° kick, light rumble (§7) |

### 2.8 Landing

| Vertical impact speed | Lunar | Effect |
| --- | --- | --- |
| < 3.2 m/s (any normal jump: 2.3 m/s; falls ≤ 3.2 m) | Soft | No penalty. Tool keeps working on the landing tick. Camera dip 0.03 m per m/s |
| 3.2–5.0 m/s (falls ≤ 7.7 m) | Medium | **0.10 s** recovery: ground accel ×0.5. Jump is still allowed (no lock) |
| 5.0–8.0 m/s | Heavy | **0.25 s** recovery: ground accel ×0.3. Trauma 0.15–0.35 (§4.7) |
| > 8.0 m/s, not Touchdown, not seated | **Faceplant** (on foot) | Comic tumble: move input returns after 0.8 s, jump after 0.5 s (animation-spec `land.stumble`), no other cost (GDD §3: "Falling over (Faceplant) is a joke"). Needs a > 19.7 m fall: rare by design |

Every landing: "world comes back" audio (ground conduction returns, audio-direction §1.2), dust ring from the boots, boot prints in the detail ring.

### 2.9 Collision primitives and rules

| Body | Primitive | Rule |
| --- | --- | --- |
| Avatar | **Capsule** r 0.32 m, height 1.80 m (suit 1.85 m, art-direction §4.1); eye 1.65 m | Ground probe from the capsule bottom; step-up **0.35 m** (0.25 and 0.5 m Deck Plate edges: the first steps, the second needs a jump or ramp) |
| Avatar vs avatar | **None (ghost)** | Players never block doorways or the Assay Counter (anti-grief) and never cause corrections to each other. Overlapping avatars dither at < 0.6 m from the camera |
| Avatar vs vehicle | OBB, see §5.6 | Ghost in Open Shifts and when Knockback is off; solid with knockback when the Private-shift Knockback toggle is on |
| Structures | Per piece `collider` in `build-pieces.json`: `obb` (Panels, machines, Nests, Handrails 1.0 m tall), `cylinder` (Roost towers, Lamp Pylons, Gantry posts), `walkableTop` (Deck Plates, Gantry catwalks, 15°/30° ramps), `none` (Glide Rails, rail pieces < 0.4 m, Dust Pucks, rocks) | Rails are walk-through and drive-through so they never snag; rocks are cosmetic (WDS §3.5) |
| Robots | None | Cosmetic for collision |
| Resolution | Per sub-step: push out of each overlapping primitive along the minimum axis, remove the velocity component into the contact normal (slide), up to 3 iterations; structures are found through the per-plot structure index | Property test: never inside an OBB after a tick; never below ground − 0.05 m |
| Ladders (Gantry ladder piece) | Interact to attach; W/S climb **1.6 m/s**; Jump detaches with a 1.6 m/s push away | — |

### 2.10 Sub-stepping, presentation and render interpolation

| Layer | Rate | What it does |
| --- | --- | --- |
| Sim tick | `SIM_TICK_HZ` (20 Hz) | Consumes exactly one input (netcode §5.1); runs N sub-steps (§2.1); emits strokes at the frame interval (WDS §4.4) |
| Input sampling | Every render frame | Axes are the latest value; **edge buttons are latched** (a 10 ms tap between ticks is never lost) until the next tick consumes them |
| **Own avatar / own vehicle presentation ★** | Every render frame | Render pose = a disposable **partial step** from the latest predicted tick state, using the latest sampled input for `alpha × dt` (alpha = frame position inside the tick). Input shows on screen within 1 render frame instead of waiting up to 50 ms for the next tick plus 50 ms of interpolation. The difference to the next committed tick (≤ 1 cm typical) is absorbed by the correction offset (§8.2). Debug toggle `presentPartialStep` falls back to plain interpolation (prev → curr by alpha) for A/B tests |
| Remote entities | Every render frame | Interpolation buffer (netcode §6, 150–250 ms) plus the §8.3 smoothing |
| Camera | Every render frame | Mouse look applied in the same frame as the event; rig springs use half-life smoothing `x += (target − x)·(1 − 2^(−dt/halfLife))` so they behave identically at 30, 60 and 144 FPS |

Timers kept in sim state (all integer ticks, must be in the reconciled Self state, §8.4): coyote, jump buffer, jump-cut used, Touchdown, Hop recharge accumulator, last-burst interval, landing recovery, Ballast blend, tumble/Faceplant lock, knockback pair cooldown.

---

## 3. Tool use

### 3.1 Aim model: ground reticle and reach

- **Reticle = the tool footprint on the ground** (art-direction §8.6: no crosshair). It is drawn at the real tool-head position from the predicted sim, so what you see is what you clean.
- **Direction** = body yaw while sweeping (follows camera yaw, §3.2), or the locked lane heading (§3.4).
- **Distance** `d` from camera pitch, by a fixed mapping (not a ray cast, so it is stable on rough ground): pitch ≥ **−20°** → `d = reach`; pitch ≤ **−55°** → `d = aimMin`; linear between. The client sends `d` in `INPUT.toolParam` (0–255 → 0–reach, netcode §4.1). Setting **Fixed aim** keeps `d` at 80% of reach whatever the pitch.
- **Reach** = tool reach (E §4) + Telescoping Pole (+0.6 / +1.2 m). **aimMin** = stroke length L + 0.45 m (the push stroke must clear the boots).

| Tool (E §4) | Width | Reach | Stroke time | Push length L | Aim range (no Pole) | RMB |
| --- | --- | --- | --- | --- | --- | --- |
| Desk Duster | 0.15 m | 1.2 m | 0.45 s | 0.45 m | 0.90–1.20 m | **Detailing**: scrub a 0.5 m disc to zero at the reticle, one disc per 0.45 s, body speed ×0.3 while held (WDS §4.4) |
| Crescent Squeegee | 0.28 m | 1.4 m | 0.55 s | 0.54 m | 0.99–1.40 m | Precision Aim |
| Bristle Broom | 0.45 m | 1.8 m | 0.70 s | 0.67 m | 1.12–1.80 m | Precision Aim |
| Lane Broom | 0.75 m | 2.0 m | 0.80 s | 0.87 m | 1.32–2.00 m | Precision Aim (Lane Lock is R) |
| Static Rake | 1.00 m | 2.6 m | 0.90 s | 0.85 m | 1.30–2.60 m | Precision Aim |
| Ion Curtain | 1.40 m (×1.15 Twin Pass) | 3.0 m | 1.00 s | 0.94 m | 1.39–3.00 m | **Twin Pass aim** = Precision Aim showing both stroke footprints |

**Precision Aim** (hold RMB / LT): look sensitivity ×0.5, camera boom −0.6 m, reticle shows the lane edges. In the air the RMB/LT button becomes **Touchdown** on gamepad (§6.3).

### 3.2 Stroke cadence (sim rule; matches E §4 area rates)

Each stroke cycle of `T` seconds (tool stroke time × (1 − 0.10 Master Stroke)) has a **contact phase** (70% of T) and a **lift phase** (30%).

| Rule | Value |
| --- | --- |
| Contact phase | The head pushes forward from `d − L` to `d` relative to the body, on the ground, emitting strokes (one per frame interval, WDS §4.4) |
| Lift phase | Head lifts > 0.15 m and swings back; no strokes. **Twin Pass**: the return also contacts (stroke width ×1.15, E traits.json) |
| Gap-free rule | `L = 0.3 × vMax × T + 0.05 m`, with vMax = 2.96 m/s (3.40 for the Lane Broom), so consecutive pushes overlap at the fastest sweep-walk. Coverage before lane overlap is therefore exactly width × speed, and the E §4 0.75 factor stays the only coverage loss (acceptance GF-12) |
| Head path | The WDS §4.4 deterministic triangle wave with smoothstep easing; phase from `inputSeq` |
| Standing still | Repeated pushes clean a `width × L` patch: the straggler move |
| Fast turns ★ | Body yaw follows camera yaw at up to 540°/s while sweeping. If the head's ground speed (body + push + turn) would exceed **5.5 m/s**, the head **lifts** (no strokes, soft "whff", dashed reticle) and drops again below 5.0 m/s. The server's 6 m/s stroke check (WDS §4.4) therefore never fires for honest input, and big tools feel heavy: you slow your turn to keep cleaning |
| Tool swap | Holster animation **0.35 s** (Quick Clip Benefit: instant); a swap pressed mid-contact waits for the end of the contact phase |
| Visual motion | Animation matches the phase (anticipation 80–120 ms, follow-through, art-direction §4.6). The Desk Duster is wiped in small circles on screen; its sim stroke is still the push model |

### 3.3 Traits that change feel

| Trait (E §4, traits.json) | Feel rule |
| --- | --- |
| Detailing (Desk Duster) | §3.1 RMB. Each disc: "fwip" + tiny ivory sparkle when a texel hits zero |
| Flick (Crescent Squeegee) | Strokes continue while airborne if the feet are ≤ **1.2 m** above ground; the head is projected to the ground (WDS validation 5 still holds). Hop-sweeping crater lips becomes a skill move |
| Sure Footing / Charge | No Steep ×0.6. Charge: blue crackle bed, whine rises with charge; the ×1.5 finishing Stamp shows "Charged" on the Stamp toast |
| Lane Lock (Lane Broom) | +15% sweep-walk while locked; HUD lock glyph turns teal |
| Twin Pass | Return stroke cleans; two-tone hum, grains stream both ways |

### 3.4 Lane Lock and Lane Guide (assist)

- **Lane Lock** (R toggle / Right-stick click; hold option): freezes the body and tool heading at the current yaw. While locked, **movement is lane-relative** (W = along the lane, A/D = step across lanes, S = back) and the camera looks around freely. The client sends the locked heading as `INPUT.yaw` and sets the `laneLock` bit (§6.8), so the server knows the Lane Broom bonus applies. Engage/disengage: two-tone click, 150 ms.
- **Lane Guide** ★ (new name; setting Off / Guide / Guide + Magnet, default **Guide + Magnet**). Pure client input shaping, so the sim stays authoritative and deterministic:
  - When Lane Lock engages within **±12°** of parallel (or anti-parallel) to one of your own lanes from the last 30 s, and within 1.5 × width of it, the locked heading snaps to exactly parallel.
  - A faint guide line is drawn at **width × 0.90** from that lane's centre (10% overlap).
  - **Magnet:** when the head is within 0.5 × width of the guide, a lateral input correction of up to **0.25 m/s** pulls toward it; any opposing strafe input > 0.3 disables the magnet for 1 s.
  - Reason: perfect parallel lanes are the genre's core satisfaction, and doing them by eye on a curved, cratered surface is fiddly.

### 3.5 Per-stroke feedback rules

Rate: one feedback set per **contact-phase start** (so 1.0–2.2 per second, by tool), not per 10 Hz stroke record. Scaled by the grams that stroke removed (from the predicted ledger); on clean ground the feedback switches to the "done" variant.

| Channel | Rule | Grime | Clean ground |
| --- | --- | --- | --- |
| Audio | Tool core layer per contact (audio-direction §2.1), pitch ±3% per stroke (client-side seed), gain by grams | Full, soft | Thin, higher, slight squeak |
| VFX | Grains ∝ grams (art-direction §3.6), berm and strip; minimum-juice floor on every preset | Burst | None, faint ivory glint at the head |
| Haptic (gamepad) | `dual-rumble`, 35 ms; weak motor 0.10–0.30 by grams, strong motor 0 (T1–T3) / 0.10 (T4–T6) | On | Off |
| Camera micro-kick | Boom shortens by 1.5 cm (T3–T4) / 2.5 cm (T5–T6) and recovers with a 0.06 s half-life; T1–T2 none. Not trauma (§4.7); off with Reduce Motion | On | Off |
| UI | Cell kg ticks; gauge eases; no per-stroke floater | On | — |

### 3.6 Cell full, pucks, pour and throw

| Moment | Behaviour |
| --- | --- |
| Cell ≥ 90% | Two-tone audio, Cell gauge pulses amber, suit Dust Cell window blinks, light double rumble (0.15 / 2 × 30 ms) |
| **Cell full** | Pickup stops (WDS §4.6). The tool keeps animating but sounds "dry"; no grains; reticle turns amber with diagonal hatching (colour-blind safe); prompt within 1 frame: "**F** Form Dust Puck · **Hold F** band into Puck Stacks · Pour at Assay Counter (E) · 140 m" with the bearing to the nearest sell point. Strong rumble 0.5 / 80 ms. Nothing auto-stops. With **Overflow Former**: one Puck Stack drops at your feet on the tick the Cell fills and you keep sweeping (≤ 1 tick of lost pickup) |
| F tap / hold | Tap: one 1-kg Dust Puck pops out at the feet (0.2 s press anim). Hold **0.30 s**: bands the whole Cell into Puck Stacks (≤ 20 kg each, E §5), 0.15 s per stack, tape-zip sound |
| Pour (hold E at an Assay Counter slot or Puck Former, within 2.5 m) | Pour time **6 s × (1 − Quick Pour) × (0.5 with Smooth Handoff)** for a full Cell (E §22.2), linear drain. Releasing early stops the pour; what was poured is sold. The server credits the sale in **0.5 s increments**, so the LM tick-up runs live (3+ increments merge, art-direction §8.7). Pour animation and gauge drain are predicted; LM is server-confirmed |
| Pick up (Q / B) | Nearest puck or stack within **1.5 m** (+1.5 / +3 m Puck Magnet, which also visibly pulls pucks in over 0.25 s) |
| Throw (hold Q / B, release) | Charge **0–0.8 s** → speed **4–8 m/s** at a fixed **30°** launch above the camera heading (Strong Arm +30 / +60%, Railhand +10%). Lunar range: 34 m at 8 m/s (4.9 s flight), 88 m at 12.8 m/s. A dotted ballistic arc preview (g = 1.62, even under Ballast Soles) and landing ring show while charging. Landed pucks skid at 3 m/s² decel, no bounce. Smooth Handoff snaps pucks landing ≤ 2 m from a Glide Rail onto it |

---

## 4. Camera

### 4.1 Third-person rig (default)

| Parameter | Value |
| --- | --- |
| vFOV | **60°** (visual-target §2.5); setting **50–80°** |
| Pivot | 1.45 m above the feet (on the *displayed* pose, §8.2), shoulder offset **0.30 m** right (0.15 m while sweeping); MMB swaps shoulder; setting Left / Centre / Right |
| Boom by pitch | +30°: 3.6 m · 0°: 4.4 m · **−18° (default): 4.2 m** · −45°: 3.8 m · −70°: 3.2 m; piecewise linear. Setting "Camera distance" ×0.75–×1.4 |
| Pitch limits | −70° (look down at the tool) to +30° |
| **Up vector (sphere-aware)** | Camera up → `normalize(p)` with a **0.12 s** half-life slerp. Camera forward is **parallel-transported** each frame (minimal rotation taking the old up to the new up), then yaw/pitch input is applied. No north reference anywhere in the camera, so walking over a pole never spins or flips the view (GF-24) |
| Follow damping (half-life) | Horizontal **0.04 s**; vertical grounded 0.08 s; vertical airborne **0.22 s** (jumps feel floaty, the frame stays calm) |
| Look-ahead | Pivot leads by `velocity × 0.12 s`, capped 0.6 m, eased with 0.3 s half-life (50% with Reduce Motion) |
| Air framing | Falling with feet > 3 m above ground: pitch biases down up to 10° at 20°/s so the landing spot is visible; released over 0.5 s after landing; suppressed for 0.5 s after any look input; off with Reduce Motion |
| Landing dip | −0.03 m per m/s of impact, max 0.25 m, recovers with 0.12 s half-life; off with Reduce Motion |
| Collision | Sphere probe r **0.25 m** from pivot to camera against terrain (8 height samples along the boom) and structure colliders. Pull-in is **instant**; release eases with **0.20 s** half-life. Minimum boom 0.9 m; under 1.2 m the avatar dithers to 25% opacity. On open terrain the camera is **lifted** to stay ≥ H + 0.35 m before the boom is shortened |
| Mouse look | Raw, unsmoothed, applied in the frame it arrives. Default **0.07°/count** (setting 0.01–0.50) |
| Gamepad look | §6.6 curve; ×0.7 while sweeping for lane precision |
| Auto-centre | Off on foot (players own the camera); gamepad option "Auto-centre when moving": recentre behind after 1.5 s without look input at 60°/s |

### 4.2 First person (V / hold D-pad Up)

Eye 1.65 m, vFOV **65°** (setting 55–80°, visual-target §2.5), no roll ever, head bob **off** by default (option 0–100%; 100% = 2 cm vertical at Lope, 0 at walk). Body visible without the head (legs and tool), near plane 0.05 m (rendering-pipeline §4). The ground reticle stays the aim cue. Transition 3P ↔ 1P: **0.30 s** ease-in-out cubic, FOV interpolates, the avatar fades out over the last 0.1 s. Motion-sickness-friendly defaults: FOV ≥ 65°, no bob, no air framing, no landing dip in first person.

### 4.3 Vehicle cameras

Default mode **Chase** (new name): auto-aligns behind the vehicle's *velocity* heading after a delay with no look input. Setting **Free Look** (new name) disables auto-align (GDD §9; ★ the reference shipped without this toggle, [R C11]). The label is "Chase", not "Follow": "Vehicle camera follows behind" is a reference UI term on the do-not-use list (moon-sweepers-mechanics §8), so the Settings screen (ui-screens-and-flows §3.21, which says "Follow / Free-look") should use Chase / Free Look.

| Vehicle | Boom | Pivot height | Default pitch | vFOV | Boost FOV kick | Look-ahead (cap) | Follow half-life | Chase delay / rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Trundle (walk-behind) | 4.6 m | 1.5 m | −20° | 60° | +3° | 0.15 s (0.8 m) | 0.05 s | 1.0 s / 120°/s |
| Skiff | 6.0 m | 1.8 m | −14° | 62° | +6° | 0.20 s (2.0 m) | 0.06 s | 1.2 s / 90°/s |
| Carryall (driver) | 9.0 m | 2.6 m | −14° | 62° | +5° | 0.25 s (3.0 m) | 0.08 s | 1.5 s / 75°/s |
| Carryall (passenger) | 7.0 m orbit around the seat | 2.0 m | −12° | 62° | — | — | 0.08 s | Free look only |
| Bulldust | 10.0 m | 3.0 m | −16° | 64° | +5° | 0.25 s (3.0 m) | 0.08 s | 1.5 s / 75°/s |
| Behemoth | 16.0 m | 5.5 m | −18° | 66° | +4° | 0.30 s (2.5 m) | 0.12 s | 2.0 s / 50°/s |

Rules: speed FOV +0.4° per m/s above 5 m/s (cap +5°), plus the boost kick; **total FOV offset cap +10°**. In the air the camera keeps the horizon level (no roll) and follows the **velocity** heading, not the body, so a Lunar Loop or Corkscrew never spins the view. Mouse wheel zooms the boom ±30% in vehicles (on foot the wheel selects tools). Enter/exit blend **0.35 s** ease-in-out cubic. With Reduce Motion: chase rate halved, no FOV kicks.

### 4.4 Survey Globe (map/orbit) transition

| Phase | Value |
| --- | --- |
| Open (M / View) | **1.1 s** camera lift along an arc from the rig to 6,000 m altitude (8,000 m from the centre), ease-in-out quint `cubic-bezier(0.83, 0, 0.17, 1)`; vFOV 60° → 35°; HUD fades in 120 ms; world audio low-passes. The avatar gets neutral input and decelerates (the world never pauses, ui-screens-and-flows §1.2) |
| Globe camera | Distance 3,000–12,000 m from the centre; quaternion trackball (pole-safe); drag 0.25°/px at 8,000 m, scaled by distance; inertia half-life 0.18 s; wheel/trigger zoom steps ×1.15 with 0.15 s smoothing; double-click a plot recentres in 0.6 s |
| Close | **0.8 s** return to the stored rig pose |
| Reduce Motion | 0.3 s crossfade cut both ways |

### 4.5 Photo mode (F9; pause menu on gamepad; rendering-pipeline §16)

Free camera within 30 m of the avatar and ≥ H + 0.3 m. Move 3 m/s (Shift 9 m/s, Ctrl 0.6 m/s) with 0.15 s half-life smoothing; look 1:1; vFOV **15–90°** (wheel / D-pad); roll ±45° (Q/E, LB/RB); DOF focus at the screen-centre ground point; capture F2 / A. Exits on Esc / B or after 5 min idle. Shake, kicks and look-ahead are all off.

### 4.6 FOV kicks

| Source | Kick | In / out |
| --- | --- | --- |
| Vehicle boost start | Per §4.3 table | 0.25 s ease-out / 0.6 s |
| Hop burst | +2° | 0.10 s / 0.40 s |
| Lope (on foot) | +2° while loping | 0.3 s / 0.4 s |
| Railshot within 60 m | −1.5° (a "pull") | 0.15 s / 0.8 s |

Sum capped **+10° / −2°**. Reduce Motion: all 0.

### 4.7 Camera shake (trauma model, client only)

- `shake = trauma² × (max translation 0.06 m, max rotation 1.2°) × user Shake scale` (default **70%**, 0–100%). Value noise at 16 Hz, client-side seed. Shake rotates the camera about its own position (never pushes it into geometry).
- Trauma decays **1.6 /s**; **cap 0.8**; per-second added trauma cap 0.9; continuous sources (Behemoth within 15 m, boosting) set a *floor* of ≤ 0.15 rather than adding.
- Never in menus, the Survey Globe, photo mode or first person (first person: ×0.3 of the value).

| Source | Trauma |
| --- | --- |
| Heavy on-foot landing | 0.15 + 0.05 per m/s above 5, max 0.35 |
| On-foot Faceplant / knocked back | 0.6 / 0.35 |
| Vehicle landing | 0.05 + 0.06 per m/s above 2, max 0.5 |
| Vehicle Faceplant | 0.7 |
| Inspector's Stamp on a plot you are credited with, within 30 m | 0.10 (the "ka-chunk") |
| Railshot | 0.25 × (1 − d / 300 m) |
| Behemoth passing within 15 m | floor 0.10 |
| Hop burst | 0.05 |

**Reduce Motion** (OS `prefers-reduced-motion` or in-game toggle) forces: shake 0, FOV kicks 0, stroke micro-kicks 0, landing dip 0, air framing off, head bob 0, look-ahead 50%, map transition cut. Acceptance GF-27 checks zero displacement.

---

## 5. Vehicles (arcade handling on the sphere)

### 5.1 Model

One rigid body per vehicle, integrated with 4 sub-steps per tick (§2.1). **Raycast suspension**: each probe casts along −body-up from its mount, length rest + travel + wheel radius, against the height function and walkable structure tops. Spring and damper act along body-up at the contact. Driving is arcade: longitudinal speed moves toward the throttle target; lateral velocity decays by a grip rate; **yaw rate is set kinematically** (no tyre-force simulation), limited by a lateral-acceleration cap so turns widen with speed. Lateral acceleration produces **no roll torque** (forces act at the centre of mass), so vehicles don't tip over in 1/6 g while cornering; they tip only from terrain impacts and air. Gravity 1.62 m/s² always (Ballast Soles never affect vehicles).

### 5.2 Per-vehicle constants

Spring constants are given as natural frequency f and damping ratio ζ (mass-independent, easy to tune), with the derived per-probe values `k = m_p·(2πf)²`, `c = 2ζ·m_p·2πf` (m_p = mass ÷ probes). Masses are handling units, not lore.

| | Trundle | Skiff | Carryall | Bulldust | Behemoth |
| --- | --- | --- | --- | --- | --- |
| Mass / probes | 180 kg / 3 (2 wheels + drum) | 450 kg / 4 | 1,800 kg / 6 | 3,200 kg / 4 | 12,000 kg / 8 (4 per track) |
| Rest length / travel / wheel radius | 0.18 / 0.05 / 0.20 m | 0.35 / 0.18 / 0.42 m | 0.40 / 0.22 / 0.45 m | 0.45 / 0.20 / 0.55 m | 0.50 / 0.15 / 0.35 m (road wheels) |
| f / ζ | 3.0 Hz / 0.50 | **1.6 Hz / 0.35** (bouncy) | 1.4 Hz / 0.40 | 1.5 Hz / 0.40 | 0.9 Hz / 0.50 (slow, majestic) |
| k per probe (N/m) | 21,320 | 11,370 | 23,210 | 71,060 | 47,970 |
| c per probe (N·s/m) | 1,131 | 792 | 2,111 | 6,032 | 8,482 |
| Cruise (top speed, E §8) | **3.0 m/s** | **6.5 m/s** | **7.5 m/s** | **6.2 m/s** | **4.8 m/s** |
| 0 → cruise | 1.0 s (3.0 m/s²) | 2.2 s (2.95) | 3.0 s (2.5) | 3.2 s (1.94) | 4.5 s (1.07) |
| Brake / coast decel | 6.0 / 2.0 m/s² | 6.0 / 0.8 | 5.0 / 0.8 | 4.0 / 1.0 | 3.0 / 1.5 |
| Reverse max | 1.5 m/s | 2.6 m/s | 3.0 m/s | 2.5 m/s | 1.9 m/s |
| Turn rate cap | 120°/s; turns in place 90°/s | 95°/s | 60°/s | 55°/s (articulated) | 30°/s; pivot-turns in place 20°/s |
| Lateral-accel cap | — (walk-behind) | 6.0 m/s² | 4.0 m/s² | 4.5 m/s² | 3.0 m/s² |
| Turn radius at cruise | ≈ 1.4 m | **7.0 m** | 14.0 m | 8.5 m | 9.2 m |
| Lateral grip (1/s) | 20 | 6 (playful slides) | 8 | 9 | 14 |
| Boost (E §8; Afterburner ×1.45 / ×1.60) | ×1.30 | ×1.40 | ×1.40 | ×1.35 | ×1.25 |
| Intake downforce (intake down) | n/a (ground snap 0.40 m) | 1.5 m/s² | — | 1.2 m/s² | 0.8 m/s² |
| Air control (§5.4) | none | ×1.0 | ×0.5 | ×0.8 | ×0.5 |

- Wheel radii, travel and f / ζ match the visual body springs of animation-spec §5.2, so the sim compression animation reads is the same spring it shows (Behemoth: 8 sim probes; the 14 visual road wheels follow interpolated heights).
- Yaw rate = `min(turn rate cap, lateral cap ÷ |v|)` × steer input. Handbrake (Space / B): grip ×0.35 and lateral cap ×1.6 for drifts and turnarounds.
- **Speed modifiers:** Gear Ratio +8 / 16 / 24% on cruise and boost; Wide Mouth ×0.92 / 0.85 / 0.78 on cruise **while the intake is down**; Driver Certification +5% cruise; Second Wind "vehicle trip time −5%" = cruise ×1.053 **while the payload is full, and always on the Carryall** (the trip leg only, so the area rate is unchanged; *interpretation, §12 Q2*).
- **Boost meter:** 4.0 s full (Comfort Seat +5% → 4.2 s); regenerates at 0.5 s per s after a 1.0 s delay (8 s to full). **Boosting raises the intake** (no cleaning, no downforce): boost is for travel, so vehicle area rates stay at cruise, as the balance sim assumes (E §22.2).
- **Intake** is down when moving forward with payload space and ≥ 2 probes in contact; it lifts when boosting, airborne, reversing or full. Intake downforce ("skirt suction") keeps a cleaning vehicle planted over small bumps; boost removes it, which is when you get air.
- **Throttle Lock** (C / Right-stick click): holds the current target speed hands-free; steering stays live; brake or throttle input cancels.
- **Steep:** traction fades linearly from 20° to 25° local slope; above 25° the vehicle slides down at `g·(sin θ − 0.2·cos θ)` (E §1: vehicles slide on Steep).

### 5.3 Collisions

| Pair | Rule |
| --- | --- |
| Vehicle body | One OBB (Bulldust: two OBBs on the articulation joint) |
| Vehicle vs structures | `obb` and `cylinder` colliders are solid (push-out, restitution 0.2); `walkableTop` pieces are drivable; rails and pieces < 0.4 m tall are ignored (§2.9) |
| Vehicle vs vehicle | Private Shift: solid, push-out speed ≤ 3 m/s, no damage. Open Shift: ghost (no blocking of services) |
| Vehicle vs terrain body contact | Chassis touching ground with < 2 probes in contact during a landing = Faceplant (§5.5) |

### 5.4 Air time and trick hooks

| Item | Value |
| --- | --- |
| Airborne | No probe in contact for ≥ 0.2 s |
| Air controls | Pitch from throttle/brake axis (W/S, LS-Y), roll from steer (A/D, LS-X): angular accel 240°/s², max 200°/s pitch / 220°/s roll, angular damping 0.3/s; × the vehicle's air-control factor |
| **Auto-Level** (new name; default on) | After 0.4 s with no air input, the vehicle levels toward the landing surface at 90°/s. Tricks are still possible |
| Example | A Skiff at 8 m/s off a 30° ramp: 4 m/s up → **4.9 s** in the air, ≈ 4.9 m apex |

Trick detection is **server-side** from sim state (payouts and caps are E §2: Hang Time 25 · Moonshot! 100 · Lunar Loop 150 · Corkscrew 150 LM, ×1.5 per extra trick in one air, driver only, 250 LM/driver and 500 LM/shift per 10 min).

| Callout (naming bible §7) | Detection |
| --- | --- |
| Hang Time | Airborne ≥ **2.0 s** and apex ≥ 0.5 m above takeoff |
| Moonshot! | Airborne ≥ **4.0 s** or apex ≥ **8 m** above takeoff (replaces Hang Time in the same air) |
| Lunar Loop | Net pitch rotation ≥ **330°** (each further full loop counts again) |
| Corkscrew | Net roll rotation ≥ **330°** (each further full roll counts again) |
| Landed | ≥ 2 probes touch within 0.15 s and body-up within **60°** of the surface normal |
| **Faceplant** | Body-up > 60° from the normal at first contact, or chassis contact first: voids the air's tricks |

The Trundle never scores (walk-behind, ground snap). The client predicts the callout name at landing from its own sim (§8.1); the LM amount appears when the server confirms (`vehicle.trick_landed`).

### 5.5 Faceplant recovery

The vehicle tumbles; once its speed is < 0.5 m/s or 2.0 s have passed, it auto-rights in place over 0.8 s (kinematic lift and rotate, dust puff). No damage, no payload loss. Driver stays seated.

### 5.6 Knockback of players

| Shift / setting | Behaviour |
| --- | --- |
| Open Shift | Vehicles ghost through avatars (GDD §7.5) |
| Private / Solo, **Knockback off (default)** | Ghost, like Open (*default chosen here; §12 Q3*) |
| Private, **Knockback on** (Holder toggle) | Contact with relative speed ≥ **1.5 m/s** launches the avatar: velocity = 1.2 × the vehicle's velocity along the contact normal + **2.5 m/s up**, capped **9 m/s** (≈ 3 s of lunar flight); 0.6 s tumble with input locked; no Faceplant, no cost. The same vehicle can't hit the same avatar again for 2.0 s. Below 1.5 m/s the avatar is pushed aside. The driver earns nothing for hits |

Knockback is decided by the server only (the driver sees the remote avatar 150–250 ms late, so it can't be predicted fairly). The victim's client receives it as a flagged correction and applies the new velocity as an impulse over 150 ms (§8.2).

### 5.7 Enter / exit flow

| Step | Rule |
| --- | --- |
| Prompt | Within **2.5 m** of the driver seat marker (Trundle: handle) and facing it within 90°: "E Drive Skiff" (owner or Loaner Kit holder only; others see "Owner only") |
| Enter | Avatar moves into the seat over **0.45 s** (predicted animation only, netcode §5); camera blends 0.35 s; music Drive layer enters on the next bar. Driving input goes live when the server confirms (`vehicle.entered`) or the animation ends, whichever is later; at 120 ms RTT the confirm always lands inside the animation. A rejection reverses the animation in 0.3 s with a toast |
| Exit | E (KBM), hold X **0.4 s** (gamepad). Above 2.0 m/s, exit is queued: the vehicle brakes, then you step out. Not while airborne (queued to landing). Exit spot: 1.2 m left of the seat; if blocked, right, rear, front, then roof (Behemoth ladder) |
| Carryall passengers | E at any seat takes the nearest free one; T / Y switches to the next free seat; passengers have free look and can't drive or load |
| Relay Pad | Not from vehicles (E §2) |

### 5.8 Trundle (walk-behind) specifics

- The avatar stays on foot behind the T-handle, 1.0 m behind the cart's centre, and the pair moves as one compound body (cart OBB + avatar capsule). Avatar animation: walk / jog with foot IK; the brush drum spins with speed.
- Controls as a vehicle (W/S throttle, A/D steer, Shift boost to 3.9 m/s "jog"), mouse look free; on-foot camera rig with Trundle values (§4.3).
- Uses the avatar's sweep ground snap (0.40 m), so it never leaves the ground: no air, no tricks, no Faceplant.
- Turns in place at 90°/s (pivot around the drum). On Steep (traction 0 above 25°) the cart stops and slides back slowly; let go (E) and use your hand tools or Hop Pack.
- Grabbing the handle takes 0.3 s; letting go is instant. 1 puck slot (T loads within 3 m, E §8).

---

## 6. Controls

### 6.1 Contexts

Bindings are grouped by context; a key may mean different things in different contexts but never two things inside one. Contexts: **Always**, **On foot**, **Driver**, **Passenger**, **Build** (Assembly Gun drawn), **Globe**, **Photo**, **Menu** (ui-screens-and-flows §1.2 owns menu navigation).

### 6.2 Keyboard and mouse (defaults; GDD §9 plus the additions marked +)

| Action | Key | Context | Default type |
| --- | --- | --- | --- |
| Move | W A S D | On foot | Hold |
| Look | Mouse | Play contexts | — |
| Sweep | LMB | On foot | Hold (options: Toggle, **Auto-Sweep**) |
| Tool trait / Precision Aim (+) | RMB | On foot | Hold |
| Lane Lock | R | On foot | Toggle (option Hold) |
| Jump; Hop Pack burst (press again in air) | Space | On foot | Press (jump cut on release) |
| **Touchdown** (+) | Left Ctrl | On foot, airborne | Hold |
| Lope | Left Shift | On foot | Hold (options: Toggle, Always-Lope with Shift to walk) |
| Interact; hold to pour | E | On foot | Press / hold |
| Form Dust Puck (tap) / band into Puck Stacks (hold 0.30 s) | F | On foot | Tap / hold |
| Pick up / drop (tap); throw (hold, release) | Q | On foot | Tap / hold |
| Tool slots | 1–6 / wheel | On foot | Press |
| Draw Assembly Gun | X | On foot | Press |
| Plot Card | C | On foot | Toggle (option Hold) |
| First / third person | V | On foot | Press |
| Shoulder swap (+) | MMB | On foot | Press |
| Survey Globe | M | Always (not in menus) | Toggle |
| Ping wheel | Z | On foot, Driver | Hold (option Toggle) |
| Crown Lamp / Lowlight Visor / off | N | On foot | Press (cycles) |
| Ballast Soles | B | On foot | Press (toggle) |
| Shift Roster | Tab | Always | Hold (option Toggle) |
| Chat / DOT Handbook / pause | Enter / H / Esc | Always | Press |
| Quick screenshot (+) / Photo mode (+) | F2 / F9 | Play contexts | Press |
| Throttle / brake-reverse / steer | W / S / A D | Driver | Hold |
| Boost (Afterburner) | Left Shift | Driver | Hold |
| Handbrake (+) | Space | Driver | Hold |
| Throttle Lock / Wide Mouth cycle / Running Lamps | C / R / L | Driver | Press |
| Load/unload pucks and stacks / exit | T / E | Driver | Press |
| Air pitch / roll | W S / A D | Driver, airborne | Hold |
| Next seat / exit | T / E | Passenger | Press |
| Place (hold to Settle) / cancel / rotate 30° | LMB / RMB / R | Build | Hold / press |
| Rail Run | Hold LMB and drag (rail piece selected) | Build | Hold |
| Mode cycle / snap toggle / category | Q / Ctrl / wheel | Build | Press |
| Photo: move / up-down / roll / FOV / capture / exit | WASD / Space-C / Q E / wheel / F2 / Esc | Photo | — |

### 6.3 Gamepad (W3C "standard" mapping)

| Index | Button | On foot | Driver | Build |
| --- | --- | --- | --- | --- |
| b0 | A | Jump / Hop burst | Boost (Afterburner) | — |
| b1 | B | Pick up / drop (tap); throw (hold, release) | Handbrake (+) | — |
| b2 | X | Interact; hold to pour | Hold 0.4 s: exit | — |
| b3 | Y | Form Dust Puck (tap) / band (hold) | Load / unload | Mode cycle |
| b4 / b5 | LB / RB | Tool slot prev / next; hold both: Assembly Gun | — | Rotate 30° |
| b6 | LT (analog) | Tool trait / Precision Aim; **Touchdown while airborne** (+) | Brake / reverse | Cancel |
| b7 | RT (analog) | Sweep | Throttle | Place (hold to Settle) / Rail Run |
| b8 | View | Survey Globe (tap); Shift Roster (hold) | same | same |
| b9 | Menu | Pause | Pause | Pause |
| b10 | Left-stick click | Lope (toggle; clears after 0.5 s of no stick) | — | Snap toggle |
| b11 | Right-stick click | Lane Lock | Throttle Lock | — |
| b12 | D-pad Up | Plot Card (tap); camera 1P/3P (hold) | Wide Mouth cycle | Category |
| b13 | D-pad Down | Ping wheel (hold) | Ping wheel (hold) | Category |
| b14 | D-pad Left | Ballast Soles | — | Category |
| b15 | D-pad Right | Lamp / Visor / off | Running Lamps | Category |
| axes 0/1 | Left stick | Move | Steer (X); air pitch (Y) and roll (X) | Move |
| axes 2/3 | Right stick | Look | Look | Look |

- Passenger: Y next seat, hold X exit. Photo mode and screenshot: pause menu entries (b16 "Home" belongs to the browser/OS).
- Triggers: press at 0.15, release at 0.10 (hysteresis). A pad whose `mapping !== "standard"` opens a guided remap ("press Jump…") before play.
- Glyph sets: Xbox (default), PlayStation (vendor id `054c` in `Gamepad.id`), generic; switch within one frame of input (ui-screens-and-flows §1.2).

### 6.4 Rebinding

- Every action in §6.2–6.3 is rebindable **per context**, with up to 2 bindings per device (primary, secondary). Mouse buttons 1–5 and wheel up/down are bindable; chords only for "Assembly Gun" (LB+RB) and modifiers in Build.
- **Not rebindable:** Esc and Menu (pause, browser-reserved behaviour), F11/F12 (browser).
- Conflict check inside a context and against **Always**; a conflict prompts "Swap / Cancel".
- Stored in the profile (synced via `PATCH /v1/me`) with a localStorage fallback; "Reset context" and "Reset all".
- Defaults live in `packages/game-data/data/input-bindings.json` (§10.6); every prompt glyph reads the live binding.

### 6.5 Input buffering

| Input | Buffer / rule |
| --- | --- |
| Any edge button | Latched until the next sim tick consumes it (a tap shorter than one tick is never lost) |
| Jump | 0.15 s before landing (§2.4); coyote 0.15 s after leaving ground |
| Hop burst | A burst pressed during the 0.25 s minimum interval fires when it ends |
| Interact | 0.20 s (pressing E while still arriving at the Assay Counter starts the pour on arrival) |
| Sweep | Held Sweep starts the first contact on the landing tick |
| Tool swap | Queued to the end of the current contact phase (§3.2) |
| Tap vs hold | Hold threshold **0.30 s** (F, Q/B, D-pad Up, View); accessibility range 0.2–0.8 s |
| Device switch | Last-used device wins; a gamepad takes over only on a button press or stick deflection > 0.25 sustained 100 ms (ui-screens-and-flows §1.2). Idle axes never produce movement while KBM is active ★ ([R C11] stuck-W bug) |

### 6.6 Gamepad sticks and look

| Parameter | Default | Setting range |
| --- | --- | --- |
| Move deadzone (radial, inner / outer) | 0.12 / 0.95 | inner 0.05–0.30 |
| Look deadzone (radial, inner / outer) | 0.10 / 0.97 | 0.05–0.30 |
| Look response | Exponent 2.0 | 1.0–3.0 |
| Max look rate yaw / pitch | 240 / 160 °/s | 60–480 |
| Look acceleration | After 0.25 s at > 0.95 deflection, yaw ramps +30% over 0.3 s | Off / On |
| Sweeping look scale | ×0.7 | 0.4–1.0 |
| Precision Aim scale | ×0.5 (mouse and gamepad) | 0.25–1.0 |

### 6.7 Pointer lock and Esc

| Situation | Behaviour |
| --- | --- |
| Clock In click | Requests pointer lock with `{ unadjustedMovement: true }` (raw input) and falls back to a plain lock where unsupported; the same gesture resumes the `AudioContext` (audio-direction §7.1) |
| Esc in Play | The browser always releases the lock on Esc. We treat the `pointerlockchange → unlocked` as "open the pause menu (Time Card, naming-bible A10)" in the same frame, so one Esc = unlock + pause, never two steps |
| Panels (Desk, Console, Globe…) | Opening releases the lock (ui-screens-and-flows §1.1). Closing with the **same interact key or a click** re-requests the lock from that gesture. Closing with **Esc** can't re-lock (Esc is not a user-activation key), so a small "Click to resume" prompt appears over the canvas |
| Re-lock refused | Chromium refuses a re-lock for about 1 s after a user exit; the "Click to resume" prompt stays until the lock succeeds |
| Gamepad play | No pointer lock needed; the cursor is hidden by CSS while the gamepad is the last-used device |
| Tab hidden | Inputs stop; the net layer sends `visibility {hidden: true}` (netcode §4.1) |

### 6.8 Input contract notes (proposal for contracts-architect)

The INPUT record (netcode §4.1, `shared/sim/input.ts`) needs these changes for this spec. Proposed as one batched change:

1. Rename button bits to current names: `sprint` → `lope`, `anchorBoots` → `ballast`, `plotScan` → remove (Plot Card is UI-only).
2. Add state bits **`laneLock`** and **`yawFrame`** (§2.1). Add **`touchdown`** (split from `brake/descend`, which stays for vehicles), **`handbrake`**, **`pickupThrow`** (held; release = throw, charge = held ticks), **`formPuck`** (held; tap vs hold resolved in the sim at 0.30 s) and a 3-bit **`toolSlot`** direct select. The u16 `buttons` field is full, so widen it to **u32** (INPUT 10 → 12 B; +40 B/s upstream at 20 Hz).
3. Add the §2.10 feel timers to the reconciled **Self** state (≈ 24 bits: coyote 3, buffer 3, Hop recharge 7, landing recovery 3, Ballast blend 3, tumble lock 4, flags 1), and the vehicle boost meter (6 bits). Without them, replay after a correction diverges for a few ticks.

### 6.9 Accessibility (GDD §13; settings screen owned by ui-ux, ui-screens-and-flows §3.21)

| Feature | Spec |
| --- | --- |
| Sensitivity | Mouse 0.01–0.50 °/count; gamepad §6.6; separate vehicle-camera sensitivity |
| Invert | Invert Y (mouse and gamepad separately), invert X, **invert vehicle air pitch** separately |
| Hold ↔ toggle | Every hold action has a toggle variant: Sweep, Lope, Precision Aim, Touchdown, Ping wheel, Shift Roster, Plot Card, pour, Outpost Recall (toggle starts a 5 s countdown with an on-screen cancel), Assembly Gun chord |
| **Auto-Sweep** (name registered in naming-bible A11) | Sweep stays on while any movement direction is held; tap Sweep to stop. GDD §13 "auto-sweep" |
| Hop | Press / **Hold to chain** (§2.7) |
| **Relaxed Timing** (new name) | Coyote and jump buffer 0.25 s; tap/hold threshold 0.5 s; throw charge 1.2 s |
| Lane Guide | Off / Guide / Guide + Magnet (§3.4) |
| Earth-Feel Comfort | §2.6 |
| Camera comfort | Reduce Motion (§4.7), Shake 0–100%, FOV sliders (3P 50–80°, 1P 55–80°), head bob 0–100%, camera distance, vehicle camera Chase / Free Look, Auto-Level |
| Haptics | On/off, intensity 0–100% (default 70%) |
| Colour-blind-safe cues | Reticle states use **shape + pattern + colour**: valid = teal solid outline; lifted / out of reach = dashed outline; Cell full = amber + diagonal hatch + Cell glyph; clean ground = ivory dotted fill. Plot states keep the pattern + colour + icon rule (GDD §13). Throw arc: dotted line + landing ring with a puck glyph |
| No audio-only cues | Every feel cue in §7 has a visual (audio-direction §9 table) |

---

## 7. Juice and feedback catalog

Event names follow the dot-namespaced catalog of module-boundaries §2 (`events/catalog.ts`, owned by contracts-architect). **Existing** = already listed there or in WDS; **proposed** = to be added in the next contract batch. Presentation-only events (marked ◇) are emitted on the client from the predicted sim and never go on the wire. Every camera row obeys §4.6–4.7 caps and Reduce Motion; every rumble uses `dual-rumble` at ≤ 1 effect per 40 ms (newest wins) and is skipped where the browser lacks `vibrationActuator`.

| Event | Status | Audio (audio-direction) | VFX (art-direction) | UI | Camera | Haptic (strong / weak, ms) |
| --- | --- | --- | --- | --- | --- | --- |
| `tool.stroke_contact` ◇ | proposed | Tool core layer, grime/clean timbre (§3.5) | Grains ∝ grams, berm, strip | Cell kg ticks | Micro-kick T3+ | 0–0.10 / 0.10–0.30, 35 |
| `dust.collected` | existing | — | Dust Cell window fill | Gauge eases to server value (300 ms) | — | — |
| `cell.near_full` | proposed | Two-tone at 90% | Suit Cell window blinks | Gauge amber pulse | — | 0 / 0.15, 2 × 30 |
| `cell.full` | proposed | "Clunk" + rattle; tool goes dry | Grains stop; reticle amber hatch | Prompt with sell-point bearing; caption [Dust Cell full] | — | 0.50 / 0.20, 80 |
| `cargo.puck_formed` / `cargo.stack_banded` | proposed | Press click / tape zip + stack thump | Puck pops at the feet | Gauge −1 kg / drains | — | 0 / 0.20, 40 |
| `cargo.picked_up` / `cargo.thrown` | proposed | Grab click / whoosh | Magnet pull trail / arc trail | Carry icon | — | 0 / 0.15, 30 |
| `cargo.pour_started` | proposed | Granular stream, scale ticks | Dust stream into the deck | Pour ring + kg counter | — | 0.08 / 0, continuous |
| `cargo.sold` | existing | Ka-ching motif (per completed pour); scanner blip at Gates | Readout flip-digits | LM tick-up, +LM floater, `lumen-gold` flash | — | 0.30 / 0.10, 60 |
| `plot.opened` | existing (WDS) | Soft sensor blip (suit relay) | Plot outline flashes cyan 0.6 s if the Plot Card is open | Plot Card state | — | — |
| `plot.polished` (Inspector's Stamp) | existing | Stamp thunk + rising chord; pitch +1 semitone per Stamp in a 60 s streak (max +7) | Stamp burst (≈ 64), ivory outline sweep across the plot | "Plot stamped" toast (`spring-pop`), Shine pulses ivory, +LM floater; "Charged" tag for Charge | Trauma 0.10 if credited to you and ≤ 30 m | 0.45 / 0.25, 90 |
| `purchase.completed` | existing | 2-note rise + soft stamp at 0 / 120 ms | Item card glow | Purchase timeline (art-direction §8.7) | — | 0 / 0.20, 40 |
| `purchase.rejected` | proposed | Soft low double buzz | — | 6 px × 3 shake (outline flash with Reduce Motion) | — | — |
| `unlock.granted` | existing | Short stinger in the set key | — | Unlock card (`spring-pop`), DOT line | — | 0.20 / 0.20, 80 |
| `review.passed` (Performance Review) | proposed | Stinger; music gains its sparse Review layer | Every visible Railshot fires a salute | Review overlay (`spring-heavy`), DOT line | — (never forced) | 0.50 / 0.30, 200 |
| `brief.task_completed` / `docket.goal_completed` | proposed | Check chime | — | Checklist row fills, toast | — | 0 / 0.20, 50 |
| `requisition.progress` (25/50/75%) | proposed | Soft ping | — | Next Requisition tick | — | — |
| `robot.deployed` | proposed | Roost clamp click / Albatross take-off call | Wing unfold, first hop | Toast "Roost online" | — | 0 / 0.15, 60 |
| `robot.state_changed` (alerts) | proposed | Amber two-note (radio) | Robot amber state light | State chip + edge chevron; caption | — | — |
| `vehicle.entered` / `vehicle.exited` | existing / proposed | Seat clunk, cab seal hiss; Drive layer on next bar | Suspension bob | Vehicle HUD slides in (`spring-ui`) | 0.35 s blend | 0.20 / 0, 50 |
| `vehicle.airborne` | proposed | Ground conduction fades out in 150 ms | Brush deck lifts (Skiff) | — | Horizon lock | — |
| `vehicle.landed` | proposed | Thump scaled by impact; world returns | Suspension squash, dust ring (2–5 m/s grains) | — | Trauma 0.05 + 0.06/(m/s) above 2, max 0.5 | 0.20–0.70 / 0.20, 60–140 |
| `vehicle.trick_landed` | proposed | Callout stinger (UI bus) | — | Callout (`type-callout`, `spring-pop`); LM on server confirm | — | 0.30 / 0.30, 120 |
| `vehicle.faceplant` | proposed | Crunch + suit bump | Dust burst, auto-right puff | "Faceplant" callout | Trauma 0.7 | 0.80 / 0.40, 250 |
| `vehicle.boost_started` | proposed | Whoosh + whine spike | Intake lifts | Boost meter drains | FOV kick (§4.3) | 0 / 0.15 while boosting |
| `avatar.jumped` / `avatar.landed` ◇ | proposed | Soft suit push (suit channel), world mutes after 150 ms in the air / landing thump | Boot dust ring, prints | — | Landing dip; trauma for heavy | 0.10–0.40 / 0.10, 40–90 (landing) |
| `avatar.hop_burst` | proposed | Valve click + cold-gas hiss | White plume ≤ 0.3 s, ground grains < 2 m | Hop pip empties | FOV +2°, trauma 0.05 | 0 / 0.25, 60 |
| `avatar.ballast_toggled` | proposed | Magnetic clack | Sole tab glows teal | Suit icon | — | 0.30 / 0, 40 |
| `avatar.knocked_back` / `avatar.faceplant` | proposed | Bump + suit thud | Tumble anim, dust | — | Trauma 0.35 / 0.6 | 0.50 / 0.30, 150 |
| `lane.locked` / `lane.unlocked` ◇ | proposed | Two-tone engage / release click | Lane Guide line fades in 150 ms | Holster lock glyph | — | 0 / 0.10, 30 |
| `railshot.fired` | proposed | 2 s coil charge, ground "thoom" | Launch ring, sled streak | "Railshot away" toast | Trauma 0.25 × falloff; FOV −1.5° within 60 m | 0.60 / 0, 300 (within 100 m) |
| `collectible.found` | proposed | Find jingle | Crate glint burst | Toast with reward | — | 0 / 0.20, 60 |

**Stacking rules.** At most one stinger per 0.5 s on the music bus (the higher priority wins: Review > Stamp > trick > purchase); at most 3 toasts (art-direction §8.6); Stamp streak sounds are pitch-stepped, not layered.

---

## 8. Netcode feel

### 8.1 What is predicted locally

| Predicted (shows within 1 render frame) | Server-confirmed only (≤ RTT + 1 tick + 1 frame) |
| --- | --- |
| Own avatar: move, jump, jump cut, coyote/buffer, Touchdown, Hop bursts, Ballast toggle, landing, ladders, collisions with structures | LM, prices, purchases, builds (pending state, netcode §5) |
| Own driven vehicle: throttle, steer, boost, air control, landing, Throttle Lock | Inspector's Stamps, plot states, Shine |
| Own tool: head path, strokes into the predicted ledger overlay, grains, sounds, Cell gauge (WDS §4.4) | Trick **payouts** (callout name is predicted) |
| Camera (purely local, never sent except as yaw/pitch) | Knockback received from vehicles |
| Lane Lock, Lane Guide, Precision Aim | Enter/exit vehicle outcome (animation predicted) |
| Throw arc and puck flight (spawn confirmed by the server) | Pour sale increments |

### 8.2 Correction smoothing (own avatar and vehicle; refines netcode §5)

| Error at reconcile | Action |
| --- | --- |
| < 2 cm | Applied directly, no offset (invisible) |
| 2 cm – 2 m (avatar) / 4 m (vehicle) | Visual offset = old displayed − new predicted, decaying with time constant **50 ms** (avatar; ≈ 95% gone in 150 ms, netcode §5) / **65 ms** (vehicle; ≈ 200 ms), rotation slerped with the same constant |
| > 2 m avatar, > 4 m or > 30° vehicle, or teleport flag (Relay Pad, Outpost Recall, Faceplant auto-right) | Snap; teleports get a 0.2 s fade |
| Knockback flag | New velocity applied as an impulse; position offset decays over 150 ms |
| Vertical error while grounded | Resolved by ground snap (never a visible bob) |

The **camera follows the displayed (smoothed) pose**, plus its own springs, so a correction never jerks the view. The Cell gauge eases to the server value over 300 ms (netcode §5); Hop pips animate over 150 ms when the server count differs.

### 8.3 Remote players

| Item | Rule |
| --- | --- |
| Timeline | Interpolation buffer 150–250 ms, adaptive (netcode §6) |
| Grounded avatars | Linear position, shortest-arc yaw, plus an 80 ms half-life on facing to hide 10 Hz steps |
| **Airborne avatars ★** | When both bracketing snapshots are airborne, interpolate with a quadratic using the known gravity (1.62, or 9.81 with the ballast flag) and finite-difference velocities, so long lunar arcs are smooth curves, not 10 Hz polylines |
| Vehicles | Hermite + slerp (netcode §6); wheels and suspension are re-cast locally on the client against the height function, so remote wheels hug the ground even though only the chassis pose is sent |
| Remote tools | The remote tool-head animation is aligned to their stroke records (stroke tick + interpolation delay), so grains spawn at the head they belong to |
| Remote Hop plumes / boost | From the `hop thrust` / `boost` entity flags (netcode §4.5) |
| Underflow | Extrapolate ≤ 250 ms, then hold; "signal lost" after 1 s (netcode §6) |

### 8.4 Target: "feels local at 120 ms RTT"

| Measure | Target |
| --- | --- |
| Key/button → own avatar visibly responds | ≤ 1 render frame (≤ 17 ms at 60 FPS, ≤ 33 ms on Tier B at 30 FPS), p95 |
| Mouse move → camera rotates | Same frame (0 frames of smoothing) |
| Sweep press → first clean strip, grains and sound | ≤ 1 sim tick + 1 render frame (≤ 67 ms at 60 FPS) |
| Own-avatar correction, netsim 120 ± 30 ms, 1% loss | p95 ≤ 5 cm on flat ground, visible snaps ≤ 1 per 10 min (performance-budgets §7) |
| Own-vehicle correction (same netsim) | p95 ≤ 15 cm and ≤ 2° |
| Mispredicted strokes | ≤ 0.5% of own strokes need a tile rebuild (WDS §4.4) |
| Non-predicted results (LM after pour, purchase confirm) | ≤ RTT + 50 ms + 1 frame, then the tick-up |
| Replay cost per reconcile | ≤ 0.5 ms Tier A / ≤ 1 ms Tier B (performance-budgets §7) |

---

## 9. Tuning workflow

1. **Data first.** Every number marked [tunable] is a key in §10; code reads it through `@moon-cleanup/game-data` (the package scope changes with the lead's title rename). Hot reload in dev.
2. **Feel panel (dev and staging only, `?feel=1`).** Sliders bound to §10 keys, writing a local override JSON; "Export diff" produces the JSON patch for a game-data PR. Never shipped to production builds.
3. **Input recorder.** Record input logs with the contract seed; replay deterministically headless (`packages/sim`) and in the client with a ghost overlay, to A/B two tunable sets on identical input.
4. **Telemetry (dev/staging):** time-to-first-stroke, strokes per minute, idle time between `cell.full` and the next pour or puck, jump / Hop / Touchdown / Lane Lock usage, camera pull-ins per minute, reconcile error histograms, rejected strokes per player (should be 0).
5. **Playtest protocol.** 5 testers × 20 min scripted session (first Stamp, pour, Lane Broom lanes, Hop a crater wall, Skiff jump); 1–7 ratings for control, floatiness, satisfaction, comfort. Ship bar: median ≥ 5.5 on each, no tester reports motion discomfort with default settings.
6. **Change gates.** Pacing-relevant keys (walk/Lope/sweep speeds, jump apex, Hop Δv and recharge, stroke times, widths, vehicle cruise and boost, pour time) need a `tools/balance-sim` run and **balance-reviewer**. Feel-only keys (accelerations, coyote/buffer, camera, shake, haptics, suspension, air control, assists) need the acceptance tests of §11 to stay green.

---

## 10. Tunables (`packages/game-data`)

Rules: E §21 conventions (unit suffix on every key, `schemaVersion: 1`, zod schema in `packages/shared/src/config/<name>.schema.ts` written by contracts-architect). New keys are a schema change: contracts-architect writes the schema, game-designer adds the data. "Pacing" = needs balance-reviewer (§9.6).

### 10.1 `movement.json` (existing keys kept; new keys added)

| Key | Unit | Default | Range | Pacing |
| --- | --- | --- | --- | --- |
| `walkMps` (existing) | m/s | 3.4 | — | yes |
| `lopeMps` (existing) | m/s | 5.0 | — | yes |
| `sweepWalkMps` (existing) | m/s | 2.2 | — | yes |
| `jumpApexM` (existing) | m | 1.6 | 1.2–2.0 | yes |
| `hopBurstMps` (existing) | m/s | 3.0 | 2.0–4.0 | yes |
| `hopRechargeS` (existing) | s | 4.0 | 2.0–6.0 | yes |
| `groundAccelMps2` | m/s² | 18 | 10–30 | no |
| `lopeAccelMps2` | m/s² | 8 | 4–16 | no |
| `groundDecelMps2` | m/s² | 16 | 8–30 | no |
| `groundReverseAccelMps2` | m/s² | 30 | 15–40 | no |
| `facingTurnDegPerS` | °/s | 720 | 360–1,080 | no |
| `analogMinSpeedFrac` / `analogCurveExp` | frac / — | 0.15 / 1.6 | 0–0.3 / 1–2.5 | no |
| `slopeSlowStartDeg` / `slopeWalkMaxDeg` / `slopeUphillMinMult` / `slopeSlideFrictionFrac` | ° / ° / mult / frac | 20 / 42 / 0.5 / 0.4 | — | no |
| `airAccelMps2` / `airBrakeMps2` | m/s² | 2.5 / 4.0 | 1–5 / 2–8 | no |
| `jumpCutVelocityMult` | mult | 0.45 | 0.3–1.0 | no |
| `coyoteS` / `jumpBufferS` | s | 0.15 / 0.15 | 0.05–0.25 | no |
| `touchdownGravityMult` | mult | 2.5 | 1.5–4 | no |
| `fallGravityMult` | mult | 1.0 | 1.0–1.3 | no |
| `groundSnapSweepM` / `groundSnapWalkM` / `groundSnapLopeM` / `groundSnapOffAfterJumpS` | m / m / m / s | 0.40 / 0.30 / 0.15 / 0.2 | 0–0.6 | no |
| `landingSoftMps` / `landingHeavyMps` / `faceplantMps` | m/s | 3.2 / 5.0 / 8.0 | — | no |
| `landingMediumRecoveryS` / `landingHeavyRecoveryS` | s | 0.10 / 0.25 | 0–0.5 | no |
| `landingMediumAccelMult` / `landingHeavyAccelMult` | mult | 0.5 / 0.3 | — | no |
| `faceplantMoveLockS` / `faceplantJumpLockS` | s | 0.8 / 0.5 | 0.4–1.5 | no |
| `hopBurstAngleDeg` | ° from up | 35 | 0–60 | no |
| `hopMaxUpMps` / `hopMaxHorizontalMps` | m/s | 4.5 / 7.0 | — | yes |
| `hopMinIntervalS` | s | 0.25 | 0.1–0.5 | no |
| `hopArrestFall` | bool | true | — | no |
| `hopChainBelowUpMps` | m/s | 0.5 | — | no |
| `ballast.gravityMps2` | m/s² | 9.81 | locked (E §1) | — |
| `ballast.jumpApexM` / `ballast.groundAccelMps2` / `ballast.groundDecelMps2` / `ballast.airAccelMps2` / `ballast.airBrakeMps2` | m, m/s² | 0.45 / 30 / 30 / 6 / 8 | — | no |
| `ballast.coyoteS` / `ballast.hopBurstMult` / `ballast.hopMaxUpMps` / `ballast.blendS` | s / mult / m/s / s | 0.10 / 1.6 / 6.0 / 0.3 | — | no |
| `ballast.landingSoftMps` / `ballast.landingHeavyMps` | m/s | 4 / 7 | — | no |
| `capsuleRadiusM` / `capsuleHeightM` / `eyeHeightM` / `stepUpM` | m | 0.32 / 1.80 / 1.65 / 0.35 | — | no |
| `substepMaxDispM` / `substepsMin` / `substepsMax` | m / int / int | 0.15 / 2 / 8 | — | no |
| `ladderClimbMps` | m/s | 1.6 | — | no |
| `interactRadiusM` / `interactBufferS` | m / s | 2.5 / 0.20 | — | no |
| `throwMinMps` / `throwMaxMps` / `throwChargeS` / `throwPitchDeg` | m/s / m/s / s / ° | 4 / 8 / 0.8 / 30 | — | yes (throw reach) |
| `puckSkidDecelMps2` / `pickupRadiusM` | m/s² / m | 3.0 / 1.5 | — | no |
| `knockback.minRelMps` / `upMps` / `normalMult` / `maxMps` / `tumbleS` / `pairCooldownS` | m/s, mult, s | 1.5 / 2.5 / 1.2 / 9.0 / 0.6 / 2.0 | — | no |
| `holsterSwapS` | s | 0.35 | 0.2–0.6 | yes (minor) |
| `vehicleEnterS` / `vehicleExitHoldS` / `vehicleExitMaxMps` | s / s / m/s | 0.45 / 0.4 / 2.0 | — | no |

Bonus percentages (Cadence, Loft, Second Wind, Lope Training, Brushwork, Strong Arm, Railhand) stay in `promotions-board.json`, `meta.json` and `suit-gear.json` (Hop burst counts per level live in `suit-gear.json` effects).

### 10.2 `tool-feel.json` (new; keyed by tool id from `tools.json`)

| Key | Unit | Default |
| --- | --- | --- |
| `contactFrac` | frac of stroke | 0.70 |
| `strokeLengthM{toolId}` | m | desk_duster 0.45 · crescent_squeegee 0.54 · bristle_broom 0.67 · lane_broom 0.87 · static_rake 0.85 · ion_curtain 0.94 |
| `bootClearanceM` | m | 0.45 (aimMin = L + this) |
| `aimPitchFarDeg` / `aimPitchNearDeg` | ° | −20 / −55 |
| `fixedAimReachFrac` | frac | 0.80 |
| `headSpeedLiftMps` / `headSpeedResumeMps` | m/s | 5.5 / 5.0 |
| `sweepFacingTurnDegPerS` | °/s | 540 |
| `detailingIntervalS` / `detailingMoveMult` | s / mult | 0.45 / 0.3 |
| `flickMaxFeetHeightM` | m | 1.2 |
| `precisionAimSensMult` / `precisionAimBoomDeltaM` | mult / m | 0.5 / −0.6 |
| `laneGuide.snapAngleDeg` / `captureWidthMult` / `overlapFrac` / `magnetMps` / `magnetWindowWidthMult` / `historyS` | °, mult, frac, m/s, mult, s | 12 / 1.5 / 0.10 / 0.25 / 0.5 / 30 |
| `formPuckHoldS` / `bandPerStackS` | s | 0.30 / 0.15 |
| `pourBaseS` | s | 6.0 (same value as E §22.2; one source: read from `logistics.json` if it moves there) |
| `pourCreditIntervalS` | s | 0.5 |
| `cellNearFullFrac` | frac | 0.90 |
| `microKickM{tier}` / `microKickHalfLifeS` | m / s | T1–T2 0 · T3–T4 0.015 · T5–T6 0.025 / 0.06 |

### 10.3 `camera.json` (new)

| Key | Unit | Default |
| --- | --- | --- |
| `thirdPerson.vfovDeg` / `vfovMinDeg` / `vfovMaxDeg` | ° | 60 / 50 / 80 |
| `thirdPerson.pivotHeightM` / `shoulderOffsetM` / `shoulderOffsetSweepM` | m | 1.45 / 0.30 / 0.15 |
| `thirdPerson.boomByPitch` | [pitch °, boom m] | [[30, 3.6], [0, 4.4], [−18, 4.2], [−45, 3.8], [−70, 3.2]] |
| `thirdPerson.pitchDefaultDeg` / `pitchMinDeg` / `pitchMaxDeg` | ° | −18 / −70 / 30 |
| `upHalfLifeS` | s | 0.12 |
| `followHalfLifeS.horizontal` / `.verticalGrounded` / `.verticalAirborne` | s | 0.04 / 0.08 / 0.22 |
| `lookAheadS` / `lookAheadMaxM` / `lookAheadHalfLifeS` | s / m / s | 0.12 / 0.6 / 0.3 |
| `airFraming.minHeightM` / `maxPitchDeg` / `rateDegPerS` / `suppressAfterLookS` | m, °, °/s, s | 3 / 10 / 20 / 0.5 |
| `landingDip.mPerMps` / `maxM` / `halfLifeS` | m/(m/s), m, s | 0.03 / 0.25 / 0.12 |
| `collision.probeRadiusM` / `releaseHalfLifeS` / `minBoomM` / `ditherBelowM` / `groundClearanceM` | m / s | 0.25 / 0.20 / 0.9 / 1.2 / 0.35 |
| `mouse.degPerCount` | °/count | 0.07 |
| `firstPerson.vfovDeg` / `eyeHeightM` / `bobMaxM` / `transitionS` | °, m, m, s | 65 / 1.65 / 0.02 / 0.30 |
| `vehicles{id}.boomM` / `pivotHeightM` / `pitchDefaultDeg` / `vfovDeg` / `boostFovDeg` / `lookAheadS` / `lookAheadMaxM` / `followHalfLifeS` / `chaseDelayS` / `chaseRateDegPerS` | as §4.3 | §4.3 table |
| `vehicles.speedFovDegPerMps` / `speedFovStartMps` / `speedFovMaxDeg` / `blendS` / `wheelZoomFrac` | | 0.4 / 5 / 5 / 0.35 / 0.3 |
| `fovOffsetMaxDeg` / `fovOffsetMinDeg` | ° | 10 / −2 |
| `globe.openS` / `closeS` / `altitudeM` / `vfovDeg` / `minDistM` / `maxDistM` / `dragDegPerPx` / `inertiaHalfLifeS` / `zoomStep` | | 1.1 / 0.8 / 6,000 / 35 / 3,000 / 12,000 / 0.25 / 0.18 / 1.15 |
| `photo.radiusM` / `minClearanceM` / `speedMps` / `fastMps` / `slowMps` / `vfovMinDeg` / `vfovMaxDeg` / `rollMaxDeg` / `idleExitS` | | 30 / 0.3 / 3 / 9 / 0.6 / 15 / 90 / 45 / 300 |

### 10.4 `vehicle-handling.json` (new; keyed by vehicle id; economy stats stay in `vehicles.json`)

Per vehicle: `massKg`, `probes[{mountM: [x, y, z]}]`, `restLengthM`, `travelM`, `wheelRadiusM`, `springHz`, `dampingRatio`, `accelMps2`, `brakeMps2`, `coastMps2`, `reverseMaxMps`, `turnRateDegPerS`, `turnInPlaceDegPerS`, `lateralAccelMaxMps2`, `lateralGripPerS`, `handbrakeGripMult` (0.35), `handbrakeLateralMult` (1.6), `intakeDownforceMps2`, `airControlMult`, `bodyObbM` — defaults in §5.2. Shared: `substeps` (4), `airPitchAccelDegPerS2` (240), `airPitchMaxDegPerS` (200), `airRollMaxDegPerS` (220), `airAngularDampingPerS` (0.3), `autoLevel{idleS: 0.4, levelDegPerS: 90}`, `airborneMinS` (0.2), `boost{meterS: 4.0, regenDelayS: 1.0, regenPerS: 0.5}`, `steepTractionStartDeg` (20), `steepTractionEndDeg` (25), `steepSlideFrictionFrac` (0.2), `faceplant{maxTiltDeg: 60, rightingDelayS: 2.0, rightingS: 0.8}`, `tricks{hangTimeS: 2.0, hangTimeMinApexM: 0.5, moonshotS: 4.0, moonshotApexM: 8, rotationDeg: 330, landWindowS: 0.15}`, `secondWindTripSpeedMult` (1.053), `vehicleVsVehicle{privateSolid: true, pushMaxMps: 3}`. Pacing: cruise/boost live in `vehicles.json` (pacing); everything here is feel-only except `secondWindTripSpeedMult` (pacing).

### 10.5 `feedback.json` (new; client-only presentation)

`trauma{maxTransM: 0.06, maxRotDeg: 1.2, decayPerS: 1.6, cap: 0.8, perSecondCap: 0.9, continuousFloorMax: 0.15, noiseHz: 16, firstPersonMult: 0.3}`, `trauma.sources{id: value}` (§4.7 table), `fovKicks{id: {deg, inS, outS}}` (§4.6), `haptics{minIntervalS: 0.04, defaultIntensityFrac: 0.7, events{eventId: {strong, weak, durationMs}}}` (§7), `stamp.streakWindowS` (60), `stamp.streakMaxSemitones` (7), `stingerMinGapS` (0.5), `userDefaults{shakeFrac: 0.7}`.

### 10.6 `input.json` and `input-bindings.json` (new)

`input.json`: `holdThresholdS` (0.30), `relaxed{coyoteS: 0.25, jumpBufferS: 0.25, holdThresholdS: 0.5, throwChargeS: 1.2}`, `gamepad{moveDeadzoneInner: 0.12, moveDeadzoneOuter: 0.95, lookDeadzoneInner: 0.10, lookDeadzoneOuter: 0.97, lookExp: 2.0, lookYawDegPerS: 240, lookPitchDegPerS: 160, lookAccel{afterS: 0.25, boostFrac: 0.3, rampS: 0.3}, sweepLookMult: 0.7, triggerPress: 0.15, triggerRelease: 0.10, deviceSwitchDeflection: 0.25, deviceSwitchS: 0.1, lopeToggleClearS: 0.5}`, `mouse{degPerCountDefault: 0.07, min: 0.01, max: 0.5}`, `vehicleExitHoldS` (0.4), `recallHoldS` (5, E §2). `input-bindings.json`: `contexts[{id, actions[{actionId, kbm[2], gamepad[2], type: press|hold|toggle|tap-hold, rebindable}]}]` with the §6.2–6.3 defaults.

---

## 11. Acceptance tests (measurable)

Sim tests run headless in `packages/sim` (Vitest, fixed tick); client tests in Playwright with frame timestamps; netsim tests via `/bot-test` conditions (120 ± 30 ms, 1% loss).

| ID | Test | Pass bar |
| --- | --- | --- |
| GF-01 | Time to max speed, flat ground, every Cadence level | Walk 0.19 s, Lope 0.39 s, ± 1 tick; equal at every Cadence level |
| GF-02 | Stop distance from Lope / walk | 0.78 m / 0.36 m ± 0.05 m; stop time ≤ 0.31 s |
| GF-03 | Jump apex and air time (lunar, Loft 0/I/II, Ballast) | 1.60 / 1.92 / 2.24 / 0.45 m ± 0.02 m; air 2.81 s ± 1 tick (lunar, flat) |
| GF-04 | Jump cut on the first tick | Apex 0.35–0.45 m |
| GF-05 | Coyote and buffer | Jump 0.15 s after walking off an edge succeeds, 0.20 s fails; Jump 0.15 s before landing fires on the landing tick, 0.20 s does not |
| GF-06 | Hop Pack | Burst counts 0/2/3/4 (+1 Second Wind); recharge 4.0 s / 2.67 s grounded; a burst while falling always gains height; upward speed never > 4.5 m/s after a burst |
| GF-07 | Touchdown | Landing from a 1.6 m apex 0.89 s ± 1 tick after apex; never Faceplants |
| GF-08 | Speed invariant (property test, 10,000 random input logs over random terrain) | Horizontal speed ≤ state cap × 1.01 on the ground; never below ground − 0.05 m; never inside a structure OBB after a tick |
| GF-09 | Ground snap | Sweeping across a 2 m-radius crater rim at 2.96 m/s never goes airborne; loping across it may |
| GF-10 | Slope | Uphill speed ×0.5 at 42°; slides above 42° |
| GF-11 | Pole crossing (sim) | Walking straight over the north pole with constant input: heading deviation < 1° on the far side; no yaw jump on `yawFrame` switches |
| GF-12 | Stroke coverage | Each tool at its maximum sweep-walk on flat Highland for 60 s: ledger shows a gap-free strip of width × distance (± 1 texel at edges) and grams within ± 5% of width × speed × 0.310 kg/m² × 60 s |
| GF-13 | Head-speed lift | Over 1,000 random honest input logs, the server rejects 0 strokes for head speed (WDS check 4) |
| GF-14 | Lane Lock bonus | Lane Broom locked sweep-walk = 2.2 × 1.15 m/s ± 1%; unlocked = 2.2 |
| GF-15 | Area-rate parity with E §4 | Bot sweeping lanes with Lane Guide on a Highland plot: time to Polished within ± 20% of E §4 (WDS V3 bar) |
| GF-16 | Pour | Full-Cell pour 6.0 s (Quick Pour III 2.4 s, + Smooth Handoff 1.2 s) ± 1 tick; LM credited in 0.5 s increments |
| GF-17 | Throw | 8 m/s throw lands 34.2 m ± 0.5 m on flat ground |
| GF-20 | Input latency, own avatar (Playwright, 60 FPS Tier A) | Keydown → first frame with changed avatar transform: ≤ 1 frame p95; Tier B (30 FPS): ≤ 1 frame |
| GF-21 | Mouse look latency | Pointer event → camera change in the same frame, 100% of samples |
| GF-22 | Sweep latency | Sweep press → first predicted clean strip + grain emission + audio start ≤ 67 ms p95 at 60 FPS |
| GF-23 | Frame-rate independence | Scripted camera path at 30 / 60 / 144 FPS: rig pose differs ≤ 1 cm / 0.2° |
| GF-24 | Camera over the pole | Walking over Outpost Boreal: camera forward angular speed without look input < 2°/s; no roll |
| GF-25 | Camera never in terrain | 10-min bot camera path over crater fields: camera always ≥ H + 0.2 m and outside structure colliders |
| GF-26 | Shake caps | Trauma never > 0.8; FOV offset within +10° / −2° under a stress script (Railshot + landing + Faceplant at once) |
| GF-27 | Reduce Motion | With Reduce Motion: zero shake, kick, dip, bob and air-framing displacement (exact 0) |
| GF-28 | Vehicle top speed and acceleration | Cruise ± 2% for all five; 0 → cruise within ± 0.1 s of §5.2; turn radius at cruise ± 10% |
| GF-29 | Suspension settle | 1 m drop on flat ground: settles to ±1 cm within 1.5 s with ≤ 2 visible rebounds > 1 cm for every vehicle (VT-M2-04) |
| GF-30 | Every-second checklist C1–C8 (Playwright + capture) | A 60 s Desk Duster and Ion Curtain session: every 1 s window has ≥ 1 stroke sound, ≥ 20 grains ≥ 2 px (VT-M1-16b), a Cell readout change; C8 prompt within 1 frame of Cell full |
| GF-31 | Vehicle air | Skiff off the reference 30° ramp at 8 m/s: air 4.9 s ± 0.2 s; Auto-Level levels within 1.5 s |
| GF-32 | Trick detection | Unit cases: 2.0 s air → Hang Time; 4.0 s → Moonshot!; 330° pitch → Lunar Loop; 330° roll → Corkscrew; 61° tilt at contact → Faceplant voids; combo ×1.5; caps per E §2 |
| GF-33 | Knockback | Off / Open: no contact effect. On: ≥ 1.5 m/s launches ≤ 9 m/s; same pair not hit twice within 2.0 s |
| GF-34 | Enter / exit | At 120 ms RTT the driving control goes live by the end of the 0.45 s animation in ≥ 99% of trials; exit above 2 m/s brakes then exits |
| GF-35 | Prediction (netsim 120 ± 30 ms, 1% loss, 10 min, 16 bots) | Own avatar correction p95 ≤ 5 cm, snaps ≤ 1 per 10 min; vehicle p95 ≤ 15 cm / 2°; 0 double-applied inputs |
| GF-36 | Remote airborne smoothness | Remote avatar jump arc: max deviation from the true ballistic path ≤ 5 cm (vs ≥ 20 cm for linear interpolation) |
| GF-37 | Server cost | Movement + vehicles ≤ 0.4 ms per tick p95 with 16 avatars and 4 driven vehicles |
| GF-38 | Device switching | Idle gamepad with ±0.2 stick drift: zero movement while KBM is used (stuck-W regression) |
| GF-39 | Pointer lock | One Esc in Play = unlocked + pause menu in the same frame; closing a panel with E re-locks; with Esc shows "Click to resume" |
| GF-40 | Playtest (§9.5) | Median ≥ 5.5 / 7 on control, floatiness, satisfaction, comfort |

---

## 12. Open questions

| # | Question | Default used here | Decider |
| --- | --- | --- | --- |
| Q1 | Does **Earth-Feel Comfort** grant Earth-feel before the shift buys Ballast Soles? | Yes (feel only, no economic effect) | game-designer |
| Q2 | How does Second Wind's "vehicle trip time −5%" show up in real driving? | Cruise ×1.053 while the payload is full and always on the Carryall | game-designer + balance-reviewer |
| Q3 | Private-shift Knockback default | Off (ghost); Holder can turn it on | Cee |
| Q4 | INPUT widening (§6.8) and Self feel timers | Proposed for the next contract batch | contracts-architect + netcode-engineer |
| Q5 | Partial-step presentation (§2.10) vs plain interpolation | Partial step, with the debug toggle to compare | gameplay-systems-engineer (measure GF-20/GF-35) |
| Q6 | On-foot Faceplant threshold: animation-spec §4.2 plays `land.stumble` (the Faceplant) above **5.0 m/s** (≥ 7.7 m falls); this doc sets the sim Faceplant at **8.0 m/s** (≥ 19.7 m), because two Hop bursts already reach 6–9 m and a Hop landing should not lock input. Landings of 5.0–8.0 m/s play `land.hard` | **Resolved 2026-11-12:** sim value 8.0 m/s (canonical here); animation reads `movement.faceplantMps` instead of its own constant | game-designer + animation-engineer |
| Q7 | Stale names in other docs: netcode §4.1/§4.4 and security.md use "Ballast Soles", `sprint`, `plotScan`; audio-direction and art-direction use "Ballast Soles", "Crescent Squeegee", "Plot Card (G)", "Throttle Lock", "Cargo Expander", "Running Lamps", "Tile Sinterer" | This doc uses naming-bible v2 names | docs-keeper (`/update-docs`) |
