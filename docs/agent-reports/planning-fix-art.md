# Planning fix: visual docs (technical-art-director review)

Input: [planning-review-technical-art-director.md](planning-review-technical-art-director.md) (F1–F30). Files edited (and only these): `docs/design/visual-target.md` (VT), `docs/design/art-direction.md` (AD), `docs/design/audio-direction.md` (AU), `docs/architecture/rendering-pipeline.md` (RP). No code, no git, no installs; no reference image was fetched.

## Key decision: the contrast math (F1)

The review assumed a 2.2 gamma (1.9 display ratio ⇐ 4.1× albedo). With three's **AgX**, which is log-domain, the real transfer is flatter. Computed with three's AgX for neutral grey, then sRGB:
- Noon key: E = 115,900 lux × 1.15 (15 % up-facing fill), EV100 14.3 → scene-linear x = 1.753 × albedo.
- Grime 0.085 → **119**; clean 0.34 → **182**. Ratio **1.53**, difference **63** codes.

**A 1.9 ratio is not reachable by construction.** It would need about 6.8× albedo (grime ≈ 0.05) or a darker exposure.

What changed:
- AD §3.2 / D-02 stays the single albedo source: grime 0.085, clean 0.34 (4×).
- Every luma band is re-derived in AD §2.3, with the math written out: ±8 codes, capture mode, AgX on.
- Gates are now **noon ratio ≥ 1.45 and difference ≥ 50**; down-sun ≥ 1.35 / ≥ 45. Night, dawn, shadow and lamp rows are derived the same way.
- Calibration chart values: 0.10 / 0.33 / 0.80 albedo → 126 / 181 / 213.

## Finding → fix → file

| # | Fix | File(s) |
|---|---|---|
| F1 | Single albedo source; AgX derivation; all bands re-derived (VT-M0-06/08, VT-M1-03/08/09/10); 0.22 / 2.4× / 1.8 removed from RP §1, §7, §19 | AD §1.2 P1, §2.3, D-02/D-05/D-20; VT §4, §5; RP §1, §7, §19 |
| F2 | **RP §14 is THE canonical preset table**: cascades, split/texel, shadows, lamps, AO, AA, render scale, DPR, ring, atlas, particles, draws, triangles, texture pool, Earth, stars, glass UI. VT §2.2 now holds only acceptance bars and links to it; AD links to it. Naming: Tier A/B/C (C = WebGL2), backends `webgpu`/`webgpu-compat`/`webgl2` (G1/G2/G3 retired), presets Low/Medium/High/Ultra; Ultra is a preset, not a tier | RP §2, §14.1, §13; VT §2.1–2.2, §6.5–6.6; AD §2.1, §3.6, §9 |
| F3 | Tier B fallback ladder pre-declared (5 steps, `quality.ts` values only). Bench and iGPU gate are cross-file | RP §14.2, §3.2 row 8 |
| F4 | New **AD §13 Asset production plan**: sources (scripted agent work, headless Blender preferred if Cee installs it, Node path otherwise; kitbash library; CC0 Poly Haven / ambientCG / Kenney; optional commission; AI only per Q15), class table (producer, budget, MVP vs v1.0), measurable "final" bar, placeholder policy, order of work. Aligned with D5 / Q23 and scope-tiers (T1–T4, Trundle and Skiff in MVP). VT-M1-35 adds turntables | AD §11, §12, §13; VT-M1-35 |
| F5 | Edge model W = 0.00925·d + 1.5·t (PCF ≈ 1.5 texels on every preset). Derived bars at 3 m: Low/Med ≤ 15 px, High ≤ 9, Ultra ≤ 8; at 4 m: Med ≤ 12, High ≤ 7. Measurement point and tool defined. New VT-M0-04b tests sun at 60°/15°/4°/1° (acne, contact gap ≤ 1 cm, peter-panning). Grazing-sun bias rule added | RP §5.2; VT §2.2, VT-M0-04/04b, VT-M1-07 |
| F6 | Fill is a normal-dependent stylised regolith bounce: up-facing 15 %, vertical 25 %, down 35 % of the key, scaled by sun or earthshine, GTAO on indirect only, plus a terrain cavity term. New VT-M0-16; VT-M1-09 bands 81–97 | RP §5.1, §7; AD §2.1, D-05; VT-M0-16, VT-M1-09 |
| F7 | Specular-only environment probe: terrain lit by the current key + Earth disk + black sky, no sun disk; 128² (Low 64²) PMREM; refresh on > 2° key change or > 100 m move; 0.1 ms; per-outpost probe. New VT-M1-32 (metal sphere and visor) | RP §5.5, §3.2, §13; AD §2.1, §5.1; VT-M1-32 |
| F8 | Night: the sun's CSM is re-pointed at the Earth (zero cost, 2.4° softness, swap inside the 8 s ramp). Own Crown Lamp shadowed on **every** preset. Nearest 1–2 others shadowed on High/Ultra; all other lamps clamped to 8 m with a fade. New VT-M1-10b (earth shadows, ≤ 5 luma leak behind a 1 m rock). Earthshine ratio defined only in AD | RP §5.1–5.3, §14; AD §2.1–2.2; VT VM-06, VT-M1-10b |
| F9 | Baked far-occluder **horizon map** on all presets (6 × 512², 8 azimuths, ≈ 12 MiB, occluders < 20 m excluded), combined by min; ortho far map kept as a fallback. Handoff bar: edge-width ratio ≤ 2×, luma step ≤ 8. Tier B keeps long shadows. VT-M0-15 runs the spike in M0 | RP §5.2, §13, §14; VT-M0-15, VT-M1-08 |
| F10 | Thinning: WDS thickness model kept; presence threshold uses relief height (peaks clean first). Expected ramp 182/161/151/137/119; VT-M1-34 (monotonic, step ≥ 8, Laplacian speckle bound, ledger ±10 points, no island > 0.5 m²) | AD §3.3 "Partial removal"; VT-M1-34 |
| F11 | One edge number: ≤ 2 cm world (≤ 6 px at 3 m). No SDF claim. Sub-texel strokes become an area-correct lighter line (finer-tile fallback). Ring↔atlas handoff: VT-M1-05b. Berm numerics: ≥ 12 luma, ≥ 2 px | AD §3.3; VT §2.2, VT-M0-07, VT-M1-05/05b; RP §14 |
| F12 | Stripes **supported**: separate R8 stroke-direction textures beside the atlas (Medium+; 0/4/8/16 MiB) and the ring (1/1/4/4 MiB). Client-only, cosmetic. VM-05 covers the whole plot; VT-M1-06 raised to V1 on A and B | AD §3.1, §3.4, §12; RP §13, §14; VT-M1-06 |
| F13 | Tread is a normal-map stamp oriented by the ring direction texture. Lifetimes follow WDS's per-channel subtractive stochastic scheme (grime A by preset, clean B 30 s). VT-M1-15 is now numeric on all presets | AD §3.5; RP §14; VT-M1-15 |
| F14 | One grain rule: grime-tinted, 1–3 cm, ≥ 2 px, 15 % glints; minimum-juice floor; telemetry ballistics hook. VT-M1-16 uses telemetry; new VT-M1-16b readability bar (≥ 20 grains, ≥ 15 luma contrast) | AD §3.6; RP §11; VT-M1-16/16b/17 |
| F15 | Terrain velocity is camera-only reprojection; SMAA stability rules (sparkle cells and fades, w ≥ 1 px); stars drawn post-upscale as Gaussians. Dynamic resolution: 0.10 steps, hysteresis, history resampled. VT-M1-28 has a variance metric (≤ 2.0 TRAA / ≤ 4.0 SMAA) and a scale-step pulse check | RP §6, §8.1–8.2, §9, §18; VT §2.2, VT-M1-28 |
| F16 | Interim comparator runs specified (V-M1b, V-M1c); VT-M1-30 also at M1-W3. Scheduling is cross-file | VT §2.6, VT-M1-30 |
| F17 | One exposure architecture: scripted EV100 key with CPU pre-exposure, GPU-only multiplier (−0.5…+1.0 EV), brighter scene → 3 EV/s, darker → 1.5 EV/s, captures at multiplier 0, FP16 clamp | RP §8.4; AD §2.1–2.2 |
| F18 | Comparator runs on Tier A High, B Medium and C Low (floor + ceiling); A3/A8 per preset; Sobel sharpness bars (VT-M1-33) | VT §2.2, §2.6, §6.1, VT-M1-02/33, VT-M2-01 |
| F19 | Comparator: Part 1 measurable per axis on our frame only; Part 2 Cee views the linked reference in a browser and records better/equal/worse. Nothing is ever downloaded. Pass rule defined | VT §1, §2.6, §6.6–6.7 |
| F20 | Frame-stepped deterministic capture; `tools/screenshots/measure`; floor + ceiling; Safari manual or deferred; one naming/storage rule (tier A/B/C, backend, floor/ceil); generated `index.md` | VT §2.1, §6.1, §6.5–6.7, VT-M0-12, VT-M2-20 |
| F21 | New RP §21: r187 verification matrix (15 rows, example, fallback, both backends) | RP §21, §19 |
| F22 | Low keeps half-res GTAO + cavity term; WebGL2 parity at M1-W3 | RP §7, §14; VT-M1-30/31 |
| F23 | RP's white/orange/navy sentence struck (links AD §5.1). Desk Duster is now a palm-held puck brush with a distinct "swirl" sound. CMP captures are internal only; originality check added | RP §1; AD §1.3, §4.6, §5.3; AU §2.1; VT §2.6, VT-M1-20, VT-M3-12 |
| F24 | No `backdrop-filter` on any Tier B/C device; VT-M0-10 reports glass cost | AD §8.3; RP §14, §15; VT-M0-10 |
| F25 | Labels written after render submit with the same matrices; VT-M1-19b (≤ 4 px at 3 rad/s) | RP §15; VT-M1-19b |
| F26 | One star model m_lim(EV100); measured counts vs expected ±15 %; Earth capped at 2048×1024 (Low/Med 1024×512); Earth size 2.4° marked resolved | RP §6, §14, §20; AD §2.2, §2.5, D-08, §9; VT-M0-13/14, VT-M1-12 |
| F27 | Bloom threshold 4.0 scene-linear, knee 0.5, strength 0.06; sparkle ≤ 0.6 × threshold | RP §8.1; AD §2.5, §3.2; VT-M1-29 |
| F28 | HYG bake reads no Gaia columns (asserted); Gaia wording under verification; Yale BSC flagged as an alternative; ambientCG desaturate-and-calibrate step | RP §6, §19; AD §11 |
| F29 | Vsync-aware heuristic without timestamps; fallback mechanism; pulse check | RP §9, §21; VT-M1-28 |
| F30 | Measure tool defined with synthetic-chart tests; generated `index.md` | VT §6.1, §6.7, VT-M0-12 |

## Cross-file items (exact requested changes)

### world-and-dust-simulation.md (owned by the concurrent agent)

The file was re-read after its 09:40 edits. Items it already covers (albedo 0.085/0.34, subtractive fade, tread stamp, sub-texel coverage, ledger-zero clear) are not repeated.

1. **§7.7 "Edge read"**: replace "ratio ≥ 1.9 … a 1.9× display ratio needs ≈4× in linear albedo" with "art-direction §2.3 targets, 8-bit sRGB luma after AgX in capture mode: noon ratio ≥ 1.45 and clean − grime ≥ 50 codes (4× albedo gives 1.53 / 63; AgX is log-domain, so 1.9 is not reachable)".
2. **§7.7 "Clean ground"**:
   - Roughness: replace "0.55 → 0.40 as G drops" with "roughness = mix(0.62, 0.82, G) (art-direction §3.2)".
   - Sparkle: "per world 1 cm cell" → "cell and fade per rendering-pipeline §14 (1 cm / 15–25 m on High/Ultra; 2 cm / 8–12 m on Low/Medium); clamp ≤ 4× diffuse and ≤ 0.6 × bloom threshold 4.0".
3. **§7.7 "Presence mask"**: τ = 0.04 + 0.08·**h_eff** (h_eff = mix(h, 0.5, f), where h is the normalised 1–5 cm regolith detail height and f → 1 when sub-pixel) instead of pure noise n. The w floor becomes "≥ 1 output px". The thickness formula stays unchanged (verified: ramp 182/161/151/137/119).
4. **§7.7 "Thinning checks"**: point to VT-M1-34 (step ≥ 8, ledger ±10 points, island ≤ 0.5 m²); the numbers already agree.
5. **§7.2 "Stroke direction"**: replace the "[R] no direction channel" decision with an **R8 stroke-direction texture beside the atlas** (same layout; last-pass heading with coverage > 0.5, 8-bit over 360°; client-only, cosmetic, never synced). Medium/High/Ultra only: +4 / 8 / 16 MiB.
   - Compute path: write it in the same kernel.
   - Fragment path: separate R8 target, written only where coverage > 0.5.
   - **Conflict to note for the lead:** WDS chose "no channel, M1-W1 decides"; the lead's brief let this pass choose, and it chose "supported".
6. **§7.5**: add an **R8 direction texture beside the ring** (1 / 1 / 4 / 4 MiB, all presets). It carries stroke heading and boot-print heading for the tread stamp.
   - Ring-edge test: "a Lane Broom stroke changes width ≤ 1 px and berm delta ≤ 20 %; a Desk Duster stroke stays continuous with mean luma change ≤ 15 % (VT-M1-05b)". A 1 px width bar is not achievable for a sub-texel Desk Duster stroke in the atlas.
   - "Coverage" column → "side (radius ≈ half)".
7. **§3.2 bake outputs**: add the **far-occluder horizon map**: 6 × 512², horizon elevation in 8 azimuths, 2 × RGBA8 (≈ 12 MiB), occluders < 20 m ignored (rendering-pipeline §5.2).
8. **§9 memory line**: Dust + terrain becomes **Low ≈ 55, Medium ≈ 67, High ≈ 105, Ultra ≈ 129 MiB**. That is the current 42 / 50 / 81 / 97 + horizon 12 + ring direction 1 / 1 / 4 / 4 + atlas direction 0 / 4 / 8 / 16.
9. **§7.2, §7.5, §7.6 "seed values for `quality.ts`, the only canonical source"**: replace with "**rendering-pipeline §14 is the canonical preset table**; `quality.ts` is generated from or checked against it".
10. **§7.3 table header**: "backend tiers G1/G2" / "tier G3" → `webgpu` / `webgpu-compat` / `webgl2` (Tier C).

### performance-budgets.md (owned by the concurrent agent)

1. **§1, internal render scale**:
   - Tier B: "0.5–0.75" → "Low 0.50–0.75 / Medium 0.60–0.85".
   - Ultra row: "0.67–1.0" → "0.85–1.00, DPR cap 2.0".
   - Add "(canonical: rendering-pipeline §14)".
2. **§3 Shadows row label**: "B/C 2 × 1024²" → "B (Medium) 3 × 1024², C (Low) 2 × 1024²". The ms values are unchanged. Note that the own-lamp shadow and the night Earth CSM sit inside this line.
3. **§4 shadow maps**: A ≤ 48 → **≤ 53 MiB**; B ≤ 8 → **≤ 16 MiB**; C ≤ 8 → **≤ 9 MiB**.
4. **§4 dust tile atlas**: "R remaining + G berm, rg8" → "RGBA8 (WDS §7.2)":
   - A (High) 4096×2048 = 32 MiB
   - B (Medium) 2048² = 16 MiB
   - C (Low) 2048×1024 = 8 MiB
   - plus the direction R8 texture: 8 / 4 / 0 MiB.
5. **§4 detail ring**: "rg8" → "RGBA8": A 2048² = 16 MiB, B and C 1024² = 4 MiB, plus the direction R8 texture: 4 / 1 / 1 MiB.
6. **§4**: add a "horizon map 12 MiB" row (all tiers). The triangle and texture-pool rows already match RP §14 (A 4 M / 1.5 GB, B 1.5 M / 600 MB, C 1 M / ≤ 500 MB; Low pool 480 MB).
7. **§10**: record that the Tier B fallback ladder lives in rendering-pipeline §14.2.

### Milestones (M0-foundation.md, M1-mvp.md) and OPEN_QUESTIONS

1. **M0, iGPU gate**: make the real Tier B iGPU device an owner gate (Q21 → gate, not a note).
2. **M0-W2-T02 bench**: add a worst-case terrain-shader stub:
   - 3 detail layers
   - plot-ID lookup + 7 dot products
   - ring + atlas + both direction taps
   - horizon-map term
   - sparkle and 4-tap berm normals
   - terrain camera-only velocity check
   
   Add a second capture after look-dev (W3-T04) that gates ADR-0003. Schedule look-dev v0 in W2.
3. **M0-W2**: add the task "r187 feature verification" (rendering-pipeline §21).
4. **M0-W1-T05**: add `tools/screenshots/measure` (luma, 10–90 % edge, Sobel, b*, disk size, star count, temporal variance) with synthetic-chart tests, frame-stepped capture mode, turntable capture and `index.md` generation.
5. **M0-W3**: VT-M0-04b (grazing sun), VT-M0-15 (horizon map spike), VT-M0-16 (fill), and a `webgl2` capture of the real terrain shader. Calibrate VT-M0-06 with AgX on.
6. **M0**: prove the asset pipeline on one rock and one outpost module (art-direction §13.5). Cee decides the headless Blender install (Q23).
7. **"Read first" lines** (M0 lines 459 and 475): add "rendering-pipeline §14 (canonical presets)".
8. **Earth size**: close M0 §8 note 4 and M1 D3 (2.4° resolved).
9. **M1-W3-T07, "chunky-pebble grains v0"**: change to "grime-tinted grains 1–3 cm world (≈ 3–8 px at 3–4 m), rounded quads, 15 % glints, never faceted mesh pebbles (art-direction §1.3, §3.6)". The current wording collides with the do-not-copy list.
10. **M1-W3-T07 acceptance**: the blockout custodian meets art-direction §13.4 (final proportions, final shader, player-colour slots), which is stricter than "silhouette at 32 px".
11. **M1 interim comparators**: CMP-02/05 at V-M1b; CMP-07 + a custodian crop at V-M1c; Tier A High + Tier B Medium + Tier C Low each time. Add VT-M1-30 at M1-W3.
12. **M1**: add turntable checks (VT-M1-35) to the W4-T07, W5-T03 and vehicle tasks. Add VT-M1-05b, VT-M1-34 and VT-M1-16b to the waves that land dust shading and grains.
13. **Lead**: write the asset-path ADR (D5 / Q23) citing art-direction §13, and add a follow-up note on ADR-0003 for the Tier B ladder.

### Other files

1. **`.claude/commands/visual-check.md`**: adopt VT §6.6:
   - Naming: `<scene>[a|b]-<tod>-tier<A|B|C>-<preset>-<backend>-<W>x<H>@<dpr>-<hud|nohud|dbg>[-floor|-ceil]`
   - A generated `index.md` instead of `REVIEW.md`
   - A measure-tool step
   - Comparator Part 2 by Cee in a browser
   - An explicit "never download reference images"
2. **docs-keeper**:
   - Verify the Gaia licence wording from the primary source.
   - Check HYG share-alike scope for screenshots and trailers.
   - Check Yale BSC terms.
   - Update `research/asset-and-data-licensing.md` §5.
   - Grep all docs for `G1/G2/G3` and for `0.22` / `2.4×` / `≥ 1.9` and replace them with the new naming and targets. Hits remain in `docs/handoff/FABLE_KICKOFF.md`, `docs/ROADMAP.md`, M0 and M1.
3. **naming-bible.md** `tool.desk_duster` description: "Comically tiny complimentary desk brush" → "Comically tiny palm-held puck brush with a Brightside logo sticker (no handle)".
