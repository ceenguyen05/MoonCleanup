# Planning review: Technical Art Director

Scope: visual plan for Moon Custodians (three r187 WebGPURenderer + TSL, WebGL2 fallback). Read: `design/visual-target.md` (VT), `design/art-direction.md` (AD), `architecture/rendering-pipeline.md` (RP), `architecture/world-and-dust-simulation.md` (WDS §7), `architecture/performance-budgets.md` (PB), `research/visual-analysis.md`, `milestones/M0-foundation.md`, `milestones/M1-mvp.md`, plus `OPEN_QUESTIONS.md` Q21 and `.claude/commands/visual-check.md`. Nothing else was edited.

## Verdict

**Conditional pass. The vision is right and the measurable-check culture is unusually strong, but the plan is not yet buildable as written.**

- **Tier A (RTX 4060 Laptop, High):** achievable. Budgets are conservative and the look direction is distinct from Moon Sweepers.
- **Tier B and WebGL2:** unproven. The Tier B numbers are halved features, not measured costs (Q21: "Tier A x 0.35, unverified"). Raw GPU throughput of Iris Xe versus a 4060 Laptop is roughly 5-7x, while the budget gives Tier B only about 2x the frame time at about 0.7x the pixels. Tier B needs a materially leaner shader and shadow path than Tier A. Nothing in M0 proves that.
- **Doc set:** it contradicts itself on numbers that gate V1 checks (F1, F2). Several V1 checks as written cannot be met by the documented specs (F1, F5, F11).
- **Schedule:** the look is landed late relative to the "first playable must already look good" intent (F3, F16).
- **Biggest hidden risk:** no one in the agent roster can produce the 3D character, hardware and vehicles the look depends on (F4). "Cheap browser game" is most likely to come from there, not from the terrain.

Fix F1-F4 before M0-S5 launches. The rest can be absorbed into M0-W3 and the M1 wave briefs.

Counts: 4 BLOCKER, 17 MAJOR, 9 MINOR (30 total).

---

## BLOCKER

### F1. Clean-vs-grime albedo spec contradicts the luma targets
- **Where:** AD §2.4 D-02 and §3.2 (grime 0.085-0.10, clean 0.30-0.38, about 4x); WDS §7.7 and RP §7 (grime 0.09, clean 0.22, about 2.4x); RP §1 and §19 ("2.4x", "ratio >= 1.8"); VT VT-M0-08 / VT-M1-03 (sRGB luma ratio >= 1.9, with 70-105 versus 170-215).
- **Problem:** the VT ratio is measured on 8-bit sRGB luma. A 1.9x code-value ratio needs about 1.9^2.2 = 4.1x in linear albedo, which matches AD but not WDS/RP. At 2.4x linear the displayed ratio is about 1.5 before AgX highlight compression, so VT-M0-08 fails by construction. An implementer who follows WDS/RP (the shader owner) will ship a mask that reads as "slightly different gray", which is exactly the pillar-P1 failure.
- **Fix:** make AD §3.2 the single source (grime about 0.085, clean about 0.34, about 4x). Strike the 0.22 and 2.4x figures from WDS §7.7 and RP §1/§7. State every ratio explicitly as "sRGB luma after tone mapping". Add the linear-to-display conversion to the VT-M0-06 chart note. M0-W3-T04 should calibrate with AgX on, since AgX compresses the top of the range.

### F2. Quality-preset numbers conflict across four documents
- **Where:** VT §2.2, RP §5.2/§14, PB §1/§3/§4, WDS §7.2/§7.5.
- **Problem:** the VT checks cite VT numbers while implementers read RP/PB. Examples:
  - Medium cascades: VT 2x2048², RP 3x1024², PB "B 2x1024²".
  - Ultra cascades: VT 4x4096² and 400 m, RP 4x2048² and 300 m.
  - Cascade-0 extent at Medium: VT 16 m, RP ends at 10 m.
  - Medium dust ring: VT 2048² @ 3 cm, RP 1024² @ 3.5 cm, PB 1024².
  - Dynamic-resolution range, Medium: VT 0.67-0.75, RP 0.60-0.85, PB B 0.5-0.75.
  - Particles, Medium/High/Ultra: VT 12k/60k/150k, RP 20k/50k/100k.
  - Draws: VT 600 on every preset, PB/RP 350 on Tier B.
  - Triangles: VT 2 M Medium, PB 1.5 M Tier B.
  - Texture pool, High: VT 2 GB, RP 1.5 GB.
  - AO on Low: VT "baked/vertex only", RP half-res GTAO.
  - Crown Lamp shadow: AD "local player, High/Ultra only", RP shadow map on every preset.
  - Backend tier naming: VT calls WebGL2 "G2", RP calls WebGPU-compat "G2" and WebGL2 "G3".
- **Fix:** `shared/render/quality.ts` becomes the only numeric source. Generate the VT §2.2 table from it, or delete the duplicated numbers from VT/RP/PB and link to the file. Until then, add a one-time reconciliation task for docs-keeper and technical-artist before M0-S5. Rename tiers so "G2/G3" and "A/B/C" cannot be confused.

### F3. The M0 render spike cannot validate Tier B, and Tier B hardware is not secured
- **Where:** M0 §3 and M0-W2-T02 (bench scene), M0-W3-T02 vs T03/T04 (all in S7/S8), M0 §8 note 3, `OPEN_QUESTIONS.md` Q21, PB §10.
- **Problem:**
  1. The bench uses a "chunked sphere-terrain stand-in". The real terrain pass is the largest GPU line (7.0 ms of 28 ms on B) and includes stochastic detail sampling, plot-ID cube lookup plus 7 dot products, ring and atlas taps, 4-tap berm normals, noise octaves and sparkle. None of it is in the bench.
  2. The look-dev (W3-T03/T04) lands in the same stage as the capture (W3-T02), so ADR-0003 (keep three, or run the Babylon contest) is decided on data that excludes the real shaders.
  3. Tier B hardware is "confirm if available"; the fallback is the 4060 laptop's iGPU forced through Windows power-saving, and the verdict is then "provisional". That iGPU may be Intel UHD (slower than Iris Xe) or a 780M, and thermals and shared-memory behaviour differ.
- **Fix:**
  - Make a real iGPU device an owner gate (G1), not a note.
  - Add a worst-case terrain-shader stub to the M0-W2-T02 bench with the full fetch and ALU count from WDS §7.7 and RP §7. Include 3 detail layers, plot lookup, ring plus atlas, and sparkle.
  - Add a second capture after W3-T04 and gate ADR-0003 on that run, not the stand-in run.
  - Pre-declare the Tier B fallback ladder if the 7 ms terrain line fails: drop to 2 detail layers, screen-derivative normals, and a 0.5 scale floor.

### F4. No production path for original 3D art (character, tools, hardware, vehicles, robots)
- **Where:** AD §11 ("own original work: preferred", Mixamo/Quaternius never shipped, CMU mocap needs a human decision), AD §9 (18k-tri rigged custodian, 5 vehicles, 3 robots, 250k-tri outpost), M1-W5-T03, W6-T05, W7-T02. The only mention of Blender is in a tooling research table.
- **Problem:** the technical-artist agent has no DCC tool, modeller, sculptor or texture painter. The plan assumes agents will deliver human-proportioned, rigged, LODed, KTX2-textured assets, one task per wave, with liveries, decals and player-color masks. The realistic outcome is primitive-assembled shapes (capsules and boxes), which is the "cheap browser game" failure on the hero asset. The animation sources are equally open: Mixamo is prototype-only and CMU is unconfirmed.
- **Fix:** decide this now as an ADR. Options:
  - A scripted procedural-modelling pipeline (headless Blender Python, with a licensing-clean toolchain and a defined polish bar).
  - A commissioned or purchased CC0/commercial base mesh for the custodian, vehicles and outpost kit, with the budget stated.
  - A "placeholder quality bar" so blockout assets are explicitly not judged by VT-M1-18/21 until replaced.
- Add an asset-quality VT: a turntable at 1080p, with the silhouette read at 32 px already specified (VT-M1-18).
- Schedule the character and hero hardware for M1-W3-W4, not W5-W6 (see F16).

---

## MAJOR

### F5. Shadow-edge acceptance cannot be met by the specified cascades or filter, and is only tested at 60 deg
- **Where:** VT-M0-04 (penumbra 10-90% <= 3 px High at 3 m), VT-M1-07 (<= 4 px at 4 m), RP §5.2 (cascade-0 texel 1.0 cm, PCF 2 texels), RP §19 ("<= 2 cm at 1 m occluder").
- **Problem:**
  - At 3 m, 1 px is about 3.2 mm (16.3 px/deg). Three pixels is about 1 cm, which is already the physical penumbra for a 1 m occluder (9 mm/m).
  - A 1.0 cm cascade texel with 2-texel PCF gives 2-4 cm of blur, about 6-12 px. High fails its own VT.
  - RP §19 states a different threshold (2 cm).
  - The test is at 60 deg sun, but the hero moment (VM-01) is at 4 deg, where acne, peter-panning and terrain self-shadowing are worst. No acne or contact-gap check exists at grazing angles.
- **Fix:**
  - Define one threshold from physics (physical penumbra plus 1.5 texels) and derive pass bars from it. Realistic High pass bar: about 6-8 px at 3 m, not 3.
  - Add VT items at sun 4 deg and 1 deg: no acne on terrain or boots, contact gap <= 1 cm, on terrain and a rock. Run them in M0-W3, not M1.
  - Specify where along the shadow the edge is measured (tip versus base), and the measurement tool.

### F6. The ground-bounce hemisphere light cannot give the required shadow fill
- **Where:** AD §2.1 and RP §5.1 ("HemisphereLight, sky colour black, ground colour warm grey"), VT-M1-09 (shadowed up-facing clean ground >= 15% of sunlit).
- **Problem:** a hemisphere light lerps by normal direction. With sky black and ground warm grey, up-facing normals (flat ground, tops of rocks, hardware roofs) receive zero fill; only undersides and half of vertical faces do. The 15% shadow-lift target is unreachable through this light. GTAO then darkens it further.
- **Fix:** model ground bounce as an ambient term whose colour is the warm-grey bounce, scaled by sun elevation and cosine of the slope, with sky-facing occlusion by GTAO. Or use hemisphere sky = warm grey and ground = darker warm grey. Test it in M0-W3 with VT-M1-09 on flat ground, a slope facing away from the sun, and a vertical wall.

### F7. No environment lighting or reflection plan for metals, glass and visors
- **Where:** AD §5.1 (`pbr-steel` metal 1.0, smoked glass, bronze reflective visor, Brushed finish), RP §7. No IBL, probe or PMREM plan exists (only a risk note).
- **Problem:** with a black sky, fully metallic surfaces and mirror-like visors reflect nothing and render near-black or flat. The hopper windows, the visor "Fresnel" and the Glow/Brushed finishes are core to the "premium hardware" read and look broken without a reflection source.
- **Fix:** specify a small procedural environment probe (warm-grey ground hemisphere, black sky, sun disk, Earth disk), re-rendered at TOD changes only. Budget its cost per preset and exclude it from the "no fog or haze" rule. Add a VT check: metal sample sphere and visor at noon, dawn and night, with luma targets. Verify the r187 PMREM change (cube render targets) in M0.

### F8. Night lighting is partly shadowless
- **Where:** AD §2.1 (Earthshine "no disk shadows", Ultra only; local-player-only lamp shadows), RP §5.1/§5.3.
- **Problem:**
  - Night (VM-06, the "showcase") has a blue-white key light with no shadows on High, so the world is flat apart from AO.
  - Every other custodian's lamp (up to 15) is unshadowed. Their light passes through rocks and hardware and reads as floating glow, a typical cheap tell.
  - The 300-lux Earthshine over a 1:386 ratio (AD) versus 0.15/10 = 1:67 (RP) is also unresolved.
- **Fix:**
  - At night near side, the sun's CSM budget is free. Reuse the same `CSMShadowNode`, swapping in Earth's direction (soft 2.4 deg penumbra via radius). That is zero additional cost and gives crisp blue-white earthlit shadows.
  - For other players' lamps, either shadow the nearest 1-2 via a low-res lamp-shadow atlas, or hard-limit unshadowed lamp range (about 6-8 m) and fade it, so the light never crosses large occluders.
  - Add VT checks for hard shadows at night, and lamp light not leaking through a 1 m rock.

### F9. Horizon-shadow handoff is a V1 item but nothing in M0 proves it
- **Where:** VT-M1-08 (V1: "long shadows unbroken to CSM max distance, then the horizon-shadow map continues them with no visible handoff"), RP §5.2 (far terrain shadow: 1024², 1.5 km, about 1.5 m/texel, combined with CSM by min), M1-W2-T02. M0-W3-T03 has only CSM.
- **Problem:** three r187 `CSMShadowNode` does not expose a "min with a custom depth map" hook; it needs a custom shadow or lighting node. A 1.5 m texel next to a 15 cm cascade edge is a 10x sharpness step, so a visible handoff is likely. Medium and Low have no far map at all, so shadows simply stop at 80-120 m on Tier B, in the beauty hour.
- **Fix:**
  - Spike this in M0-W3 (a ray-marched horizon term at 1 Hz, or a stable orthographic height map).
  - Define a measurable handoff: edge-width ratio <= 2x across the seam, no luma step > 8.
  - Decide what Tier B does beyond CSM range (a cheap analytic ray-marched term, or a gradual fade to the fill). Do not leave it as "off".

### F10. Dust layer thinning (partial removal) is not specified or tested
- **Where:** WDS §7.7 (coverage = smoothstep(0.5-w, 0.5+w, R + 0.35(n-0.5)), w >= 0.02), VT §4 (no item), AD §3.1 (G "unpolish").
- **Problem:** the coverage function is nearly binary. Intermediate R reads as noisy salt-and-pepper, not a layer that thins. Whisk and multi-pass tools remove partial dust per pass, and "more passes = shinier" rides on G. No VT checks that 25/50/75% remaining reads as a smooth, plausible dim-to-bright progression, or that the visible state matches the server ledger and the Polished threshold (WDS §12 #9 admits the 0.8 m ledger versus the 12 cm tool).
- **Fix:**
  - Add a progressive-removal shader term (albedo blend plus reduced roughness, plus the berm height scaling with R) so R maps to a monotonic luma ramp.
  - Add VT items: for passes 0-4 with c = 0.25 each, luma is monotonic with step >= 8, and no speckle at 3 m (variance bound).
  - Add VT items: visual grime coverage versus ledger/Shine within X%, and a Polished plot has no visible leftover islands larger than 0.5 m².

### F11. Stroke edge: spec conflicts, ring-to-atlas handoff unchecked, sub-texel width unaddressed
- **Where:** AD §3.3 (edge <= 3 cm world, 1 cm noise), VT §2.2 (<= 4-6 px at 3 m, about 1.3-2 cm), VT-M1-05 (25 m ladder), WDS §7.5 (ring 2.0-4.0 cm texel, about 20-25 m radius), §7.2 (atlas 20-40 cm texel).
- **Problem:**
  - 3 cm world is about 9 px at 3 m, so AD and VT disagree.
  - Ring texel (2.5 cm) is larger than the VT edge; only the shader's gradient reconstruction reaches it.
  - Beyond the ring, a 12 cm Desk Duster stroke is smaller than one atlas texel (20-40 cm). It will broaden or break up, at about 4 px width at 18 m.
  - The 25 m ladder shot straddles the ring boundary. No check exists for a crisp stroke crossing the ring edge (a width or berm step), which is the likely V1 failure. It appears only as a motion-path note (P2) and in VT-M3-08, which is V3.
  - Berm checks say "visible as a light/dark pair" with no luma delta or pixel width threshold.
- **Fix:**
  - Reconcile edge width to one number (recommend <= 2 cm world, at the 1-texel-reconstruction floor).
  - Add a V1 item: for a stroke crossing the ring edge on P2, width change <= 1 px, berm luma delta change <= 20%.
  - Add numeric berm criteria (for example, delta >= 12 luma, line-pair width >= 2 px at the preset distance).
  - Decide how sub-texel strokes are stored in the atlas (an SDF channel, or promoting recently stroked plots to a finer tile), and test it with the 12 cm brush at 20 m.

### F12. Lane stripes (VM-05, "signature look") are not supported by the data model
- **Where:** AD §3.4 and §12 item 2 ("ship stripes on High/Ultra only from the detail ring"), WDS §7.2 (atlas channels have no stroke direction), VM-05 / S04 (elevated 12 m), VT-M1-06 (V2, Tier A).
- **Problem:** the ring covers about 20-25 m radius and the stripe fades at 60 m. The atlas has no direction channel. The VM-05 elevated view of a shift-cleaned plot therefore shows stripes only for the nearest part, on one preset. Anything the camera has not recently been near has none. This is an MVP "must nail" moment relying on an open item.
- **Fix:** decide in M0-W3 or M1-W1 whether the atlas gets a direction channel (8-bit quantised angle, plot-tile B, cost about 25% more atlas memory). If not, demote VM-05's stripe claim and redefine the moment as "tonal polish bands from the G channel". Update the contest rubric (WDS §10) to include it.

### F13. Footprints: texel too coarse for tread, and four lifetime rules conflict
- **Where:** AD §3.5, WDS §7.6, RP §14, VT-M1-15, VT-M3-08.
- **Problem:**
  - The boot print is 30 x 12 cm, which is 12 x 5 texels at 2.5 cm (7 x 3 at 4 cm on Low). Chevron tread (1-2 cm lugs) cannot be resolved, so "tread pattern visible at <= 3 m" fails on all presets.
  - Lifetimes: ring fade 60/120/300/600 s globally (WDS), "until it leaves the ring" on grime (AD), clean-ground prints fade in 30 s (AD/VT), baked trampled detail (VT-M3-08).
  - A multiplicative fade once per second on an 8-bit channel stalls at low values (for example 50 x 0.99 rounds back to 50) and prints never vanish.
- **Fix:**
  - Render the tread as a normal-map stamp (a small tileable chevron normal blended by the A mask) so detail is independent of ring texel size.
  - Use a per-channel lifetime scheme (grime prints and clean-ground prints in separate channels).
  - Use subtractive fade with stochastic rounding, or store spawn time in a 16-bit channel.
  - Rewrite VT-M1-15 with a measurable threshold (tread edge contrast >= X at 3 m on all presets).

### F14. Low-g particle readability is unmeasured; the feel risk is the opposite of the reference
- **Where:** AD §3.6 (grime-colored grains, 1-3 px, 0.5-1.5 m/s, no clouds), RP §11 (bright grey grains, 1-4 cm), VT-M1-16/17, PB.
- **Problem:**
  - Moon Sweepers' chunky pebbles read instantly in screenshots and GIFs. 1-3 px grains with a 0.15-1.4 m range, 0.4-1.3 s lifetime and "vanish on landing" may read as nothing at all, especially upscaled on Tier B. Pillar P3 ("every stroke shows") is only checked by a peak particle count (VT-M1-17).
  - Grain colour is specified two ways (grime-colored versus bright grey).
  - The apex-time check (+-15%) from a 60 FPS video of 1-3 px grains is not practical.
  - The WebGL2 CPU pool (2-6k) cannot reproduce "the same art" on Rake/Curtain strokes.
- **Fix:**
  - Add a readability metric: in the 3rd-person frame at 3-4 m, a Desk Duster stroke shows >= N grains at >= 2 px within 0.5 s, with contrast against ground >= X.
  - Pick one grain colour and add a bright sun-lit glint fraction.
  - Test ballistics with a dev telemetry hook (tracked grain position per frame vs formula), not video.
  - Define a minimum-juice floor on Low and WebGL2 (fewer but larger grains rather than a thinner cloud).

### F15. Temporal stability and AA risks on SMAA presets, TRAA velocity for custom materials, and dynamic-resolution history
- **Where:** RP §8, §9, §18; VT-M1-28 ("no shimmer", A and B), AD §3.2 sparkle, VT-M0-13 (stars).
- **Problem:**
  - Low, Medium and WebGL2 use SMAA (spatial only). World-hashed 1-2 px sparkle, noise-thresholded dust edges and 1-px stars will crawl under camera motion with no temporal filtering. VT-M1-28 requires "no shimmer on P1" including Tier B, with no metric or fallback.
  - TRAA needs correct velocity for the custom CDLOD/camera-relative terrain, instanced and batched meshes, skinned avatars and compute-driven particles. Unplanned until M1-W2; ghosting on the main surface (terrain) would be the first thing a reviewer sees.
  - The controller changes the scale every 2 s; each change invalidates the TAAU history, so the image visibly breathes on Tier A.
- **Fix:**
  - Define a temporal-stability metric (per-pixel luma variance over N frames in a static scene with camera drift) and set pass bars per AA mode.
  - Fade sparkle and fine stripes by AA mode and render scale, and render stars post-upscale as analytic Gaussian disks (radius >= 1.2 px).
  - Spec terrain velocity as camera-only reprojection from depth, and verify it in the M0 bench.
  - Make dynamic-resolution steps larger and hysteretic, and cross-fade history across a step.

### F16. First playable does not "already look good"; core feel arrives late
- **Where:** M1 §1, §4, V-M1b (W3) and V-M1c (W6), W5-T03/T04/T05, W6-T03/T05, W7-T02, W9-T01 (CMP-02/05/07/15 judged at the last wave). M0 puts all visuals in W3 (S7/S8), after the spike and ADR-0003.
- **Problem:** the first playable (`?local=1`, M1-W3) has terrain, regolith and strokes with placeholder input. It has no custodian, no grains (W6), no footprints (W5), no HUD (W6), no hardware (W6). The check there (VT-M1-03/04/05/06/28) judges only the ground. The first felt-quality playtest (P1) is at S15. The final comparator, which is the project's stated success metric, runs in the last wave with two stages for fixes. The hero shot of Moon Sweepers is also mostly characters and machines, which are exactly where F4 bites.
- **Fix:**
  - Pull a blockout custodian with correct proportions, the final shader and the player-color slots into M1-W3, even with placeholder animation.
  - Pull the ballistic grain emitter (a CPU version is fine) into M1-W3.
  - Add interim comparator runs: CMP-02/05 at V-M1b, CMP-07 and a character crop at V-M1c. Score Tier B Medium as well as Tier A (see F18).
  - In M0, schedule look-dev v0 in W2 alongside the bench so the spike runs on it (see F3).

### F17. Exposure architecture is described two incompatible ways
- **Where:** AD §2.1/§2.2 (CPU pre-exposure from EV100 script, tone-map exposure 1.0, adaptation -2.5/+1.5 EV/s, +-0.7 clamp, local +1.0 EV offset), RP §8.4 (GPU histogram or mip chain, +1.5 EV/s brightening, 3 EV/s darkening, +-0.5 clamp, night range -2..+3), RP §2.2.
- **Problem:** adaptation rates are reversed between the two documents. CPU pre-exposure of lights and emissives needs the same value the GPU uses; a GPU histogram without readback cannot feed it. A local crater-shadow offset needs scene feedback. Captures freeze TOD, but the sidecar `EV100` only makes shots reproducible if exposure is a deterministic function.
- **Fix:** choose one. Recommended: EV100 from a scripted curve (sun elevation, a deterministic CPU value used to pre-expose lights), plus a GPU-only adaptation multiplier at the tonemap (no readback). Capture mode uses the scripted value only. Document the FP16 clamp for the sun disk and lamps.

### F18. Tier B and WebGL2 image quality is not benchmarked against the reference
- **Where:** VT §2.6 (comparator on Tier A only), VT §6.1 (captures locked at the preset floor), VT-M1-31 ("Low dignity", V1 but no side-by-side), VT §2.2 (floor 0.5-0.75, FSR1-style upscale).
- **Problem:** an Iris-class laptop renders 960x540 to 1280x720 internal, then FSR1-style upscales to 1080p. That is visibly soft and unstable against Moon Sweepers' native 1080p screenshots. The Tier B and WebGL2 audience is the majority of "browser" players. The comparator gate scores only Tier A, so the most likely "cheap" screenshots (on Tier B) never face the A1/A8/A9 axes.
- **Fix:** run the comparator rubric on B-Medium and G2-Low as well, with pass rules relaxed only on A3/A8 (for example, A8 is judged against the same render scale). Add a target for "perceived sharpness": for example, a Sobel edge-energy ratio on a fixed crop of the upscaled image versus a native render. Consider a render-scale floor of 0.6 on Medium so the floor never goes below 648p.

### F19. The comparator gate is subjective, LLM-scored, and conflicts with the reference-image rule
- **Where:** VT §1 ("never download reference images, links only"), §2.6 (reviewer scores 1-5 for both images, pass = 7 of 9 axes), §6.7.
- **Problem:** the reviewer must view the Moon Sweepers frames to score them, but the rules forbid downloading them. As written, the check cannot be performed. A 1-5 LLM score is not repeatable between reviews. Steam screenshots are curated hero frames, not gameplay.
- **Fix:** permit an ephemeral, gitignored scratch download for comparison only (never committed, never in the archive). Add numeric proxies per axis (luma histograms, edge-energy, A1 as clean-versus-grime ratio from distance). Have Cee blind-score a 6-pair set at V-M1c and the final gate. Keep a fixed reference-crop list so the same pairs are compared each time. Record the Steam screenshot hash.

### F20. Screenshot and motion-capture protocol: several steps are impractical as written
- **Where:** VT §6.1/§6.5/§6.6/§6.7, `.claude/commands/visual-check.md`, `tools/screenshots`.
- **Problem:**
  - Motion capture is specified as "60 FPS, lossless, 20 s". Playwright's built-in video is about 25 fps VP8 and lossy. Real-GPU capture of a WebGPU canvas needs CDP screencast or an in-page frame-stepped renderer.
  - The M2 matrix includes Safari 26 on "M" hardware; the developer machine is Windows, so it cannot be captured locally.
  - The M1 matrix is roughly 20 scenes x 4 configs, plus P-paths; each "viewed and judged" by an agent. Measurements (luma patches, edge profiles, star counts, Earth px, cascade debug) have no defined tool, and VT-M0-12 only checks file naming.
  - Naming and storage differ between VT §6.6 (`<milestone>/<wave|final>/`, long names, `index.md`) and `visual-check.md` (`<scene>-<preset>-<tier>.png`, `REVIEW.md`).
  - Capturing "at preset floor" hides what players see at the ceiling on High.
- **Fix:**
  - Build a deterministic frame-stepped capture mode (fixed dt, fixed seed, `toBlob` or readback per frame), 15-20 FPS effective, with 60 FPS reconstructed motion only for visual review.
  - Write a `tools/screenshots/measure` module (luma patch, edge 10-90, Sobel, star count) so numbers are computed, not eyeballed. Add its output to the sidecar.
  - Unify the naming and storage text. Mark Safari capture as manual or deferred.
  - Capture both floor and ceiling for every comparator scene on High.

### F21. Three r187 API assumptions are scattered, unverified, and unscheduled for verification
- **Where:** RP §2.1, §5.2, §5.4, §8, §9, §18 (verify notes); VT §1.4; M0-W0-T04 (vendored docs).
- **Problem:** the visual plan leans on these r187 features, each marked "verify": `CSMShadowNode` custom splits, fade and lightMargin; `PCFShadowMap` radius control; clustered lighting class; the GTAO prepass pattern (AO on indirect only); `RenderPipeline.outputColorTransform` and `renderOutput`; TRAA/TAAU and `webgpu_upscaling_fsr1`; per-pass `setResolutionScale`; compatibility-mode adapter; reversed depth on WebGL2; Forward+ light counts. There is no consolidated gate. Several are V1-dependent (shadow edge, AO, AA).
- **Fix:** add an M0-W2 "r187 feature verification" task with a matrix (feature, example file, WebGPU/WebGL2 result, fallback, owner). Each row has a pass/fail and a named fallback (for example, no GTAO prepass pattern: multiply composite at 0.5; no FSR1 node: custom CAS/EASU node). Make the visual-target examples (§1.4) part of the matrix.

### F22. WebGL2 parity and "Low dignity" lack engineering backing
- **Where:** VT-M0-09 and VT-M1-30/31, VT §2.2 (G2 column), RP §2.2 and §18, PB §10 item 1.
- **Problem:**
  - Terrain has no baked AO (procedural near field, dust, instanced rocks), so "AO: baked/vertex only" on Low loses contact shadows around rocks, berms and hardware. Low then looks flat.
  - CSMShadowNode on the WebGL2 backend is untested (RP §18). Reversed-Z needs a clip-control extension.
  - Cost of TSL node materials on three's WebGL2 backend is "unmeasured" (PB §10 item 1).
  - The dust-replay fragment path first appears in M1-W3, and the Low/WebGL2 hardware (Tier B on WebGL2) first meets real content in M1-W9, the last wave.
- **Fix:** keep half-res GTAO (or a cheap screen-space cavity term) on Low; define a terrain "cavity from height gradient" substitute for baked AO. Run a WebGL2 capture of the real terrain shader in M0-W3. Add an M1-W3 WebGL2 gate (S02/S03 on G2-Low, not only at the end).

### F23. Originality: leftover drift and a few too-close elements
- **Where:** RP §1 ("Saturated Brightside livery (white/orange/navy family...)"), RP §7; AD §1.3, §5.3 (Desk Duster), §3.3 (stepped lip), §7.2 (Ops Console), VT §3 (VM-08), §2.6 (CMP framing).
- **Problem:**
  - RP §1 still tells the hardware implementer to use white/orange/navy, which is exactly the reference's palette and on AD's do-not-copy list. A shader or material owner who reads RP and not AD would ship it.
  - The Desk Duster is a tiny-brush comic starter tool, a one-step reskin of the "toothbrush starter" gag.
  - The central visual hook (brush-width stroke with a lit-top, shaded-side stepped lip) is deliberately the same read as the reference. Ours is smooth, noise-edged and with rounded end caps, which is a real difference, but the key frame is similar.
  - The diegetic progress console, a moon "globe", 16-player colour-coded crew and big Earth are shared genre elements and acceptable; the CMP shots recreate the exact framing.
- **Fix:** strike the colour sentence from RP §1/§7 and link to AD §5.1. Make a distinguishing choice on the starter tool (a different gag, or keep the Desk Duster and give it a clearly different silhouette and sound identity). Keep the CMP renders internal and gitignored, never used in marketing. Add an "originality check" row to the final visual gate: reviewer confirms that no CMP frame could be confused with a reference frame.

---

## MINOR

### F24. Glass UI cost on Tier B contradicts itself
- **Where:** AD §8.3 (up to 4 `backdrop-filter` panels; blur dropped only on Low/Reduce transparency), RP §15 ("no backdrop-filter over canvas on Tier B"). A backdrop blur over a WebGPU canvas is expensive on integrated GPUs.
- **Fix:** default to `ui-glass-bg-strong` without blur on Tier B (any preset). Add a frame-cost line to the VT-M0-10 test page.

### F25. World-anchored DOM labels lag the canvas
- **Where:** RP §15, VT §2.3.
- **Problem:** DOM transforms and the canvas present are composited separately, so name tags can trail the avatar head by a frame on fast camera motion. VT-M1-19 only checks readability.
- **Fix:** update label transforms immediately after render submit with the same camera matrices, and add a motion check ("tag within 4 px of the anchor at 3 rad/s camera pan").

### F26. Star and Earth specification gaps
- **Where:** AD §2.5/D-08, RP §6, VT-M0-13, VT-M1-12, VT-M1-11, VT-M0-14.
- **Problem:**
  - Daytime star visibility is specified as 35%, a 0.08 multiplier, "mag <= 2.5", "<= 200 stars" and "Realistic 0". Counting stars in a PNG has no method.
  - Earth textures at 4k x 2k for a 39-px disk are oversized; the photo-mode zoom (173 px) needs only about 1k.
  - The 2.4-vs-2.6 deg Earth-size question is still open in M0 §8 note 4 and M1 D3 although VT/AD/RP all say 2.4.
- **Fix:** pick one star-visibility model (a magnitude cut as a function of EV), define counting (local maxima above a threshold), cap Earth at 2k x 1k. Close the Earth-size item.

### F27. Bloom parameters conflict
- **Where:** AD §2.5 (threshold about 4x display white, strength 0.04-0.08), RP §8.1 (threshold 1.0 after exposure, strength 0.12), AD §3.2 (sparkle up to 4x diffuse), VT-M1-29 (clean ground never blooms).
- **Problem:** with threshold 1.0, 4x-diffuse sparkle on sunlit clean ground will bloom, which VT-M1-29 forbids.
- **Fix:** one threshold and strength in `quality.ts`; cap sparkle below the bloom threshold, or exempt it with a mask.

### F28. Licensing items to resolve
- **Where:** AD §11, RP §6 (HYG v4.x, CC BY-SA 4.0; "no Gaia"), `asset-and-data-licensing.md`.
- **Problem:**
  - HYG v4 carries Gaia cross-identifiers, so "HYG v4.x" and "no Gaia data" in the same plan need an explicit check that no Gaia-derived columns are used.
  - The doc's claim that Gaia data is non-commercial should be verified (the Gaia Archive is, to my knowledge, CC BY-SA 3.0 IGO, not NC; SVS Deep Star Maps have different terms).
  - A CC BY-SA star file shipped with the game is manageable as "separate file", but share-alike on screenshots or trailers is unsettled.
  - Photographic CC0 regolith detail textures (ambientCG) carry Earth colour and vegetation tints unless desaturated and calibrated against the albedo chart.
- **Fix:** consider the Yale Bright Star Catalogue / Hipparcos (about 9,100 stars at V <= 6.5), which avoids share-alike entirely. Have docs-keeper confirm the Gaia licence claim from the primary source. Add a "desaturate and match to the chart" step to the regolith pipeline.

### F29. Dynamic-resolution mechanism and controller details
- **Where:** RP §9.
- **Problem:** per-pass `setResolutionScale (r181+)` is unverified. Hard 0.05 steps cause visible resampling pulses. There is no stated behaviour when GPU timestamps are unavailable (Firefox, Safari, some Intel drivers), where a CPU frame-interval EMA cannot separate GPU-bound from vsync-bound frames.
- **Fix:** include it in the F21 matrix; use a vsync-aware heuristic (frame-time gap versus refresh interval); add a "scale-step pulse" visual check in P1.

### F30. Visual QA measurement and reviewer workload not defined
- **Where:** VT §6.7, `visual-qa-reviewer` role (Read, Grep, Glob, Bash, PowerShell, Write).
- **Problem:** the reviewer must compute luma, 10-90% edges, px sizes, CIELAB b*, apex times and star counts on PNGs. No image-analysis dependency or script is named, and Python or ImageMagick availability on the host is not stated. Without a prepared measurement tool the review will degrade into eyeballing, which then fails to detect V1 problems like F1.
- **Fix:** add a measure tool task in M0-W1-T05 (the screenshot harness), with tests against synthetic charts. Make `index.md` generation automatic from sidecar plus measurements.

---

## Cross-cutting recommendations (ordered)

1. **Resolve F1 and F2 first** (documentation only, one day). Everything else depends on one set of numbers.
2. **Lock Tier B hardware and the F3 bench changes** before M0-S5. Re-capture after the real terrain material exists.
3. **Decide the 3D art production path (F4)** before M1-W5. It defines the look more than any shader.
4. **Spike the risky r187 look features in M0** (F5, F8, F9, F21): grazing-angle shadows, Earth-lit CSM reuse, horizon-shadow handoff, TRAA velocity on custom terrain.
5. **Rebalance the schedule (F16):** one blockout custodian and grains in M1-W3, interim comparators at V-M1b and V-M1c, and Tier B in every comparison.
6. **Add the missing checks:** progressive dust thinning (F10), ring handoff and berm numerics (F11), footprint tread and fade (F13), grain readability (F14), temporal stability (F15), night shadows (F8).
