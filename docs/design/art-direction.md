# Art direction — Moon Cleanup

Status: **Accepted for build (planning session 2026-11-12)** · Owner: technical-artist · Reviewed by: visual-qa-reviewer · Measurable targets and the screenshot protocol live in [`visual-target.md`](visual-target.md). Sound lives in [`audio-direction.md`](audio-direction.md).
Names: every player-facing name comes from [`naming-bible.md`](naming-bible.md). Token, scene and asset IDs in this file are internal. If a new player-facing name is needed (for example a livery display name), the game-designer adds it to the naming bible first.

---

## 1. Pillars

### 1.1 Identity statement

**Bright, readable stylized realism.** It is a cheerful facilities job on a real-looking Moon. The light obeys the Moon: black sky, one hard white sun, the Earth and its earthshine, stars. The *stuff* is friendly: chunky Brightside hardware, slightly stylized custodians and a calm, premium UI. When physics and readability conflict, **readability wins** and the departure is documented (§2.4).

### 1.2 Pillars

| # | Pillar | Means | Never |
|---|---|---|---|
| P1 | **Clean is obvious** | Dark gray-brown grime against bright clean ground: ≈ 4× linear albedo, which displays as ≥ 1.45× luma and ≥ 50 codes brighter at noon after AgX (§2.3), plus a warm-vs-neutral hue cue and a crisp raised berm at every edge. Readable from 1 m to orbit | Clean that reads as "slightly different gray"; tile-stepped strokes |
| P2 | **Real light, friendly things** | Physically motivated sun, shadows, earthshine and stars, plus rounded, chunky, toy-*friendly* but not toy-*plastic* hardware | Blue sky fill, nebula, fog, haze, colored sunsets |
| P3 | **Every stroke shows** | Instant tactile feedback: grains arc, berms rise, stripes form, the Dust Cell window fills | Delayed or invisible feedback; a cleaning "fade" with no mechanism |
| P4 | **The bright side of the job** | Brightside corporate optimism: big friendly signage, cheerful stencils, DOT's amber light, humor in decals | Grim, dystopian, militaristic, horror-dark night |
| P5 | **Premium, quiet UI** | Dark glass, generous spacing, tabular numbers, spring micro-motion, one accent per moment | Neon overload, sci-fi clichés (Orbitron, hex-grid wallpaper), cluttered HUD |

### 1.3 Do-not-copy list

Moon Sweepers is the quality bar, not a style guide.

| Theirs (do not copy) | Ours instead |
|---|---|
| Chibi astronauts, oversized heads | Human-proportioned custodians, 4.4–4.8 helmet-heights tall |
| Black visor with cartoon LED eyes | Smoked-bronze reflective visor. A simple stylized face shows through at close range |
| White + orange toy machines; van-like vehicle | Ivory + teal body, graphite rubber, safety-yellow accents ≤ 10% of the area; our own vehicle archetypes (§5) |
| Blue nebula sky, blue-tinted shadows | Pure black sky, starfield, warm-neutral ground-bounce fill |
| Lavender, snow-white regolith | Warm gray-brown grime and neutral light-gray clean ground modulated by real maria/highland albedo |
| Chunky mesh-pebble debris | Fine ballistic grains that vanish on landing |
| Toothbrush starter tool (long thin handle, small head) | Desk Duster: a **palm-held round puck brush** with no handle (a desk-crumb brush with a Brightside sticker on its domed back), wiped in small circles; its own sound identity ([audio-direction §2](audio-direction.md)). Same "absurdly small starter" joke, different silhouette, motion and sound |
| White/orange hex-floor interiors and a blue wireframe hologram moon | Survey Globe: a real-albedo moon with ivory/cyan/umber plot states on dark glass |
| Their palette, logos, UI, fonts | Brightside tokens (§5.1, §8.3) |

---

## 2. Color and lighting script

### 2.1 Light rig (one rig, every time of day)

| Light | Model | Color (linear-sRGB hex for authoring) | Shadows | Notes |
|---|---|---|---|---|
| **Sun** | Directional, 0.53° disk | `#FFF4EA` (≈ 5772 K white). **Same color at every elevation:** no atmosphere means no orange sunsets | CSM per preset ([rendering-pipeline §14](../architecture/rendering-pipeline.md#14-quality-presets--the-canonical-preset-table-contract-sharedrenderqualityts), the canonical preset table) + baked horizon map beyond CSM range on every preset (rendering-pipeline §5.2) | Intensity follows sin(elevation) on flat ground. Slopes facing the sun get full intensity |
| **Regolith bounce fill** | Normal-dependent stylised ambient (a hemisphere light used with sky = warm gray at 15 % and ground = warm gray at 35 % of the key's flat-ground illuminance) + GTAO on indirect only + terrain cavity term | Warm gray `#8C8478`. **Never blue** | — | Up-facing ground in shadow gets **15 %** of the key (D-05), vertical faces 25 %, undersides 35 %. A black-sky hemisphere would give up-facing ground nothing, so the "sky" side is deliberately warm gray. Scales with the active key (sun by day, earthshine at night) |
| **Earthshine** | Directional from the Earth's position | `#CFE0FF` cool blue-white | **Yes, every preset, at near-side night:** the sun's CSM is re-pointed at the Earth (zero extra cost), softened for the 2.4° disk | Intensity × Earth phase factor: full 1.0, gibbous 0.6, half 0.3, crescent 0.08, new 0 |
| **Far-side floor** | Ambient | `#AEB9D6` | — | Only where Earth is below the horizon, at night |
| **Crown Lamp** | Spot + IES-like falloff on the helmet crown | `#FFE7C8` (≈ 4500 K) | **Local player: shadowed on every preset.** Other players: nearest 1 (High) / 2 (Ultra) shadowed; all other lamps unshadowed with range clamped to 8 m so their light never passes through a rock | Four levels, §2.2 |
| **Work lights** (outposts, Running Lamps upgrade) | Spot/area, clustered | `#FFD9A8` (≈ 3500 K) | Unshadowed (rendering-pipeline §5.1 placement and range rules) | — |
| **Emissives** | Material | Brand tokens | — | Teal status, amber DOT, lumen-gold, ivory Polished glow |
| **Environment reflections** | Specular-only probe: terrain lit by the current key, the Earth disk, black sky (rendering-pipeline §5.5) | — | — | Gives `pbr-steel`, smoked glass, the bronze visor and Glow/Brushed finishes something to reflect: the lit ground horizon and the Earth |

**Units and exposure:** lights are authored in physical units (lux for directional, candela for spot/point). The exposure architecture (scripted EV100 from the table below, CPU pre-exposure with scale = 1 / (1.2 × 2^EV100), tone-map exposure 1.0, GPU-only adaptation multiplier) is defined once in [rendering-pipeline §8.4](../architecture/rendering-pipeline.md#84-exposure-one-architecture-art-direction-2122-points-here). Tone mapping: **AgX** (three's default AgX; no "Punchy" look, so §2.3 stays valid).

### 2.2 Time-of-day script

Local solar time at the camera drives it. Cycle length is a game-designer balance value, so the script is keyed to sun elevation and works for any length.

| TOD | Sun elevation | Sun on flat ground (lux = 133,800 × sin el.) | **EV100** scripted key (GPU adaptation −0.5…+1.0 EV around it, 0 in captures) | Earth (near side) | Earthshine (authored lux, ×30 departure) | Crown Lamp | Stars visible (m_lim model, rendering-pipeline §6) | Grade (LUT, subtle) | Mood |
|---|---|---|---|---|---|---|---|---|---|
| **Dawn** | 0° → 10° (key 4°) | 0 → 23,200 (key 9,330) | **11.3** | Half, low | 90 (barely matters) | Optional | mag ≤ ≈ 4.2 | Highlights +2% warm, shadows neutral | Long raking shadows, sun-facing crater walls glowing, flats dim: the beauty hour |
| **Morning** | 10° → 40° (key 30°) | 23,200 → 86,000 (key 66,900) | **13.6** | Gibbous→half | — | Off (no visible effect) | mag ≤ ≈ 2.9 | Neutral | Bright, working light, defined form shadows |
| **Noon** | 40° → 90° (capture key 60°) | 86,000 → 133,800 (key 115,900) | **14.3** (physical lunar ≈ 15.3–15.5: **+1.0–1.2 EV brighter**) | Thin crescent / new (city lights visible, §2.5) | — | Off | mag ≤ 2.5 | Neutral (no contrast boost: §2.3 targets assume none) | Highest readability. Shadows short, form from AO + bounce |
| **Dusk** | 10° → 0° (key 4°) | as dawn | **11.3** | Half, low | 90 | Optional | as dawn | Highlights neutral, shadows −2% cool | Mirror of dawn, calmer |
| **Sunset / terminator** | +0.5° → −0.5° | disk clipping on the horizon | Ramp to night over **8 s** (eye adaptation) | Half→gibbous | Ramping | Auto-suggest via DOT | Ramping to full | — | The sun disk sinks behind real terrain: no glow, no twilight |
| **Night, near side** | < −0.5° | 0 | **7.3** | Gibbous→full at midnight | **300** at full; **casts the night shadows** | **On**: Clip Light 6,000 cd / 40°; Spot Ring 22,000 cd / 30°; Wide Halo 30,000 cd / 70°; Searchlight 120,000 cd / 12° | mag ≤ 6.5 (capped per preset) | Shadows +3% cool, lamps warm | Blue-white earthlit world with crisp earth shadows and warm lamp pools: our showcase |
| **Night, far side** | < −0.5° | 0 | **6.5** | Not visible | 0. Far-side floor **40** | On (essential) | mag ≤ 6.5 | Neutral-cool | The "lamp game": silhouettes against stars |
| **Polar** (Outpost Boreal/Austral) | Pinned ≈ +2°, circling | ≈ 4,700 | **11.0** | On the horizon | — | Optional | as dawn | as dawn | Eternal long-shadow look |

Exposure adaptation (one rule, rendering-pipeline §8.4): when the scene gets **brighter**, exposure falls at **3 EV/s**; when it gets **darker**, exposure rises at **1.5 EV/s**. The GPU multiplier range −0.5…+1.0 EV covers the crater-interior case. It never meters the sky. Captures freeze it at 0 so screenshots match §2.3 exactly.

### 2.3 Screenshot luminance targets

These are the tuning goals for exposure, fill and albedo, and the **single source** for every luma number in [visual-target](visual-target.md). Every value is **8-bit sRGB Rec.709 luma after AgX tone mapping**, averaged over 16×16 px, captured in capture mode (scripted EV100, adaptation multiplier 0, grade LUT neutral, macro-albedo multiplier forced to 1.0 on the calibration patch) with the [visual-target protocol](visual-target.md#6-screenshot-protocol-followed-by-visual-qa-reviewer-at-every-milestone). Tolerance on each "expected" value: **±8 codes**.

**How the numbers are derived (achievable by construction).**
1. Scene-linear value of a Lambertian surface after pre-exposure: x = albedo × E / π × 1 / (1.2 × 2^EV100), where E is the flat-ground illuminance of the key **plus the 15 % up-facing fill** (§2.1). Noon key: E = 115,900 × 1.15 lux, EV100 14.3 → **x = 1.753 × albedo**.
2. Display value: three's AgX (log2 encoding over −12.47…+4.03 EV, the AgX contrast polynomial, outset, ^2.2) followed by the sRGB OETF, ×255. For neutral grey the AgX inset/outset matrices preserve grey, so the curve is one-dimensional.
3. AgX is log-domain, so it **compresses ratios**: a 4× linear albedo ratio (2 stops) becomes ≈ 1.53× in display code values at the noon key, and the ratio falls as exposure rises (+1 EV → ≈ 1.38×). The earlier "≥ 1.9 display ratio" assumed a plain 2.2 gamma and is **not reachable** with AgX at this exposure: it would need ≈ 6.8× albedo (grime ≈ 0.05, near-black "charcoal") or a darker, grimmer exposure. We keep 4× albedo and the bright exposure, and gate on a ratio **and** an absolute difference.
4. Grime 0.085 → x 0.149 → **119**; clean 0.34 → x 0.596 → **182**: ratio **1.53**, difference **63 codes**. A 63-code step over a 16×16 patch is clearly brighter at a glance, and the warm-vs-neutral hue (§3.2) adds a second cue.

Calibration chart (VT-M0-06, noon key, flat, sunlit): linear albedo 0.10 → **126**, 0.33 → **181**, 0.80 → **213** (±8).

| Surface (expected value; pass band) | Dawn 4° (flat, sunlit) | Noon 60° (sunlit) | Noon (in shadow, up-facing) | Night near (earthlit) | Night near (Spot Ring pool, 5 m) | Night far (Spot Ring pool, 5 m) |
|---|---|---|---|---|---|---|
| Grime (0.085) | 98; 90–106 | **119; 111–127** | 36; 28–44 | 70; 62–78 | 94; 86–102 | 88; 80–96 |
| Clean ground (0.34) | 163; 155–171 | **182; 174–190** | 89; 81–97 | 132; 124–140 | 159; 151–167 | 153; 145–161 |
| **Clean/grime ratio (min)** | ≥ 1.55 (calc 1.66) | **≥ 1.45 (calc 1.53)** · down-sun ≥ 1.35 (calc 1.43) | ≥ 2.0 | ≥ 1.7 (calc 1.89) | ≥ 1.55 (calc 1.69) | ≥ 1.55 (calc 1.74) |
| **Clean − grime (min codes)** | ≥ 55 | **≥ 50** · down-sun ≥ 45 | ≥ 40 | ≥ 50 | ≥ 55 | ≥ 55 |
| Sun-facing slopes, clean (dawn, ≈ 30° slope) | ≥ 220 (calc 231) | — | — | — | — | — |
| Ivory paint (0.70, sunlit) | — | 209; 201–217 (never clipped flat > 3% of its area) | — | — | — | — |
| Far-side night, lamp off (floor 40 lux) | — | — | — | — | — | grime ≥ 10, clean 53–69 |
| Sky (no stars/sun/Earth) | ≤ 3 | ≤ 3 | ≤ 3 | ≤ 3 | ≤ 3 | ≤ 3 |

Shadow row: the noon-shadow values *are* the D-05 15 % linear fill seen through AgX (≈ 49 % of the sunlit luma; luma percentages are not linear percentages). Mare/highland macro albedo (±15 %) moves any value by about ±7 codes, so measurements outside the calibration patch compare clean and grime **within the same macro region**. If a BRDF term (opposition, lunar-Lambert) moves a value out of band, the M0-W3 calibration fixes the BRDF, not these targets; changing an albedo or EV here means re-running the derivation and updating visual-target in the same PR.

### 2.4 Deliberate departures from physics

| ID | Departure | Physics says | We do | Why |
|---|---|---|---|---|
| D-01 | Brighter exposure | Sunlit lunar scene ≈ EV100 15.3–15.5 | EV100 14.3 at noon (+1.0–1.2 EV) | Cheerful high-key read, comparable with the reference's brightness |
| D-02 | Clean vs grime albedo | Disturbed regolith is only slightly brighter (blast zones); trampled ground is darker | Grime albedo ≈ 0.085, clean ≈ 0.34 (≈ 4× linear; **single source for every doc**, values per macro region in §3.2) → ≈ 1.53× / +63 codes on screen at noon (§2.3) | P1: clean must be obvious |
| D-03 | Dust layer thickness and berms | Fine dust coating of a few mm | Visual layer 2 cm (hand tools) / 3 cm (vehicles); berm 1.5–3 cm / 4–8 cm | Readable layer removal and edges |
| D-04 | Footprint depth | ≈ 3 mm | ≈ 1 cm visual | Readable at 3 m |
| D-05 | Shadow lift | Up-facing ground in shadow gets ~2–5% of sunlit value (no sky light) | 15 % linear fill on up-facing ground (25 % vertical, 35 % undersides) from the stylised regolith-bounce term (§2.1) → clean-in-shadow luma 81–97 at noon | Shadows never crush gameplay information |
| D-06 | Earthshine | ≈ 10 lux at full Earth | 300 authored lux (×30) | Night stays playable and beautiful |
| D-07 | Far-side night | ≈ 0.001 lux starlight | 40 lux floor | Silhouettes stay readable |
| D-08 | Daytime stars | Invisible at daylight exposure | The brightest stars only: limiting magnitude follows exposure (m_lim = 2.5 at noon, rendering-pipeline §6); "Realistic" setting removes them | A black void reads as "empty/unfinished" in a game |
| D-09 | Earth size | 1.9° | 2.4° (≈ 1.26×); photo-mode telephoto for big-Earth shots | Readable phase at 1080p (≈ 39 px) |
| D-10 | Earth exposure | Earth (albedo ~0.3) blows out at night exposure; city lights invisible in daylight | Earth has its own exposure compensation (−6 EV at night). City lights boosted on the dark side | Continents and phase stay readable |
| D-11 | Lamp intensity | Real helmet lamps are a few thousand cd | Crown Lamp up to 120,000 cd authored | Lamps must matter against boosted earthshine |
| D-12 | Visible light pillars | No medium in vacuum, so no beams | Flare Beacons are stylized projected-light pillars. **No other volumetric beams** (lamp cones never visible) | Waypoint readability |
| D-13 | Moon scale | R = 1,737 km, horizon 2.4 km | R = 2,000 m (Standard, 163,842 plots), horizon ≈ 82 m, visible curvature; LOLA heights with vertical exaggeration (ADR-0008) | Contract size; small-world charm |
| D-14 | Polar sun | Season-dependent; can set | Pinned at ≈ +2° | Polar outposts keep their signature look |
| D-15 | Day length | 29.53-day synodic cycle | Compressed cycle (game-designer value) | Play sessions |
| D-16 | Dust settling | Grains land and redeposit | Grains vanish on landing (≤ 0.15 s fade) | Cleaning never visually re-dirties |
| D-17 | Sound | No airborne sound | Suit, contact and relayed sound ([audio-direction](audio-direction.md#1-vacuum-premise)) | Feedback |
| D-18 | Time-of-day grade | The sun is white at all elevations | ±2–3% warm/cool grade at dawn/dusk/night | Mood; kept subtle |
| D-19 | Hop Pack plumes | Cold-gas plumes are nearly invisible | Short white plumes (≤ 0.3 s) | Feedback for other players |
| D-20 | Opposition surge | > 40% brightening near zero phase | Capped at +30% (grime), +15% (clean) | Keeps the down-sun display ratio ≥ 1.35 and difference ≥ 45 codes (§2.3) |

### 2.5 Sun, Earth, stars, post

| Element | Spec |
|---|---|
| Sun disk | 0.53° (≈ 9 px at 1080p). Very high luminance, so selective bloom gives a tight halo (radius ≤ 6° on screen). Lens flare off (Cinematic only). Sun position is consistent with every shadow |
| Earth | 2.4° disk (resolved). Phase computed from the sun direction. Earth sub-point fixed at lat 0°, lon 0° of the contract moon (near-side center). Outposts Dawnside/Duskside (±90°) and the poles see Earth on the horizon. Color: NASA Blue Marble NG downsample, size per preset in rendering-pipeline §14 (cap 2048×1024); night side: Black Marble city lights. Thin blue limb (atmosphere rim) ≤ 3% of the disk radius. Optional slow cloud layer (M3) |
| Stars | Point stars from **HYG v4.x** (CC BY-SA 4.0, separate file with its own license notice; bake uses no Gaia-derived column). Gaussian disks of radius 1.2–2.0 output px drawn after AA and upscaling (stable on every preset), magnitude-scaled intensity and a slight color from B−V index. Exposure-gated by the single m_lim model (rendering-pipeline §6). **No Gaia data, no SVS Deep Star Maps** |
| Milky Way (M3) | Self-authored procedural band or a density map derived from HYG. Never Gaia-derived |
| Post stack | Order and values: rendering-pipeline §8.1 (single source). Bloom is selective by threshold: only sun, Earth limb, lamps and emissives exceed it; sunlit ground, ivory paint and sparkle never bloom. Vignette ≤ 0.1. **Off:** film grain, chromatic aberration, motion blur (Cinematic only), DOF (photo mode only) |
| Fog / haze | **None, at any distance** |

---

## 3. Regolith and dust material spec

### 3.1 Layers

| Layer | What it is | Data |
|---|---|---|
| L-base | "True" regolith revealed by cleaning: bright, compacted, neutral light gray, modulated by the real maria/highland pattern | Height cube map + procedural near-field relief; macro albedo from CGI Moon Kit color (approved source) |
| L-grime | The dust layer: dark warm gray-brown, fluffy, matte, strongly backscattering | Remaining-dust mask (plot tile R + detail ring) |
| L-berm | Material pushed aside at stroke edges | Plot tile G + detail ring |
| L-thin | Partial removal: how much of a thinned layer is left (§3.3, "Partial removal") | Same remaining-dust value R: relief-height threshold + thickness blend |
| L-stroke | Stroke direction for lane stripes and boot-print heading | **Separate R8 "direction" textures** beside the atlas and the ring (8-bit angle over 360°); presets in rendering-pipeline §14; data change requested in world-and-dust-simulation §7.2/§7.5 |
| L-marks | Footprints and tracks (temporary, detail ring) | Detail-ring A (depth) + ring direction (heading) |

### 3.2 Material values

Albedo values are linear. sRGB hex values are given for authoring.

| Parameter | Grime (highland) | Grime (mare) | Clean (highland) | Clean (mare) | Notes |
|---|---|---|---|---|---|
| Base color | `#635A51` (≈ 0.10) | `#544D46` (≈ 0.075) | `#A9A59D` (≈ 0.38) | `#97938C` (≈ 0.30) | Maria/highland blend from macro albedo, ±15% |
| Hue | Warm gray-brown (a* +1…+3, b* +4…+7) | same | Neutral, a hair cool (b* +1…+2) | same | Grime warm vs clean neutral adds a second readability cue |
| Roughness | 0.95–1.0 | 0.95–1.0 | 0.82 after one pass → 0.62 fully polished: roughness = mix(0.62, 0.82, G), G = "unpolish" channel | same | Clean is compacted and slightly smoother; more passes = shinier (single source; world-and-dust-simulation §7.7 points here) |
| Specular F0 | 0.02 | 0.02 | 0.03 | 0.03 | Dielectric |
| Backscatter (opposition) lobe | +30% peak, half-width 8° | same | +15% peak, half-width 6° | same | D-20 caps |
| Micro-normal | Soft, clumpy, low-amplitude | same | Crisper grain, fine pebbles | same | Detail normals with stochastic (non-tiling) sampling |
| Sparkle | None to very sparse | none | Glass-bead glints (real regolith contains impact glass): 40–80 per m² near field, 1–2 px, ≤ 4× diffuse **and ≤ 0.6 × the bloom threshold** (so it never blooms), anchored to world cells (stable under TAA); cell size and fade distance per preset (rendering-pipeline §14) | same | Ties to Bead Kiln and Glass Beads |
| Near-field relief | Pebbles < 5 cm, clods 5–30 cm, undulation > 1 m | — | same | — | Three scales visible within 5 m (VT-M1-13) |

### 3.3 Stroke edge and berm

| Parameter | Hand tools (Desk Duster → Ion Curtain) | Vehicles (Trundle → Behemoth) | Robots |
|---|---|---|---|
| Visual layer depth (D-03) | 2 cm | 3 cm | 2 cm |
| Edge transition (grime → clean), 10–90 % width inside the detail ring | **≤ 2 cm world** (the 1-texel reconstruction floor of the ring; at 3 m that is ≤ 6 px), with 1 cm noise breakup from the height blend below so it never looks vector-perfect. Single number for every doc | ≤ 4 cm | ≤ 2 cm |
| Berm height / width | 1.5–3 cm / 6–12 cm (scaled by dust removed) | 4–8 cm / 15–30 cm | 1.5 cm / 6 cm |
| Berm look | Lit top +25–40% luma, shaded side −30%. Numeric read: lit-minus-shaded difference **≥ 12 luma** across a line pair **≥ 2 px** wide, at the per-preset berm distance in visual-target §2.2 | same | same |
| Re-sweeping a berm | Removes it (the berm is dust) | same | same |
| Beyond the detail ring | The atlas has no distance-field channel (world-and-dust-simulation §7.2). Edges are the thresholded bilinear R of the 20/40 cm atlas texel: smooth contours, softer than in the ring, never stair-stepped. Strokes narrower than 2 atlas texels (Desk Duster, Crescent Squeegee) would break up if thresholded, so the height blend below turns their partial R into an **area-correct lighter line**: continuous, with the right average brightness. Fallback if VT-M1-05b fails: promote recently stroked plots within 40 m to a 10 cm tile (extra atlas slots), decided in M1-W1 | same | same |
| Ring ↔ atlas handoff | 2 m cross-fade at the ring edge (rendering-pipeline §14). A Lane Broom stroke crossing it changes width by ≤ 1 px and berm difference by ≤ 20 %; a Desk Duster stroke (sub-texel in the atlas, so its width cannot be held to 1 px) stays continuous with mean luma change ≤ 15 % (VT-M1-05b) | same | same |
| End caps | Rounded, following the tool head shape. Never square (avoids the reference's rectangle look) | Follows the intake width | — |

#### Partial removal (dust thinning)

Whisk passes, multi-pass tools and robots remove dust in fractions per pass (R steps down, e.g. 1 → 0.75 → 0.5 → 0.25 → 0). The layer must **thin**, not turn into salt-and-pepper noise:
The data side is world-and-dust-simulation §7.3/§7.7 (per-pass removal s, presence mask m, thickness t). The look rules:

| Element | Rule |
| --- | --- |
| Presence mask (height blend) | m = smoothstep(−w, +w, R − τ) as in world-and-dust-simulation §7.7, but the threshold uses the **regolith micro-relief height** instead of pure noise: τ = 0.04 + 0.08 · h_eff, with h ∈ [0, 1] the normalised 1–5 cm detail height already used for normals. Edges then break up along real relief: **peaks clean first, dust lingers in hollows**, like a brushed surface. h_eff = mix(h, 0.5, f), f → 1 as the detail height becomes sub-pixel, so distant edges never speckle. w from screen-space derivatives, never below 1 output px |
| Thickness (tone) | t = m · (0.35 + 0.65 · R); albedo and roughness = mix(clean, grime, t) (world-and-dust-simulation §7.7, unchanged). A thin layer reads as lighter dust, not as salt-and-pepper |
| Expected luma ramp (noon, 3 m, 16×16 average) | R 0 / 0.25 / 0.5 / 0.75 / 1 → ≈ **182 / 161 / 151 / 137 / 119** (computed with the §2.3 AgX derivation): monotonic, every step ≥ 10 codes (VT-M1-34 bar: ≥ 8) |
| Berm with partial passes | Berm height scales with R and with the dust actually removed in that pass (s · c · D_P), so a light whisk leaves a low lip |
| Polish | G ("unpolish") lowers roughness per pass (§3.2); more passes = shinier |
| Ledger agreement | Visible grime coverage on a plot matches its ledger remaining fraction within ±10 percentage points; a Polished plot shows no leftover grime island > 0.5 m² (ledger-zero clear, world-and-dust-simulation §7.3) (VT-M1-34) |

### 3.4 Lane stripes (signature look)

Clean ground carries **directional brush striations**, like mowed-lawn stripes. Passes in opposite directions shade differently: the micro-normal anisotropy is aligned to the stroke direction, and the stripe luma difference is 6–15 at noon. Lane Broom and the Trundle drum make the strongest stripes. Freehand strokes make swirl patterns that let players "draw". They fade to flat at > 60 m.

**Data (decided):** stripes are supported by a **stroke-direction texture**: one R8 texture beside the dust atlas and one beside the detail ring, storing the heading of the last pass with coverage > 0.5 (8-bit angle over 360°, so opposite passes differ). Cost: atlas direction 0 / 4 / 8 / 16 MiB (Low / Medium / High / Ultra; none on Low because stripes are off there), ring direction 1 / 1 / 4 / 4 MiB (kept on Low for print heading), one extra tap each (rendering-pipeline §13–14). The direction is cosmetic and client-only: it comes from the stroke records' capsule endpoints, is never synced and is never authoritative, so "last writer wins" order dependence is harmless. Strokes older than the log cap rebuild without direction and read as flat clean ground. Because the atlas covers the whole residency radius (160 m on High), the elevated VM-05 view shows stripes across the entire shift-cleaned plot, not only near the player. Presets: off on Low, on Medium/High/Ultra (§14). The data change is requested in world-and-dust-simulation §7.2/§7.5.

### 3.5 Footprints and tracks (detail ring, temporary)

| Mark | On grime | On clean ground | Lifetime |
|---|---|---|---|
| Boot print (30 × 12 cm) | 1 cm deep (D-04), −15% luma, smoother floor. **Never reads as cleaned.** The Brightside chevron tread is a small tileable **normal-map stamp** (lug period 2.5 cm) blended by the ring's print-depth mask and oriented by the print heading in the ring direction texture, so tread detail does not depend on the ring texel (2–4 cm) and resolves on every preset | Faint grime-colored print at 25% opacity, same tread stamp | Grime prints: per-preset lifetime (rendering-pipeline §14), and they also end when they leave the ring (2 m fade; M3: bake to "trampled"). Clean-ground prints: 30 s on every preset |
| Trundle | Combed drum striations (also cleans) | — | — |
| Skiff balloon tire | 25 cm wide, soft diamond tread | Faint print, 30 s fade | as boots |
| Carryall | 6 narrow ribbed tires | as Skiff | as boots |
| Bulldust | 35 cm block tread, articulated offset | as Skiff | as boots |
| Behemoth | 80 cm cleat tracks, deep (2 cm) | as Skiff | as boots |
| Sandpiper/Plover | Tiny 3-toe bird prints (charm) | none | 20 s |

**One lifetime scheme** (data in world-and-dust-simulation §7.6): grime prints live in the ring's depth channel A with the per-preset lifetime (rendering-pipeline §14); clean-ground prints live in the compaction channel B and fade in 30 s on every preset. Both fade **subtractively with stochastic rounding**, so an 8-bit value always reaches 0 (the old multiplicative fade stalled). The print heading for the tread stamp comes from the ring direction texture (§3.1 L-stroke).

### 3.6 Dust particles

| Rule | Value |
|---|---|
| Motion | Pure ballistic, g = 1.62 m/s², **no drag, no clouds, no lingering puffs** |
| Launch speeds | Hand tools 0.5–1.5 m/s (range 0.15–1.4 m, flight 0.4–1.3 s); vehicles 2–4 m/s (2.5–10 m); Railshot ring 3–6 m/s |
| Look (single colour rule; rendering-pipeline §11 points here) | Grime-tinted grains (they are the removed dust), lit as tiny spheres by key + fill, no self-shadow, 1–3 cm world size (≈ 3–8 px at the 3–4 m third-person distance, so they read in a cropped screenshot or GIF) and **never below 2 output px**, coverage alpha (no aliasing). Rounded grain quads, never faceted mesh pebbles (§1.3). **15 % are glint grains** that flash to 2× brightness as they tumble in direct light, which is what makes them read against dark grime. Lamp beams make grains sparkle at night |
| Readability (P3, measurable) | Third person at 3–4 m, noon, Desk Duster stroke: **≥ 20 grains ≥ 2 px visible within 0.5 s of stroke start, and ≥ 50 % of them differ from the ground behind them by ≥ 15 luma** (VT-M1-16b). Same bar on every preset |
| Minimum juice (Low, CPU path) | Hand-tool strokes emit the same grain count on every preset; capped tools (Static Rake, Ion Curtain, vehicles) switch to fewer but larger grains so a stroke still reads as a burst (rendering-pipeline §11) |
| End of life | Vanish on landing within 0.15 s (D-16) |
| Static Rake | Grains lift *up* along a short field line before being pulled in (nod to real electrostatic dust levitation). Faint blue crackle sparks `#7FD8FF` |
| Ion Curtain | Thin shimmering collection plane: Fresnel teal edge, slight refraction ripple. Grains stream into it |
| Hop Pack | White plumes ≤ 0.3 s that expand and vanish; ballistic grains kicked from the ground below 2 m |
| Budgets | Pool sizes per preset: [rendering-pipeline §14](../architecture/rendering-pipeline.md#14-quality-presets--the-canonical-preset-table-contract-sharedrenderqualityts) (canonical) |

### 3.7 Rocks, craters, macro terrain

| Element | Rule |
|---|---|
| Rocks | 5 variants per size class (pebble instancing, 0.1–0.3 m, 0.3–1 m, 1–3 m boulders). Top surfaces carry grime that dissolves when their plot reaches Polished (driven by the plot scalar) |
| Small craters | Procedural near-field craters 1–15 m with raised rims, density from LOLA slope |
| Macro relief | LOLA-derived with vertical exaggeration (ADR-0008). Art target: crater rims 5–40 m near outposts; nothing that makes walking a chore |
| Survey Points | 24 real features (central peaks, rilles) get hero-modeled local detail |

### 3.8 Orbit and Survey Globe view

Real CGI Moon Kit albedo and relief on a correct sphere. Plot states use the naming-bible map colors: **Grimy = deep umber `#5A4433`, Opened = cool cyan `#5ED3E8`, Polished = ivory glow `#FFF3DA`**. These are tinted over the albedo at 55% (Grimy) / 45% (Opened) / emissive 0.6 (Polished). Soft terminator. Earth in frame. Player pips, Flare Beacons, robots and outposts are drawn as glass-UI markers.

---

## 4. Custodian suit design

### 4.1 Proportions (slightly stylized human, NOT chibi)

| Measure | Value | vs a real EVA suit |
|---|---|---|
| Total height (sole → helmet top) | 1.85 m | same |
| Helmet | 0.40 m tall × 0.36 m wide → **4.6 helmet-heights tall** (allowed 4.4–4.8) | Helmet ≈ 1.1× real. Chibi is 2–3 |
| Visor opening | 0.22 × 0.18 m, gently rounded rectangle | — |
| Shoulder width (with pauldrons) | 0.62 m | +10% |
| Crotch height | 44% of height | Real ≈ 47%: slightly shorter legs read friendlier |
| Gloves / boots | 1.15× / 1.2× | Readable tool grip, planted stance |
| Life-support pack | 0.50 × 0.38 × 0.20 m | Smaller than Apollo PLSS |

### 4.2 Silhouette components

| Part | Design | Readability job |
|---|---|---|
| Helmet | Rounded-rect dome. **Crown Lamp ring** on top (grows with lamp level: Clip Light clip → Spot Ring bar → Wide Halo ring → Searchlight pod) | Unique head shape; lamp level visible |
| Visor | Smoked bronze, reflective (Fresnel). Inside, at ≤ 6 m and out of direct reflection, a simple stylized face (8 presets, no lip sync) | Human warmth without LED eyes |
| Torso | Soft ivory suit with teal joint bellows. The **Holster Rig** chest/hip harness shows clipped tools (slot count = level) | Holster level visible |
| Pack | Life support with **Hop Pack** nozzles (2–4, by level) and a player-color light strip | Back view identity |
| **Dust Cell** | Hip-mounted cylinder with a **smoked window that shows the dust fill level**; level I/II/III adds size bands | Diegetic gauge mirrors the HUD Cell |
| **Ballast Soles** | Chunky graphite soles with a yellow mag-plate tab that glows teal when on | Gravity toggle readable |
| **Lowlight Visor** | Visor tint shifts green-amber when active | Visor mode readable to others |

### 4.3 Materials and color slots

| Slot | Default | Rule |
|---|---|---|
| Suit fabric | Ivory beta-cloth weave `#E4DCCB`, roughness 0.8 | Livery may change pattern, not the base value range (luma stays 200–240 sunlit) |
| Soft panels / bellows | Brand teal `#1C8C84` | Livery may swap to graphite |
| Hard parts (pack, helmet ring, boots) | Graphite `#2B2F34` + brushed steel | — |
| Hazard tabs, pull straps | Safety yellow `#F2B705`, ≤ 5% of area | — |
| **Player color** (reserved; liveries never override) | Helmet crown ring (emissive 0.4), shoulder plates, pack light strip, Dust Cell window glow, name tag, map pip | Readable at 50 m, day and night |
| Dust patina | Boots, shins, gloves and knees accumulate grime (mask 0→1 with cleaning time). Cleared at an outpost | Shows work done |

### 4.4 Player colors (16; display names in naming-bible A6)

Each slot pairs with a **numeral glyph 1–16** on the shoulder and name tag for color-blind modes.

| ID | Hex | ID | Hex | ID | Hex | ID | Hex |
|---|---|---|---|---|---|---|---|
| P01 | `#FF6B5B` | P05 | `#3DDC97` | P09 | `#8E6BFF` | P13 | `#D9B98C` |
| P02 | `#FF9A3C` | P06 | `#2EC4D6` | P10 | `#C86BFA` | P14 | `#BFE6FF` |
| P03 | `#F5D547` | P07 | `#4DA3FF` | P11 | `#FF5FC8` | P15 | `#D93A4A` |
| P04 | `#A3E048` | P08 | `#4E6CFF` | P12 | `#FF8FA8` | P16 | `#3E9E5A` |

Assignment order maximizes the distance between consecutive joins (P01, P07, P04, P11, P02, P09, P05, P15, …: the netcode/UI engineer owns the table). On the Survey Globe, player pips get a white outline so P06 never reads as "Opened" cyan.

### 4.5 Liveries via Tenure

Rank and livery display names come from the naming bible (A6). Tenure thresholds belong to the game-designer.

| Livery (ID) | Unlocked at rank | Look |
|---|---|---|
| `livery.trainee` | Trainee | Plain ivory; yellow "learner" band around the helmet |
| `livery.custodian` | Custodian | Teal shoulder chevrons, Brightside chest patch |
| `livery.senior` | Senior Custodian | Ivory/teal pinstripes on arms and legs, service-year sleeve bars |
| `livery.lead` | Lead Custodian | Graphite chest panel, lumen-gold `#FFD36B` trim lines |
| `livery.head` | Head Custodian | Inverted scheme (graphite suit, ivory panels), lumen-gold visor tint |
| Commendations cosmetics | — | Patches, helmet decals, Dust Cell skins, lamp colors (within the warm-white range) |

### 4.6 Motion feel

1/6 g lope: longer stride hang (0.45–0.6 s airborne at a jog), soft knees on landing, slight arm counter-swing. Tools have weight: sweep anticipation of 80–120 ms, follow-through. The Desk Duster is cupped in the palm and wiped in small fussy circles (comedy). Idle: visor glance at the Earth, tapping the Dust Cell window. The animation sources are in §11.

---

## 5. Brightside hardware and vehicles

### 5.1 Brightside PBR palette (hardware)

| Token | Base color (sRGB) | Roughness | Metal | Use (share of an asset's visible area) |
|---|---|---|---|---|
| `pbr-ivory` | `#E4DCCB` | 0.45 (paint) | 0 | Body panels, 50–70% |
| `pbr-teal` | `#1C8C84` | 0.4 | 0 | Chassis, frames, structural, 15–30% |
| `pbr-teal-deep` | `#0E5E5C` | 0.45 | 0 | Recesses, trims |
| `pbr-yellow` | `#F2B705` | 0.45 | 0 | **Safety only:** moving parts, hazard edges, grab rails, ≤ 10% |
| `pbr-graphite` | `#2B2F34` | 0.6 | 0 | Rubber, tires, tracks, gaskets |
| `pbr-steel` | `#C9CCCF` | 0.35 | 1 | Brushed aluminum, shafts, rails. Reads correctly only with the environment probe (§2.1): it reflects the lit ground horizon and the Earth (VT-M1-32) |
| `pbr-glass-smoke` | `#3A3A3A` @ transmission 0.6 | 0.05 | 0 | Hopper and Dust Cell windows (show the dust inside) |
| Emissive teal | `#35E0D2` | — | — | Status OK, coils, Glow finish |
| Emissive amber | `#FFB02E` | — | — | DOT light, warnings |
| Decals | Brightside crescent-squeegee logo, fleet numbers (stencil), friendly hazard pictograms, PR slogans ("We keep the bright side bright.") | — | — | 1–3 per asset face |

Grime patina on all hardware: the lower 30% accumulates dust, the top surfaces get a light dusting, and fresh-from-Requisitions items start clean.

### 5.2 Vehicle design language

Friendly chunky industrial means:
- thick bevels (≥ 2 cm on 1 m features), rounded-rect panels, visible fasteners in groups;
- oversized wheels/tracks (1.3–1.5× realistic);
- tidy exposed mechanics in yellow;
- **translucent smoked hoppers that show the collected dust** (a shared diegetic feature);
- teal status lights, white headlamps, amber rear lamps;
- the Running Lamps upgrade adds roof light bars;
- the Wide Mouth upgrade visibly widens the intake/brush.

| Vehicle | Silhouette idea | Size (L × W × H) | Signature detail |
|---|---|---|---|
| **Trundle** | Walk-behind push cart: tall T-handle, low body, spinning brush drum in front | 1.4 × 0.9 × 1.1 m | Drum spins with yellow hub caps. Small smoked hopper |
| **Skiff** | Low ride-on, open teal tube frame, four big balloon tires, bubble hopper behind the seat | 2.6 × 1.6 × 1.4 m | Front brush deck that lifts on jumps. Seat suspension bob |
| **Carryall** | Flatbed six-wheeler, two bench rows with yellow grab rails (8 seats), puck racks | 5.0 × 2.4 × 1.8 m | No cleaning gear; beacon on a mast |
| **Bulldust** | Articulated two-body: front intake body with a rubber-flap skirt, rear hopper body, open roll-cage seat | 5.5 × 2.6 × 2.4 m | Visible articulation joint. Skirt flaps ripple |
| **Behemoth** | Tracked mega-cleaner, enclosed cab up a ladder, multi-roller head, giant windowed hopper, light array | 9 × 4.5 × 4.5 m | Landmark scale. The hopper window shows tonnes of dust. Slow, majestic |

Air-time callouts (Hang Time, Moonshot!, Lunar Loop, Corkscrew, Faceplant) are UI callouts (§8.7). The vehicles add squash on landing via suspension only, never mesh squash.

### 5.3 Hand tools

| Tool | Look | Size cue |
|---|---|---|
| Desk Duster | Palm-held round puck brush (≈ 7 cm across), domed ivory back with a Brightside sticker, a ring of short graphite bristles underneath, **no handle**. Wiped in small circles. Deliberately unlike a toothbrush silhouette (§1.3) | Absurdly small in a gloved hand |
| Crescent Squeegee | Stiff hand whisk, **scuffed orange grip** (naming bible: the only orange, kept small and worn) | Hand-held |
| Bristle Broom | Full-length broom, brushed aluminum shaft, graphite bristles | Waist-to-ground |
| Lane Broom | Wide flat head on a T-handle, yellow end caps | 1.2 m head |
| Static Rake | Comb head with teal emitter tines, faint blue crackle | — |
| Ion Curtain | ~1 m emitter bar, two teal nodes, shimmering field plane | — |
| Assembly Gun | Chunky projector, ivory/teal, a cyan blueprint projection cone (a UI light, allowed like Flare Beacons) | Two-handed |

---

## 6. Robots (shorebird motifs)

### 6.1 Language

Robots are bird-inspired, never cute-face. Each has a single wide sensor slit (teal), no eyes. Ivory shells, teal joints, graphite legs. Gait is quick and pecking. A state light sits on the "crown". They are owned by the shift, so robots carry no player color.

### 6.2 Robot sheet

| Robot | Form | Size | Motion | Base |
|---|---|---|---|---|
| **Sandpiper** | Pill body on two thin backward-knee legs, brush "beak" that pecks/sweeps the ground | 0.45 m tall | Skittering bursts, stop, peck-sweep, run | **Roost**: a perch-tower dock with a ring of charging pads |
| **Plover** | Plumper body with a graphite "neck band" (plover collar), **two brush beaks** | 0.7 m | Faster, steadier trot | Roost |
| **Albatross** | Long narrow wings = solar panels (3.2 m span), belly claw that carries a **Bale** (20 kg, strapped cube) | 1.2 m body | **Ballistic hops** on cold-gas puffs; wings fold for the hop and unfold as panels on landing (no gliding in vacuum) | Delivers to **Nests**: bowl-shaped catcher buildings |

### 6.3 Robot state lights (UI state names from the naming bible)

| State | Light | State | Light |
|---|---|---|---|
| Foraging | Teal, steady | Crop Full | Amber, double blink |
| Flying | White, steady | Roost Brimming | Amber, slow blink |
| Inbound | Cyan, steady | Patch Picked Clean | Mint `#43D69B` flash ×3 |
| Molting | Lumen-gold, pulse | Grounded | Dim graphite |
| Resting | White, slow breathe | — | — |

The nine states are the robot states of the naming bible; the retired 11-state list (and its Docking and Scanning lights) is gone.

---|---|---|---|
| Sweeping | Teal, steady | Bin Full | Amber, double blink |
| Travelling | White, steady | Roost Full | Amber, slow blink |
| Returning | Cyan, steady | Plot Done | Mint `#43D69B` flash ×3 |
| Docking | Cyan, pulse | Paused | Dim graphite |
| Emptying | Lumen-gold, pulse | Idle | White, slow breathe |
| Scanning | Teal sweep beam (short) | — | — |

---

## 7. Buildings, outposts and build pieces

### 7.1 Outpost kit

Pre-fab modules: horizontal capsules and boxes on teal legs, partly banked with regolith. Ivory panels, teal frames, big backlit Brightside signage visible from 100 m, warm work-light masts, yellow-striped walkways, landing aprons in light concrete-gray (clean, the "always Polished" outpost ground). Each outpost has a distinguishing color accent band on its signage (Boreal ice-blue, Austral sand, Dawnside warm gold, Duskside violet). The Brightside palette stays dominant.

### 7.2 Building sheet

| Building | Look | Hero feature |
|---|---|---|
| Assay Counter | Waist-high counter with a weighing deck (grated) and a big flip-digit/LED readout | Readout ticks; lumen-gold "ka-ching" flash |
| Receiving Gate | Arch over a Glide Rail end, scanner ring | Ring flashes teal per puck |
| Railshot | 60 m inclined coil rail on a truss, coils in rings | Coils light up in sequence; the sled streaks off and becomes a moving star |
| Requisitions Desk | Kiosk counter with a tilted screen and tool display rack | Rack shows owned/available tools |
| Ops Console | Large curved screen with the Promotions Board | Department color bands |
| Relay Pad | Flush ring pad with teal inner glow | Ring "wipes" on teleport |
| Flare Beacons | Tall slim mast + stylized vertical light pillar (D-12) in one of 12 colors | Visible from elevated views |
| Motor Pool | Garage with a roll-up door and fleet numbers | Door rolls up; interior work lights |
| Dust Vault / Dump Plate | Squat silo with a level window / grated pad with yellow chevrons | Visible fill |
| Puck Former | Hopper + press with a smoked window | Press stamps the Brightside logo on each Dust Puck |
| Glide Rail, Rail Fork/Join | Low maglev rail, teal emitter strip, rounded ends | Pucks glide with a faint hover gap |
| Bead Kiln | Ceramic-white drum with an **orange glowing sight window** (hot glass: physical glow, not paint) | Glass Beads trickle out glinting |
| Tile Sinterer | Heavy press with a stamp face | Glossy Sinter Tiles stack |
| Sun Sprig / Sun Fan / Heliostat | Small single panel / fan of panels / large tracking mirror-panel that follows the sun | Panels visibly track |
| Night Cell | Battery cabinet with a vertical charge bar | Bar fill = charge |
| Roost / Nests | §6.2 | — |
| Dust Puck / Bales / Sinter Tiles / Glass Beads | Hockey-puck brick with a stamp / strapped cube / glossy square tile / glinting bead sacks | Instanced; readable at 10 m |
| Stray Cargo | Dented Brightside crates, half-buried, with a faded hazard stripe | Readable as "lost freight" at 15 m |

### 7.3 Build pieces and finishes

Deck Plates, Gantries, Rails & Railings, Panels (wall, window, door) snap on a 1 m grid with 0.5 m sub-snaps.

| Finish | Look |
|---|---|
| Brushed | Brushed aluminum, anisotropic streaks |
| Tread | Diamond tread plate, graphite-steel |
| Mesh | Open grating (alpha-tested, two-sided, AA-safe with alpha-to-coverage where available) |
| Glow | Ivory panel with emissive teal edge strips |
| Chevron | Ivory with yellow/graphite chevron hazard pattern |

Build mode visuals: Place shows a cyan blueprint ghost (valid) or an amber one (invalid). Shift has a hover lift and dashed outline. Reclaim dissolves the piece into teal particles with a 100% refund flash.

---

## 8. UI style guide

### 8.1 Principles

Dark glass panels float over a bright world. Hierarchy comes from size and weight, not color. One accent color per moment. Numbers are tabular and never jitter. Diegetic first (Dust Cell window, hopper windows, Night Cell bar), HUD second. DOT appears as a small amber status light on panels and speaks in subtitles (audio-direction §6).

### 8.2 Type (SIL OFL 1.1 families; verify each license and ship `OFL.txt`)

| Role | Family / weights | Features | Use |
|---|---|---|---|
| Display | **Space Grotesk** 500, 700 | `tnum` for numbers | Titles, wallet LM, callouts (Moonshot!), banners (Contract Fulfilled) |
| UI text | **Inter** 400, 500, 600 | `tnum`, `cv11`, `ss01` | All body, labels, HUD values, subtitles |
| Mono | **JetBrains Mono** 500 | — | Plot IDs (`Plot 41-207`), coordinates, the DOT speaker tag |
| Not used | Orbitron, Rajdhani | — | Sci-fi cliché, weak at small sizes |

Self-host woff2, subset to Latin + Latin-1 and the symbols we need, `font-display: swap`, preloaded before Clock In.

| Token | Size (CSS px @ HUD scale 100%) | Line height | Weight | Use |
|---|---|---|---|---|
| `type-legal` | 12 | 16 | 400 | Credits/legal only, never gameplay |
| `type-caption` | 14 | 20 | 500 | Minimum for gameplay text, labels (uppercase +0.06em) |
| `type-body` | 16 | 24 | 400 | Panels, subtitles default |
| `type-value-s` | 18 | 22 | 600 | Secondary HUD values |
| `type-value` | 22 | 26 | 600 | Primary HUD values (Cell, Shine) |
| `type-title` | 28 | 34 | 600 | Panel titles |
| `type-wallet` | 36 | 40 | 700 (Space Grotesk) | LM wallet |
| `type-callout` | 48 | 52 | 700 (Space Grotesk) | Air-time callouts, "Plot stamped" |
| `type-banner` | 64 | 68 | 700 (Space Grotesk) | Inspector's Stamp hero, Contract Fulfilled |

HUD scale = clamp(0.85, viewportHeight / 1080, 1.5) × user HUD scale (80–150%).

### 8.3 Color tokens (UI)

| Token | Value | Use |
|---|---|---|
| `ui-glass-bg` | `rgba(12,16,20,0.72)` + `backdrop-filter: blur(16px) saturate(140%)` | Default panel. **0.72 is the minimum opacity** (contrast below) |
| `ui-glass-bg-strong` | `rgba(12,16,20,0.88)` | Modals, text-heavy panels, Low preset, "Reduce transparency" |
| `ui-glass-border` | `rgba(255,255,255,0.12)`, 1 device px | Panel edge |
| `ui-glass-highlight` | `rgba(255,255,255,0.06)` top inner 1 px | Glass sheen |
| `ui-shadow` | `0 8px 32px rgba(0,0,0,0.45)` | Panel lift |
| `ui-scrim` | `rgba(0,0,0,0.55)` | Behind modals |
| `ui-text-1` | `#F5F7FA` | Primary text |
| `ui-text-2` | `#C9D1D9` | Secondary text |
| `ui-text-3` | `#9AA5B1` | Tertiary: only on `ui-glass-bg-strong` or text ≥ 19 px bold |
| `brand-ivory` | `#F3ECDD` | Brand surfaces, Polished accents |
| `brand-teal` | `#17A398` | Primary action |
| `brand-teal-hi` | `#35E0D2` | Focus, active states |
| `brand-yellow` | `#FFC629` | Warnings, hazard |
| `brand-graphite` | `#24282D` | Opaque surfaces |
| `dot-amber` | `#FFB02E` | DOT light, DOT speaker tag |
| `lumen-gold` | `#FFD36B` | LM icon, income, tick-up flash |
| `state-grimy` / `state-opened` / `state-polished` | `#5A4433` / `#5ED3E8` / `#FFF3DA` | Plot states (naming bible) |
| `ok` / `warn` / `danger` / `info` | `#43D69B` / `#FFC629` / `#FF5C61` / `#5ED3E8` | Semantic |
| `focus-ring` | 2 px `#35E0D2` + 2 px offset | Keyboard/gamepad focus |

**Contrast rule.** Browsers composite in sRGB, so we verify against a **pure white backdrop** (the worst case: Polished ground at noon). `ui-glass-bg` over white gives ≈ sRGB 82. On that, `ui-text-1` scores ≈ 7.9:1 and `ui-text-2` ≈ 5.1:1, both passing WCAG AA 4.5:1. `ui-text-3` passes only on strong glass (≈ 5.8:1).

Performance: at most 4 simultaneously visible `backdrop-filter` panels. **Any Tier B or Tier C device (whatever the preset)**, the Low preset and "Reduce transparency" swap to `ui-glass-bg-strong` without blur (rendering-pipeline §14, §15): a backdrop blur over a WebGPU canvas is expensive on integrated GPUs. The VT-M0-10 test page reports the frame cost of the glass panels.

### 8.4 Spacing, radii, elevation

| Scale | Values (CSS px) |
|---|---|
| Spacing (4-pt) | `sp-0.5` 2 · `sp-1` 4 · `sp-2` 8 · `sp-3` 12 · `sp-4` 16 · `sp-5` 20 · `sp-6` 24 · `sp-8` 32 · `sp-10` 40 · `sp-12` 48 · `sp-16` 64 |
| Radii | `r-xs` 4 (chips) · `r-sm` 6 (inputs) · `r-md` 10 (buttons) · `r-lg` 14 (cards) · `r-xl` 20 (panels) · `r-pill` 999 |
| Elevation | `e-0` flush HUD · `e-1` glass panel · `e-2` modal (strong glass + scrim). No deeper stacks |
| HUD safe area | 32 px at 1080p (scales with HUD scale); 48 px bottom when subtitles are on |
| Hit targets | ≥ 40 × 40 CSS px; gamepad focus order on every panel |

### 8.5 Iconography

| Rule | Spec |
|---|---|
| Base set | **Lucide** (ISC, keep the license notice). 24 px grid, 1.75 px stroke, round caps and joins |
| Sizes | 16 / 20 / 24 / 32 px; stroke scales so the visual weight stays constant |
| Custom glyphs (same grid and stroke) | Lumens sunburst (LM), Shine, Dust Cell, Dust Puck, Plot hex, Inspector's Stamp, Holster Rig, Hop Pack, Crown Lamp, Lowlight Visor, Ballast Soles, Flare Beacon, Relay Pad, Roost, Nest, each vehicle, each robot, each hand tool, each department (Storage, Technique, Fitness, Haulage, Accounts) |
| States | Outline = default; filled = active/selected; `dot-amber` dot = DOT has a message |
| Format | Inline SVG via a sprite; no icon fonts; no bitmaps |

### 8.6 HUD layout (labels from the naming bible)

| Zone | Content |
|---|---|
| Top-left | **LM** wallet (shift wallet) with tick-up ticker + income floaters; On-Shift chip ("Flock ×2.04 · Effort 100%") |
| Top-center | Compass strip (outposts, nearest arrow, pings; Flare Beacons from v1.0); toasts under it ("Requisition approved", "Plot stamped", "Railshot away"), max 3 stacked |
| Top-right | **Shine** (Shine Index %) + small albedo readout + Next Review chip |
| Bottom-right | **Holster** slots, each with its **Cell** gauge (matches the Dust Cell window); active tool enlarged |
| Bottom-left | **Lamp** / **Visor** / **Hop** / Ballast Soles icons + day/night ring |
| Center | Minimal reticle (tool footprint ghost on the ground instead of a crosshair) |
| Bottom-center | Subtitles / DOT lines, interaction prompt above them |
| World | Name tags, Plot Card outline + `Plot 41-207` + % remaining, robot state chips on hover |

Source of truth: [GDD](GDD.md) §10 and [ui-screens-and-flows](ui-screens-and-flows.md) (HUD widget table).

### 8.7 Motion rules (Motion / `motion/react` springs)

| Preset | Stiffness / damping / mass | ≈ settle | Use |
|---|---|---|---|
| `spring-snap` | 600 / 38 / 1 | 150 ms | Press/release, toggles, slot selection |
| `spring-ui` | 380 / 32 / 1 | 250 ms | Panel open, list items, tabs |
| `spring-soft` | 220 / 26 / 1 | 400 ms | Large panels, Survey Globe overlay, Promotions Board |
| `spring-pop` | 520 / 16 / 0.8 | 350 ms, ≈ 12% overshoot | Rewards, Inspector's Stamp UI, purchase success, callouts |
| `spring-heavy` | 160 / 22 / 1.4 | 600 ms | Banners (Contract Fulfilled), level-up |

| Tween | Duration | Easing |
|---|---|---|
| Hover in/out | 100 / 140 ms | out-cubic (0.33, 1, 0.68, 1) |
| Press | 80 ms to scale 0.97 | out-cubic |
| Fade in / out | 200 / 160 ms | out-cubic / in-out (0.65, 0, 0.35, 1) |
| Toast in / hold / out | 240 ms (`spring-pop`) / 3.5 s / 180 ms | — |
| Tooltip delay | 350 ms | — |

**Number tick-ups (LM, Shine, Cell):**
- Duration = clamp(350 + 220 × log10(|Δ|), 350, 1200) ms, ease-out-expo.
- Tabular numerals; the digits roll, the layout never shifts.
- Income flashes `lumen-gold` and fades over 600 ms. A "+X LM" floater rises 24 px over 900 ms.
- Three or more increments within 500 ms merge into one tick-up.
- Shine ticks with 2 decimals and pulses ivory on the Inspector's Stamp.

**Purchase feedback (Requisitions Desk / Ops Console):**

| t | Event |
|---|---|
| 0 ms | Button press 0.97 (`spring-snap`); audio cue |
| 80 ms | LM ticks down (300 ms, no gold flash); item card glows teal; check-mark draws (240 ms) |
| 120 ms | Toast "Requisition approved" (`spring-pop`) |
| 400 ms | Item slides into the Holster slot or the Promotions node fills (`spring-ui`) |
| Insufficient LM | Horizontal shake 6 px × 3 over 300 ms + `danger` outline. Reduced motion: outline flash only |

**Reduced motion (OS setting or in-game):** springs become 120 ms opacity fades, with no shake, no overshoot and no floaters; tick-ups jump with a 1-frame highlight; camera shake off.

**Performance:** animate transform/opacity only. HUD numbers update ≤ 10 Hz outside tick-ups. Never animate `backdrop-filter`.

### 8.8 UI accessibility

Subtitles and captions (audio-direction §9). Color-blind modes (deuteranopia, protanopia, tritanopia) remap plot-state and player colors and add the numeral and plot-state glyphs. HUD scale 80–150%. Full keyboard and gamepad navigation. Text never sits on a bare world background.

---

## 9. Polygon and texture budgets

Triangle counts are LOD0 → LOD1 → LOD2 → LOD3/impostor. Textures are KTX2 (UASTC for normals and hero, ETC1S for bulk) via glTF-Transform with meshopt. Per-frame totals (draw calls, triangles, texture pool) are in [rendering-pipeline §14](../architecture/rendering-pipeline.md#14-quality-presets--the-canonical-preset-table-contract-sharedrenderqualityts), the canonical preset table. How each asset class is produced: §13.

| Asset class | Triangles | Texture set | Materials / draws | Bones / notes |
|---|---|---|---|---|
| Custodian (incl. helmet, pack, Dust Cell) | 18k → 8k → 3k → 600 | 2048² base/ORM/normal + 512² livery/player mask | ≤ 3 | ≤ 64 bones, 4 influences. 16 instances visible |
| Hand tool | 1.5–4k → 800 → 200 | Shared 2048² tool atlas | 1 | Attached to the hand socket |
| Trundle / Skiff | 8k / 15k → ½ → ¼ | 2048² per vehicle (trim-sheet heavy) | ≤ 3 | Wheels instanced |
| Carryall / Bulldust | 25k / 35k → ½ → ¼ → impostor | 2048² | ≤ 4 | — |
| Behemoth | 60k → 30k → 12k → impostor | 2 × 2048² | ≤ 5 | Tracks via skinned treads or UV scroll |
| Sandpiper / Plover / Albatross | 4k / 7k / 10k → ½ → ¼ | 1024² shared robot atlas | 1–2 | Instanced skinning (≤ 24 bones) |
| Outpost module | 20–40k per module; whole outpost ≤ 250k | 2 shared 2048² trim sheets + 2048² decal atlas | Trim-sheet shared | BatchedMesh |
| Build piece (Deck Plate, Panel…) | 200–600 → 60 | Finish trim sheet (shared) | 1 per finish | Instanced/BatchedMesh |
| Machines (Puck Former, Bead Kiln, Tile Sinterer…) | 6–15k → ½ → ¼ | Trim sheets + 1024² hero | ≤ 3 | — |
| Dust Puck / Bale / Sinter Tile | 300 → 60 → 12 / 400 / 100 | Shared 512² props atlas | Instanced | Thousands visible |
| Rocks | 1–3k → 300 → 60 (5 variants × 3 sizes) | 1024² per size class + detail normal | Instanced | Grime top mask from the plot scalar |
| Terrain | CDLOD (ADR-0008); near-field vertex spacing 0.25–0.5 m | Detail/normal sets 2048² (stochastic), macro from CGI Moon Kit (≤ 4k) | — | — |
| Earth | 2k sphere | Color and night lights (Blue/Black Marble), capped at 2048×1024; per-preset size in rendering-pipeline §14 | 1 | — |
| Stars | Point list (≈ 9k, mag ≤ 6.5, HYG) | none | 1 | — |
| VFX | GPU particles (budgets per preset) | 1024² VFX atlas (stamp emblem, sparks, plume) | — | — |
| UI | DOM/SVG | Icons SVG; fonts woff2 | — | No bitmaps |

**Download budgets** (browser-feasibility): ≤ 20 MB to the Clock In lobby, ≤ 40–50 MB to a full first session on Low/Medium, High/Ultra packs streamed (≤ 250 MB total).

---

## 10. LOD rules

| Rule | Spec |
|---|---|
| Selection | Screen-height fraction, not distance, with a per-preset bias. 10% hysteresis |
| Transition | Dithered or temporal crossfade 0.25 s (TRAA-friendly). Hard swaps only beyond 100 m or behind the horizon |
| No-pop zone | 0–25 m: no LOD change on objects > 0.5 m |
| Geometric error | ≤ 1 px (High/Ultra), ≤ 2 px (Low/Medium) at 25–100 m |
| Impostors | Octahedral impostors for vehicles, robots, outposts and rocks > 1 m beyond 150 m or behind the horizon (elevated views) |
| Characters | LOD by screen size. Animation update rate drops to 15 Hz beyond 40 m. Name tags persist |
| Materials | Far LODs collapse to 1 material. Sparkle, lane stripes and footprints fade out by distance before the LOD change |
| Terrain | CDLOD geomorph, never popping. Horizon silhouettes stable |
| Shadows | Shadow-caster LOD one step coarser than the view LOD beyond cascade 0 |

---

## 11. Asset sourcing policy

From [`asset-and-data-licensing.md` §11](../research/asset-and-data-licensing.md#11-approved-sources-and-do-not-use-list). Every file is logged in the asset manifest (source URL, author, license + version, download date, modifications, checksum).

| Source | Status | Commit raw files? | Notes |
|---|---|---|---|
| Our own original work | ✅ Preferred | Yes | Default for characters, vehicles, robots, buildings, UI. Production path: §13 |
| **Poly Haven** (CC0) | ✅ | Yes | Manual download, no bulk scraping |
| **ambientCG** (CC0) | ✅ | Yes | Regolith detail and metal/paint base materials. Photographic regolith/rock textures carry Earth colour and vegetation tints: **desaturate, then match to the albedo chart** (§2.3) before use |
| **Kenney** (CC0) | ✅ | Yes (keep the license file) | Placeholders, UI sounds, animations |
| NASA SVS CGI Moon Kit, LOLA LDEMs (PDS), LROC **PDS copies only**, Blue/Black Marble | ✅ with credit | Small derivatives only; raw outside git | Credits: "NASA's Scientific Visualization Studio", "NASA/GSFC/Arizona State University", "NASA Earth Observatory / NASA Visible Earth". **No NASA insignia/logotype/seal, no implied endorsement, no likeness of real astronauts** |
| **HYG v4.x** stars (CC BY-SA 4.0) | ✅ | Yes, as a **separate file** with its own BY-SA notice | Never merge it into CC0-labelled packs. The bake uses no Gaia cross-identifier or Gaia-derived column (rendering-pipeline §6). Yale Bright Star Catalogue under evaluation as a share-alike-free alternative |
| Google Fonts (OFL): Inter, Space Grotesk, JetBrains Mono | ✅ | Yes + `OFL.txt` | Verify each license tab |
| Lucide (ISC) | ✅ | Yes + license | — |
| CMU mocap (original site data) | ⚠ Human confirmation | Probably | Not the 4TU NC conversion |
| **Quaternius** (QAL v1.0) | ⚠ Prototype only | **Never committed** | Private storage; replace before ship unless a human approves |
| **Mixamo** | ⚠ Prototype only | **Never committed** | Private storage; replace before ship |
| **Sonniss / Pixabay** | ⚠ Human decision | **Never committed** | See audio-direction §8 |
| **Gaia** data, NASA SVS Deep Star Maps (contains Gaia DR2) | ❌ | — | Excluded by policy. The licence wording (recorded as NC; reported as possibly CC BY-SA 3.0 IGO) is being verified by docs-keeper from the primary source; the exclusion stands either way |
| LROC website images (non-PDS), Freesound NC/Sampling+, any NC/ND asset | ❌ | — | — |
| Anything from Moon Sweepers or the Roblox games (images, models, audio, UI, fonts, palettes) | ❌ | — | Links only, for comparison |
| Unlicensed web finds, ripped assets, "free wallpapers" | ❌ | — | — |
| AI-generated images, textures or meshes | ⚠ Only as [OPEN_QUESTIONS Q15](../OPEN_QUESTIONS.md) allows: a tool whose terms grant commercial rights, lead approval per asset, disclosed in Credits and the asset ledger | — | Never combined with NASA identifiers, never imitating the reference games, logged in the manifest. Not used until Q15 is closed (§13) |

---

## 12. Open items for the lead

| # | Item | Default if no decision |
|---|---|---|
| 1 | Final contract radius (ADR-0007/0008) | R = 2,000 m Standard (resolved); visual-target §2.5 re-derived |
| 2 | Lane-stripe data | **Decided:** separate R8 stroke-direction textures beside the atlas and ring (§3.4); stripes on Medium/High/Ultra. Requested from world-and-dust-simulation §7.2/§7.5 |
| 6 | 3D art production path (custodian, tools, vehicles, robots, outpost) | **Specified in §13**, consistent with D5 / OPEN_QUESTIONS Q23; the lead records the ADR before M1-S9 |
| 7 | Commissioned art budget | None assumed; §13 works without it. If Cee funds it, the custodian base mesh is the first candidate |
| 3 | Vehicles in MVP scope? | Resolved: Trundle and Skiff are in MVP ([scope-tiers](scope-tiers.md)); VM-09 is an M1 moment |
| 4 | Livery display names | Resolved: naming-bible A6 |
| 5 | Player-color display names | Resolved: naming-bible A6 |

---

## 13. Asset production plan

The look depends on the custodian, tools, vehicles, robots and outpost hardware more than on any shader. "Primitive-assembled capsules and boxes" is the most likely way to end up as a cheap browser game, so this section fixes **who makes each asset, with what, to what bar, and when**. The lead records it as an ADR (§12 item 6). Wave scheduling of these tasks belongs to the milestone files (requested in the planning-fix report).

### 13.1 Sources, in order of preference

| # | Source | Used for | Rules |
| --- | --- | --- | --- |
| 1 | **Original work by agents, scripted and reproducible**: `technical-artist` (meshes, UVs, trim sheets, materials, LODs, KTX2 export) and `animation-engineer` (rigs, skinning, animation) | Everything the player looks at: custodian, tools, vehicles, robots, outpost kit, machines, build pieces, props | This is decision D5 / [OPEN_QUESTIONS Q23](../OPEN_QUESTIONS.md). Scripts in `tools/asset-pipeline/` build each asset from parameters (procedural modelling: bevelled panels, rounded-rect shells, swept tubes, panel lines, arrayed fasteners) plus a **shared kitbash library** authored once (fasteners, hinges, vents, lamps, hazard tabs, hoses, wheel/track sets). Bevelled high-poly → baked normal and AO onto the game mesh; trim-sheet UVs for hardware; glTF → glTF-Transform (meshopt, KTX2). **Preferred tool: headless Blender** (`blender -b --python`, scripts in `tools/asset-pipeline/blender/`; Blender is GPL, its *output* is ours), which gives proper bevels, booleans, bakes and rigging. Its install is Cee's call (Q23); without it the same scripts target the Node path (three.js geometry + glTF-Transform), with rigs built in code |
| 2 | **CC0 libraries**: Poly Haven, ambientCG, Kenney | Base materials and texture inputs (metal, paint, rubber, regolith detail after the desaturate-and-calibrate step, §11); reference-quality kitbash greebles from Poly Haven models; Kenney only for placeholders | Manual download, manifest entry per file. Never used unmodified for a hero silhouette |
| 3 | **Commissioned art (optional)** | First candidate: custodian base mesh and helmet; second: Behemoth | Only if Cee funds it (§12 item 7). Work-for-hire or exclusive commercial licence, logged in the manifest. The plan does not depend on it |
| 4 | **AI-generated** | Nothing in the current plan | Only after [OPEN_QUESTIONS Q15](../OPEN_QUESTIONS.md) is closed: tool terms grant commercial rights, lead approval per asset, disclosed in Credits and the ledger (§11) |
| ✗ | Mixamo, Quaternius, CMU mocap | Prototype animation only (private storage, never committed) | CMU needs the human confirmation in §11; Mixamo and Quaternius are replaced before ship |

**Animation path.** Original keyframed clips authored by `animation-engineer` in Blender (scripted pose libraries + hand-keyed curves), plus in-engine procedural layers that carry most of the low-g feel: foot IK, landing compression, stride-hang timing, tool sway, vehicle suspension. Base set for MVP: idle (2 variants), walk, lope, jump/land, turn-in-place, 6 tool strokes, holster swap, Ballast Soles toggle, Dust Cell tap, Earth glance. Mocap is optional polish, never a dependency.

### 13.2 Asset classes: producer, budget, milestone

Budgets are those of §9; "MVP" = M1 (`v0.2.0`), "v1.0" = M2.

| Asset class | Producer / method | Budget (§9) | Needed for MVP | Needed for v1.0 |
| --- | --- | --- | --- | --- |
| Custodian (suit, helmet, pack, Dust Cell, 8 faces) | technical-artist: parametric suit shells + kitbash; animation-engineer: rig ≤ 64 bones | 18k → 600 tris, 2048² + 512² mask | **Yes**: one suit, Trainee + Custodian liveries, 16 player-colour slots, Crown Lamp levels | All 5 liveries, Commendation cosmetics, dust patina |
| Hand tools (6) + Assembly Gun | technical-artist, shared tool atlas | 1.5–4k tris, 2048² atlas | T1–T4: Desk Duster, Crescent Squeegee, Bristle Broom, Lane Broom ([scope-tiers](scope-tiers.md)) | + Static Rake, Ion Curtain, Assembly Gun |
| Vehicles | technical-artist; animation-engineer for suspension/drum/articulation | §9 rows | Trundle and Skiff (in MVP scope per scope-tiers) + pre-built Motor Pool | All five |
| Robots + Roost/Nests | technical-artist + animation-engineer (instanced skinning ≤ 24 bones) | §9 rows | No | Sandpiper, Plover, Albatross, Roost, Nests |
| Outpost kit (Boreal first) | technical-artist: modular kit on 2 trim sheets + decal atlas | ≤ 250k per outpost | Boreal: modules, Assay Counter, Requisitions Desk, Ops Console, Relay Pad, signage, work lights | 4 outposts (accent variants), Motor Pool, Receiving Gate, Railshot |
| Machines, logistics, build pieces | technical-artist, trim-sheet driven | §9 rows | No | All (§7.2–7.3), 5 finishes |
| Rocks, small craters | technical-artist: procedural Blender rock generator (5 variants × 3 sizes) + terrain procedural craters | §9 rows | **Yes** | Survey Point hero detail |
| Props (Dust Puck, Bale, Sinter Tile, Stray Cargo) | technical-artist | §9 rows | Dust Puck (Assay Counter pour) | All |
| VFX textures, decals, signage | technical-artist (vector-authored, then rasterised) | 1024² VFX atlas, 2048² decal atlas | Stamp emblem, grains, Brightside signage set | All |

### 13.3 Quality bar for "final" (replaces judging by eye)

| Check | Bar |
| --- | --- |
| Turntable | 1080p, 8 views at 45°, noon and night-near lighting, rendered by the screenshot harness (VT-M1-35) |
| Silhouette | Identifiable at 32 px tall (custodian, VT-M1-18), at 60 m (vehicles), at 20 m (robots) |
| Curvature | Hero cylinders and domes ≥ 24 segments per 360° at LOD0; no visible faceting on a silhouette at 3 m |
| Bevels | Every hard edge on hardware has a baked bevel highlight visible at 3 m in sunlight |
| Texel density | Custodian ≥ 512 px/m; hand tools ≥ 1024 px/m; vehicles and outpost hardware ≥ 256 px/m via trim sheets |
| Palette | §5.1 shares measured on the turntable (yellow ≤ 10 % of visible area) |
| Budgets | §9 triangles, textures, materials and bones; LOD chain present |

### 13.4 Placeholder policy

| Rule | Detail |
| --- | --- |
| Blockout first, but correct | A placeholder must already have **final proportions and scale, final pivots and sockets, final material slots (including the player-colour mask) and the final shader**. Only modelling detail and texture fidelity may be missing |
| Tagged | Manifest field `placeholder: true` plus the milestone by which it is replaced. Captures that contain a placeholder say so in the sidecar and `index.md` |
| Judging | Placeholders are exempt from VT-M1-18/20/21 and the turntable bar only until their replace-by milestone; they are never exempt from proportion (VT-M1-18 helmet-heights) or palette rules |
| Sources | Primitive or Kenney (CC0) blockouts may be committed; Mixamo/Quaternius placeholders stay in private storage |
| Ship rule | No placeholder in a `v1.0.0` build; none in a comparator (CMP) or store-capsule shot at a milestone gate |

### 13.5 Order of work

The M1 plan already schedules most of this (M1-W3-T07 blockout custodian + Desk Duster v0 + grains v0; M1-W4-T07 production suit + T1–T4; M1-W5-T03 Boreal hero hardware; W5–W7 outpost kit and vehicles). This file adds the following, requested from the milestone files:

1. **M0:** the asset pipeline (Blender headless if installed, else the Node path) proven end-to-end on one rock and one outpost module, plus kitbash library v0; the turntable capture in the screenshot harness.
2. **M1-W3:** the blockout custodian meets §13.4 (final proportions, final shader, player-colour slots), not just a 32 px silhouette.
3. **M1-W4:** custodian final mesh + rig + MVP clip set (§13.1) together with T1–T4, judged by VT-M1-35.
4. **M1-W5–W7:** Boreal hero hardware, rocks final, signage, Trundle and Skiff, each with a turntable.
5. **M2:** Static Rake, Ion Curtain, the other three vehicles, robots, machines, build pieces, other outposts, liveries.
