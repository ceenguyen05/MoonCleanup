# Visual Analysis: Reference Games, Real Lunar Appearance, and the "Comparable or Better" Bar

**Date:** 2026-11-11 · **Author:** research subagent P1d · **Scope:** a reference board (links only), a visual breakdown of Moon Sweepers and a shorter one of the Roblox moon-cleaning games, physically based lunar appearance facts for art direction, and measurable quality criteria plus the MVP "visual moments". This is a planning document. It contains no code.

> **Verification legend.** **[F]** = page fetched in this session. **[S]** = URL and claim seen in web-search results; the primary page was not opened. **[K]** = well-known official URL that was *not* re-verified this session (check before relying on it). Confidence levels: **High / Med / Low**. The parallel sub-research forks were cut off by a usage limit, so some planned verifications did not happen. Those gaps are flagged below.

---

## Executive summary

1. **Moon Sweepers is stylised, not realistic** (High, from viewing all 15 official Steam screenshots [1][2]). It has chibi astronauts with cartoon "LED-eye" visors, toy-like white and orange hard-surface vehicles and modules, bright high-key exposure, lavender-grey regolith with stylised pebble decals, soft blue-tinted shadows, a blue nebula-tinted sky, and a photographic Earth. **We can beat it on realism. It is strong on readability and charm.**
2. **Its core read: clean = brighter and smoother.** A swept strip is a near-white flat band with a stepped "dust-layer lip" at the edge, and the strokes are visibly rectangular and brush-width. From a distance, cleaned areas read as white patches. Players even "draw" on hillsides (shot 07) [2].
3. **Its shortfalls against our bar:** wide, soft shadow penumbrae; ambient light that looks like sky fill; a non-black sky with nebula; snow-like albedo; low micro-contrast; smooth, blobby hills with almost no rocks; a repeating pebble decal; chunky mesh "pebble" particles instead of fine ballistic dust; an asteroid-like Moon in the map view; no visible opposition-surge or backscatter shading. Press and player reports also cite performance issues after launch [5][6].
4. **Real regolith is dark.** The Moon's geometric albedo is 0.12 and its Bond albedo 0.11 [7]. It looks bright only because it sits against a black sky under unfiltered sun (High).
5. **The opposition surge is the signature lunar look.** Brightness rises more than 40% between 4° and 0° phase. The effect is mostly shadow-hiding, with half-width about 8°, plus a narrow coherent-backscatter spike under 2° on bright highlands, and it is about 10% stronger in highlands than maria [8][9]. Looking down-sun, the ground glows and flattens. Looking up-sun, it is dark and contrasty (High).
6. **No atmosphere** means a black sky, no aerial perspective and no haze at any distance, and no stars in correctly exposed daylight frames [10][11] (High).
7. **Sun:** 1361 W/m² at the Moon [7] (High) and about 133.8 klx luminous [12] (Med). The disk is about 0.53°, so the penumbra is about 9 mm per metre of occluder-to-ground distance (derived). Shadows are hard but not razor-edged.
8. **Shadow fill comes from the ground, not the sky.** NVIDIA's 2014 UE4 Apollo 11 demo showed that sunlight bouncing off regolith (and Armstrong's suit) lights Aldrin's shadowed side [13][14] (High).
9. **Earthshine:** a full Earth seen from the Moon is about 43 to 55 times brighter than a full Moon seen from Earth. One outlier claims about 100 times. Surface illuminance is about 10 lux (secondary source) [15][16][17] (Med). On the near side, local midnight coincides with roughly full Earth, so our lunar night should be blue-white earthlit, not pitch black.
10. **Physics gives us a "clean vs dirty" grammar.** LROC shows bright "blast zones" where lander exhaust smoothed the regolith, and resolves astronaut and rover tracks as photometric anomalies [18][19]. Swept and smoothed ground can legitimately read brighter at low phase. Trampled ground and tracks read darker (tracks darker: Med).
11. **Regolith holds crisp prints.** Armstrong said his boots sank "maybe an eighth of an inch", with tread visible, and the dust clung "like powdered charcoal" [20][21]. Dust follows pure ballistic arcs in 1.62 m/s² gravity [7] with no billowing. A 3 m/s grain launched at 45° flies 5.6 m over 2.6 s, against 0.9 m and 0.43 s on Earth (derived).
12. **Horizon:** at 1.7 m eye height on a 1737.4 km-radius Moon, the horizon is about 2.4 km away (derived from [7]). That is a short, legible draw distance we can make very detailed.
13. **The browser stack is ready.** WebGPU ships in Chrome/Edge 113+, Firefox 141+ (Windows) and Safari 26 [22]. three.js has `CSMShadowNode` for WebGPU [23]. Babylon.js CSM supports 2 to 4 cascades, default 4 [24].
14. **Proposed headline criteria:** 60 FPS at 1080p internal resolution on a discrete laptop GPU. 30+ FPS on integrated graphics at 0.67 to 0.75 render scale. Sun shadows with 4 × 2048² cascades, with cascade 0 at ≤ 1 cm/texel (it matches the physical penumbra). Near-camera regolith at ≥ 1024 px/m. A dust-mask texel of ≤ 2 cm near the player. Temporal AA. HUD in vector/DOM at native devicePixelRatio. See §4.

---

## 1. Reference board (links only; no images stored in the repo)

### 1.1 Moon Sweepers (DragDrop Games, Steam app 5335510)

- Steam store page: https://store.steampowered.com/app/5335510/Moon_Sweepers/ [F] [1]
- Steam appdetails JSON, which lists all official media: https://store.steampowered.com/api/appdetails?appids=5335510&l=english [F] [2]
- **Official screenshots (1920×1080, Steam CDN) [F]**. All 15 were viewed. The numbers match the analysis in §2.
  1. https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/6985c316ef6f0988ea33b17954c097268134e3d1/ss_6985c316ef6f0988ea33b17954c097268134e3d1.1920x1080.jpg (hero astronaut with broom, Earth, base)
  2. https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/76c76f72cc035c7e0fc49ea971e0bf1c6e1ba6fa/ss_76c76f72cc035c7e0fc49ea971e0bf1c6e1ba6fa.1920x1080.jpg (first-person clean strip, long shadow)
  3. https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/20a903f07aa2753cc99f11e26f08784f52ce5560/ss_20a903f07aa2753cc99f11e26f08784f52ce5560.1920x1080.jpg (co-op jump, ride-on sweeper, sun disk)
  4. https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/63b9ea049e9f963379a0c671043965a8241818f9/ss_63b9ea049e9f963379a0c671043965a8241818f9.1920x1080.jpg (van, modules, large Earth)
  5. https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/86c13ff24fc6eea6b8199b88a0fe3a6a6009febb/ss_86c13ff24fc6eea6b8199b88a0fe3a6a6009febb.1920x1080.jpg (toothbrush stroke, top-down)
  6. https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/e9fe23641e5bf08387202dcfabf5450a6a0c5de2/ss_e9fe23641e5bf08387202dcfabf5450a6a0c5de2.1920x1080.jpg (conveyor network)
  7. https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/dfa019b7d256412ddd4db7349da5c41d6e4407c6/ss_dfa019b7d256412ddd4db7349da5c41d6e4407c6.1920x1080.jpg (elevated base overview, cleaned ground)
  8. https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/e6a6a9f0cbc3e69d7e29091bc7dae19ba4727076/ss_e6a6a9f0cbc3e69d7e29091bc7dae19ba4727076.1920x1080.jpg (walk-behind sweeper, debris particles)
  9. https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/cdc8a6a06cf8d682b5e9b5cd2d740feb913bba2b/ss_cdc8a6a06cf8d682b5e9b5cd2d740feb913bba2b.1920x1080.jpg (street-sweeper truck, hill shadow)
  10. https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/bbba14e5a9ccae08e2bededc277afba9e3962095/ss_bbba14e5a9ccae08e2bededc277afba9e3962095.1920x1080.jpg (solar trackers, processing tank)
  11. https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/97f7ee1528784482fe81959261e1763fccede379/ss_97f7ee1528784482fe81959261e1763fccede379.1920x1080.jpg (solar farm, nebula sky)
  12. https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/991b71b20ad8ef79568f368fc1e345a1145bc484/ss_991b71b20ad8ef79568f368fc1e345a1145bc484.1920x1080.jpg (HQ exterior, colour-coded crew)
  13. https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/612ddb269880245e448d346a7cb25ae2bf6237c6/ss_612ddb269880245e448d346a7cb25ae2bf6237c6.1920x1080.jpg (HQ interior, hologram Moon)
  14. https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/6f2a63a4eff7c0623e98b8e2729584c00e0b7a63/ss_6f2a63a4eff7c0623e98b8e2729584c00e0b7a63.1920x1080.jpg (hologram and diegetic progress console)
  15. https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/6d77f6933fa6e920f33798c6ba3d030716ce19c0/page_bg_raw.jpg is the page background. The 15th screenshot is https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/ca461417b7dd6a6a4953a1723e29c1daf59ae2f1/ss_ca461417b7dd6a6a4953a1723e29c1daf59ae2f1.1920x1080.jpg (orbit/map view of the Moon).
- **Official trailers (Steam-hosted HLS) [F]:** "Teaser trailer" https://video.akamai.steamstatic.com/store_trailers/5335510/784761556/7f2635011f003ecf63a4665d7277f9f6d33d67ef/1792140508/hls_264_master.m3u8 and "Trailer" https://video.akamai.steamstatic.com/store_trailers/5335510/342788504/9486723f18c0b96095e59ab99919138b85a4cf77/1791452192/hls_264_master.m3u8. Both play on the store page. They were **not viewed** because no video decoder was available and installs were not allowed.
- No YouTube trailer URL or devlog could be confirmed. The store page links YouTube and TikTok channels but names no video [1]. A press release on Netto's Game Room has an empty "Trailer:" slot [5]. Steam news hub for devlogs: https://store.steampowered.com/news/app/5335510 [K].
- Press: PC Games Hardware (DE) https://www.pcgameshardware.de/Steam-Software-69900/News/Mondreinigungs-Simulation-Moon-Sweepers-dreht-bei-Steam-auf-1557786/ [S]; Netto's Game Room https://www.nettosgameroom.com/2026/10/16-player-moon-cleaning-game-moon.html [F]; dlcompare https://www.dlcompare.com/gaming-news/moon-sweepers-cleaning-has-never-been-so-popular [S].

### 1.2 Roblox games (official pages; thumbnails not inspected)

- **Sweep The Moon** (DomBlox Games, per search snippet): https://www.roblox.com/games/109576450376407/Sweep-The-Moon [S]
- **Clean The Moon!**. Two similarly named experiences exist, and it is unclear which one the brief means:
  - Lunarlit Works: https://www.roblox.com/games/76678170614451/Clean-the-Moon [S]
  - StaticStudios6: https://www.roblox.com/games/78086118798161/Clean-the-Moon [S]
  - A third, "Clean THE Moon": https://www.roblox.com/games/73695758197534/Clean-THE-Moon [S]

### 1.3 Realistic lunar photo and data references

- Clementine 750 nm albedo mosaic of the near side (maria dark, highlands bright), PIA00302: https://photojournal.jpl.nasa.gov/catalog/PIA00302 [S]
- LROC "First Look at the Apollo Landing Sites" (blast zones, tracks): https://lroc.im-ldi.com/posts/157 (also https://www.lroc.asu.edu/images/157) [S]. LROC home and featured images: https://lroc.im-ldi.com/ [S, domain seen; home not opened]
- NASA Apollo 11 landing site resource: https://science.nasa.gov/resource/apollo-11-landing-site [S]
- NASA LRO view of the Apollo 12 and Surveyor 3 sites: https://www.nasa.gov/missions/lunar-reconnaissance-orbiter-looks-at-apollo-12-surveyor-3-landing-sites/ [S]
- Apollo 11 EVA transcript (Spacelog), including Armstrong's footprint and dust remarks: https://apollo11.spacelog.org/04:13:20:38/04:13:44:28 [S]
- Project Apollo Archive (Flickr, all Hasselblad magazines): https://www.flickr.com/photos/projectapolloarchive/ [K]
- NASA Image and Video Library: https://images.nasa.gov/ [K]. Iconic frames to pull: AS11-40-5903 (Aldrin, visor reflection, ground-bounce fill), AS11-40-5878 (bootprint), AS08-14-2383 (Earthrise) [K: IDs from memory].
- Apollo Lunar Surface Journal: https://www.hq.nasa.gov/alsj/ [K; may redirect to nasa.gov/history]
- NASA SVS CGI Moon Kit (LROC colour plus LOLA displacement maps for rendering): https://svs.gsfc.nasa.gov/4720 [K]
- NASA Moon Trek (web GIS): https://trek.nasa.gov/moon/ [K]. NASA Eyes on the Solar System (WebGL): https://eyes.nasa.gov/ [K]
- Artemis renders and concept art: https://www.nasa.gov/humans-in-space/artemis/ [K]. Search images.nasa.gov for "Artemis III" or "Human Landing System".

### 1.4 Best-in-class realistic lunar and space real-time visuals

- **NVIDIA Apollo 11 lunar landing demo** (UE4 plus VXGI, 2014). It reproduces the lighting of AS11-40-5903 through bounce light from the regolith and the suit. https://www.unrealengine.com/blog/download-ue4-apollo-demo-maxwell-gpus [S] [13]. Coverage: https://hothardware.com/news/nvidia-bust-apollo-11-landing-conspiracy-myth-with-maxwell-graphics-muscle [S]. 2019 RTX ray-traced remake: https://www.tomshardware.com/news/apollo-11-moon-landing-anniversary-nvidia-ray-tracing,39980.html [S] [14]
- Also worth benchmarking, by name only because their URLs were not verified this session: *Deliver Us The Moon* (KeokeN), *Starfield* moon surfaces, *Elite Dangerous: Odyssey* planetary surfaces, *Star Citizen* moons. Treat their quality claims as **unverified** here.

### 1.5 Browser quality proofs and engine docs

- web.dev, "WebGPU is now supported in major browsers" (2025-11-25): https://web.dev/blog/webgpu-supported-major-browsers [S] [22]
- three.js `CSMShadowNode` (WebGPU): https://threejs.org/docs/pages/CSMShadowNode.html [S] [23]. Legacy CSM (WebGL only): https://threejs.org/docs/pages/CSM.html [S]. Forum thread: https://discourse.threejs.org/t/cascaded-shadow-maps-csm-on-webgpu/84235 [S]. Virtual sun-shadow community project "Sundial": https://discourse.threejs.org/t/sundial-paged-virtual-sun-shadows-for-three-js-webgpurenderer-mit-on-npm/94912 [S]
- Babylon.js Cascaded Shadow Maps doc (mirror): https://documentation-17aey64q4-babylonjs.vercel.app/divingDeeper/lights/shadows_csm [S] [24]
- Showcase hubs to mine for comparisons (not re-verified): https://threejs.org/examples/ , https://www.babylonjs.com/community/ , https://playcanvas.com/explore [K]

---

## 2. Visual breakdown

### 2.1 Moon Sweepers (from the 15 official screenshots [2] plus store and press text [1][5])

Style verdict (High): this is a **cosy, toy-like stylised sim on a semi-realistic ground plane**. It is not trying to look like Apollo.

| Aspect | What the screenshots show | Assessment against our bar |
|---|---|---|
| **Sun / key light** | The sun is a small white disk with a glow halo, mid-high elevation (shot 3). Some shots have low sun and very long player shadows (2, 5). | Good drama in the long-shadow shots. The sun halo or bloom is plausible. |
| **Shadow quality** | Shadows are crisp near contact but have **wide, soft penumbrae** (the player's shadow edge blurs over many cm). They are tinted **blue-lavender** and moderately dark. Large hill-cast shadows appear (shot 9). Vehicles show contact AO. | Too soft and too blue for the Moon. The real penumbra is about 9 mm/m, and fill should be warm-grey ground bounce. |
| **Ambient / fill** | Strong, uniform, sky-like ambient. Low overall contrast and high-key exposure. | "Flat lighting" in most exteriors. |
| **Night** | No lunar-night screenshot is shown. | Unknown. This is an opportunity for us. |
| **Regolith** | Lavender-grey base with a scatter of **stylised faceted pebble and dimple decals**. Hills are **smooth, blobby, low-frequency**, with almost no boulders, ejecta or crater rims at gameplay scale. A visible **repeating pebble pattern** at 1:1 (shots 2, 5). Overall albedo reads snow-white, especially on cleaned ground. | The weakest area relative to realism. There is no micro-relief, no backscatter response, and repetition is visible. |
| **Dust layer / clean vs dirty** | A clean stroke is a **brush-width rectangle** with square ends. Inside it is a smooth, flat, brighter surface. The edge is a **stepped lip** (lit top, shaded side) that implies layer thickness (shot 5 at 1:1). From afar, cleaned ground reads as white areas. Hillsides carry player-drawn shapes (shot 7). | **Excellent readability and gameplay feedback.** The stepped edge sells "layer removed". It is grid-like and stylised, though. |
| **Hard surfaces** | White/orange/navy modules, trucks, a VW-bus-like van, solar trackers and conveyors. Clean PBR (glass, rubber, painted metal). Well modelled. | Polished and coherent. A toy aesthetic, not NASA hardware. |
| **Suits / characters** | Chibi astronauts with oversized helmets and black visors showing emissive cartoon eyes. Per-player colour trims (yellow, cyan, pink, red). | Strong identity and co-op readability (colour = player). |
| **Particles / FX** | Brooms and brushes emit **dark-grey chunky mesh pebbles** that pile up beside the brush (shots 2, 8, 9). No fine dust sheets or ballistic plumes are visible. Low-gravity jumping (shot 3). | Not lunar-like. Real dust is fine, bright-ish and ballistic, with no hanging clouds. |
| **Sky** | Starfield with a **blue nebula gradient** (shots 1, 11, 15). The Earth is a photographic texture with a blue limb glow and a terminator, rendered large. | The nebula and blue sky are wrong for the Moon. The Earth is attractive but oversized in some shots. |
| **Camera** | First person (shots 2, 5, toothbrush or broom in view) and third person (shots 1, 3, 8, 10, 12). Elevated overview (shot 7). Orbit/map view (shot 15). FOV looks about 80–90° horizontal in first person (estimate, Low). | Both modes exist. Store tags include "First-Person" [1]. |
| **Map / orbit** | A tiny, lumpy, asteroid-like cratered globe on a nebula background. | Physically wrong (the Moon is nearly spherical). |
| **UI / HUD** | **No HUD appears in any store screenshot.** The only UI visible is diegetic: a holographic blue wireframe Moon and a console screen reading roughly "148 SECTORS CLEAN … LIVE" (shots 13, 14) in a white/orange interior with hex floor graphics. | HUD layout and typography could not be verified. The diegetic progress display is a good idea. |
| **Image quality** | Clean edges with no visible jaggies at 1080p, consistent with temporal AA. There is mild softness. One stray white line artefact on the ground (shot 9). | Fine. Store shots are curated. |

What makes it look good: a coherent palette (white/orange/navy against grey), strong silhouettes, expressive characters, immediate stroke feedback, the hologram and interior set-pieces, and big readable machines.

Where it falls short of realism: the sky colour and nebula, soft blue shadows with sky-like fill, snow-like ground albedo, low micro-contrast, blobby terrain with no rocks, decal repetition, pebble-chunk particles, no opposition-surge or backscatter, and a non-physical map Moon.

Reported technical issues: the developer acknowledged post-launch technical problems, and players reported performance and multiplayer bugs (Med; via press summary) [6]. Specs: minimum GTX 1650 / RX 570 / DX11, recommended GTX 1660 Super / RX 5600 XT / DX12, Windows only [1]. The engine is not stated on the store page [1]. Reviews: "Mostly Positive", 78% of 4,380 English reviews at access time [1]. Up to 16-player co-op; collect dust, deliver it to a depot, launch shipments, buy tools and vehicles [1][5].

### 2.2 Roblox games (brief; **not visually inspected**)

The thumbnail check was cut for budget. All claims come from search snippets of the official Roblox pages [S] (Low–Med).

- **Sweep The Moon** (DomBlox Games) is described as tile-by-tile sweeping "inspired by Moon Sweepers": toothbrush start, sell dust, robots, bigger sweepers, up to 4 players.
- **Clean The Moon!** (Lunarlit Works) is an incremental game: sweep dust and debris, sell, automate with robots. Another **Clean The Moon!** (StaticStudios6) adds vehicles, pets, rebirths and digging.
- Expect Roblox-engine visuals (simple materials, platform lighting). "Tile-by-tile" implies **coarse, cell-quantised cleaning**. Our continuous high-resolution dust mask is an easy differentiator. Verify by viewing the official thumbnails at the URLs above.

---

## 3. Physically based lunar appearance (art-direction facts)

| # | Fact | Value | Source | Conf. |
|---|---|---|---|---|
| 3.1 | Moon albedo | Geometric (visual) 0.12, Bond 0.11 | NASA Moon Fact Sheet [7] [F] | High |
| 3.2 | Maria vs highlands | Maria are clearly darker than highlands at 750 nm (Clementine). Maria cover about 16% of the surface. Commonly quoted normal albedos are ~0.07–0.10 (maria) and ~0.11–0.18 (highlands), and fresh ray craters are brighter | Clementine PIA00302 [25] [S]. The numeric ranges are **UNVERIFIED** this session | Ratio High, numbers Low |
| 3.3 | Opposition surge | More than 40% brightening from 4° to 0° phase. Mostly shadow-hiding (half-width ~8°) plus a narrow (<2°) coherent-backscatter component on bright highlands. About 10% stronger in highlands. Hapke et al. 1998 found both mechanisms significant | Buratti, Hillier & Wang 1996, *Icarus* 124; Hillier, Buratti & Hill 1999, *Icarus* 141; Hapke et al. 1998, *Icarus* 133. Read via search summaries [8][9] | High (direction), Med (numbers) |
| 3.4 | Heiligenschein | A bright glow around the observer's own shadow (zero phase). It follows from 3.3 and is visible in Apollo frames | Physics [8][9]. Specific frame IDs not verified | Med |
| 3.5 | Weak limb darkening | The full Moon looks like a flat disk. Lunar scattering is close to Lommel-Seeliger ("lunar-Lambert", McEwen), not Lambertian | Background knowledge; no source fetched this session | Med |
| 3.6 | Black sky, no haze | No atmosphere means no scattering, so the sky is black and there is no aerial perspective | [10][11] [S] | High |
| 3.7 | No stars in daylight photos | Exposures set for sunlit surfaces and suits are far too short and narrow for stars | [10][11] [S] (secondary). The Science@NASA "Great Moon Hoax" article (2001) was not retrieved | High |
| 3.8 | Sunlight | 1361 W/m² [7] [F]. Luminous ≈ 133.8 klx (Kittler & Darula, after Darula, Kittler & Gueymard 2005, *Solar Energy* 79) [12] [S]. Sun is white in space (photosphere ≈ 5772 K, not fetched) | [7][12] | High / Med |
| 3.9 | Sun angular size and penumbra | ≈0.53° (from R☉ ≈ 695,700 km at 1 AU; inputs not fetched). The Moon's own disk is 1896″ ≈ 0.53° from Earth [7]. **Penumbra width ≈ 0.0093 × d**: 9 mm at 1 m, 4.6 cm at 5 m, 9 cm at 10 m from the occluding edge | Derived | High (math) |
| 3.10 | Shadow fill | Shadowed surfaces are lit by sunlight bounced from regolith and nearby bright objects (suits, LM). This is what NVIDIA's VXGI demo reproduced for AS11-40-5903 | [13][14] [S] | High |
| 3.11 | Earth in sky | Angular diameter ≈ 1.9° (12,742 km / 384,400 km, inputs not fetched) | Derived | High (math) |
| 3.12 | Earthshine | Full Earth seen from the Moon is about 43× (Siegel) to "over 50×" (NASA 2005) brighter than full Moon from Earth. Asterism says about 100× (outlier). About 10–11 lux on the surface (secondary, Vsauce digest). Brightness varies with clouds and ice | [15][16][17] [S] | Med |
| 3.13 | Night geometry | Synodic period 29.53 d [7], so local day and night each last about 14.8 d. On the near side the Earth hangs nearly fixed in the sky (small libration wobble), and near-side midnight coincides with roughly full Earth. The Earth is never visible from the far side | [7] plus orbital geometry (not separately sourced) | High |
| 3.14 | Footprints | "I only go in a small fraction of an inch, maybe an eighth of an inch [≈3 mm], but I can see the footprints of my boots and the treads." Dust "adheres in fine layers like powdered charcoal" to the boots | Armstrong, Apollo 11 EVA [20][21] [S] | High |
| 3.15 | Dust on hardware | Dust caused vision obscuration, clogging, abrasion and thermal problems across all six landings, and ground tests underestimated it | Gaier, NASA/TM-2005-213610 (REV1 2007) [26] [S] | High |
| 3.16 | Ballistic dust | g = 1.62 m/s² [7]. In vacuum there is no drag, so grains follow parabolas and there are no clouds. At 45°: range v²/g, time √2·v/g. 1 m/s: 0.62 m / 0.87 s (Earth 0.10 m / 0.14 s). 2 m/s: 2.5 m / 1.75 s. 3 m/s: 5.6 m / 2.6 s, apex 1.4 m (Earth 0.9 m / 0.43 s / 0.23 m). LRV "rooster tails" and the Apollo 17 fender repair are the canonical footage (**not verified** this session) | [7] plus derived | High (math), Med (footage refs) |
| 3.17 | Disturbed regolith photometry | Lander exhaust creates **brighter "blast zones"** (metres wide for Surveyor, hundreds of metres for Apollo), still visible decades later. Astronaut and rover tracks are resolved. Rover tracks are most visible inside blast zones. Tracks generally appear darker (from memory, not verified) | LROC [18][19] [S] | High / Med |
| 3.18 | Colour | Neutral grey with a slight warm/brown cast and a red-sloped spectrum. Ti-rich maria are slightly bluer. Apollo 17 "orange soil" is a rare saturated exception | Background knowledge; **no source fetched** | Med |
| 3.19 | Horizon | d = √(2Rh) = √(2 × 1,737,400 m × 1.7 m) ≈ **2.43 km** (Earth ≈ 4.7 km) | Derived from [7] | High (math) |
| 3.20 | Apollo exposure lessons | High contrast. Sunlit surface near the top of the range, shadows dark but not black (bounce fill), black sky, no stars, little colour. Down-sun views look washed and flat; up-sun views look dark and textured | Synthesis of [8][10][13] | Med |

**Art-direction translation**
- Keep ground albedo low (~0.1–0.15 base colour). Get brightness from a strong sun and exposure, not white textures.
- Use an opposition-surge/backscatter BRDF term on regolith: a hotspot around the antisolar point and the player's shadow head.
- Make the sky black. Use no fog or haze at any distance. Show stars only when exposure adapts (shade, night, looking away from the sun).
- Keep the sun shadow hard, with a ~0.5° physically sized penumbra. Fill should be warm-grey ground bounce (GI, probes or a hemispheric "ground" term), never blue sky.
- Night: earthlight at about 10 lux, cool-white, from a fixed Earth about 1.9° wide, plus artificial lamps. This is a showcase opportunity.
- Clean-vs-dirty: swept or smoothed ground slightly brighter and less backscattering. Footprints and tracks darker and sharp-walled, ~3 mm deep for boots.
- Dust: fine bright-grey grains on clean parabolic arcs, no lingering puffs, and a fast settle at 1/6 g timescales.

---

## 4. Measurable "comparable or better" criteria and MVP visual moments

These are our proposed targets. They are engineering proposals, not sourced facts, unless a citation is given.

| Criterion | Discrete-GPU laptop (High) | Integrated GPU (Low) | Rationale |
|---|---|---|---|
| Frame time | 16.7 ms avg, p95 ≤ 20 ms | 33.3 ms avg, p95 ≤ 40 ms | Brief |
| Internal resolution | 1920×1080 (scale 1.0) | 0.67–0.75 of the output, temporal upscale | Store-shot parity is 1080p [2] |
| AA | Temporal AA plus a mild sharpen. FXAA/SMAA fallback | TAA or FXAA | Moon Sweepers shots show no jaggies |
| Sun shadows | 4 cascades × 2048². Cascade 0 covers ≤ ~20 m, so **≤ 1 cm/texel ≈ the physical penumbra at 1 m** (3.9). Filter width tied to 0.53° | 2 cascades × 1024², with contact-shadow help | Babylon CSM supports 2–4 [24]; three.js CSMShadowNode [23] |
| Regolith texel density | ≥ 1024 px/m within 5 m (detail/normal layers), ≥ 256 px/m at 50 m, no visible tiling at 1:1 (stochastic or variation blend) | ≥ 512 px/m near | MS shows repetition at 1:1 |
| Dust-mask (clean state) | ≤ 2 cm/texel near the player. Soft-but-crisp stroke edges with a visible layer lip. Continuous, not tile-quantised | ≤ 4 cm/texel | Beat MS's rectangle strokes and the Roblox tile cleaning |
| Draw distance | Full detail to the ~2.4 km horizon (3.19), far crater rims and massifs beyond via low-res heightfield. No LOD pop inside 200 m | Horizon at reduced terrain detail | Airless scenes reveal pop (no haze) |
| Particles | ≥ 50k live GPU dust grains (WebGPU compute), ballistic with g = 1.62 | ≥ 5–10k | 3.16 |
| Lighting stack | HDR, filmic tone map (AgX/ACES-class), subtle bloom on sun, lamps and Earth only. AO (GTAO-class) plus ground-bounce fill | HDR plus tone map, baked/cheap AO | Brief |
| Sky | Black sky. Physically scaled Earth (1.9°) with a real phase consistent with sun direction. Exposure-gated stars | Same (cheap) | 3.6–3.13 |
| UI | DOM or vector HUD rendered at devicePixelRatio, text ≥ 14 CSS px, no upscaled bitmaps, crisp at 2× DPR | Same | Brief |
| Platform | WebGPU first, WebGL2 fallback with the same art (fewer cascades and particles) | — | WebGPU in Chrome/Edge 113+, Firefox 141+ (Win), Safari 26 [22] |

**Side-by-side test:** recreate the compositions of Moon Sweepers shots 2, 3, 4, 5, 9 and 15 in our build. Compare them at 100% crop for shadow edge, ground detail, stroke edge, particle fidelity, sky and AA.

**MVP visual moments (must nail):**
1. **First sunrise:** sun at ~1–5° elevation, metres-long hard shadows raking every pebble and footprint, black sky, stars fading as exposure adapts.
2. **First clean stroke:** grains arcing ballistically away, a crisp darker-to-lighter layer reveal with a lip, and boot prints left at the stroke edge.
3. **Depot delivery and launch:** hardware with dusty grime, a burst of ballistic dust from the launch, and the plume shadow.
4. **Vehicle drive:** wheel rooster-tail parabolas, crisp tyre tracks, suspension bounce at 1/6 g.
5. **Night with lamp:** cool earthlight (Earth near full) plus a warm work lamp with hard shadows and bloom. Stars visible.
6. **Orbit/map view:** a correctly spherical Moon with real maria and highlands (SVS Moon Kit-class data [K]), cleaned regions as a visible overlay, the terminator, and Earth in frame.

---

## Contradictions & uncertainty

- **Earthshine brightness:** about 43× (Big Think), about 50–55× (NASA 2005 / Big Think upper range), about 100× (Asterism) [15][16][17]. Use 40–55× and treat ~100× as an outlier. The ~10–11 lux figure is secondary.
- **Opposition surge mechanism:** Buratti 1996 and Hillier 1999 say shadow-hiding dominates. Hapke 1998 says both mechanisms contribute significantly [8][9].
- **Luminous solar constant:** 133.8 klx comes from Kittler & Darula's later paper. The exact table in the 2005 paper was not verified [12].
- **Babylon CSM cascade range** (2–4) comes from an older docs mirror. Newer typings clamp to constants that may differ [24].
- **Roblox "Clean The Moon!":** several experiences share this name, and visit counts differ between aggregators. The thumbnails were not viewed.
- **Not verified this session:** Moon Sweepers trailers and HUD; numeric maria/highlands albedo; the "dark tracks" sign; LRV rooster-tail and fender footage; [K] URLs; the best-in-class game list beyond NVIDIA; Moon Sweepers' engine; the "two-person Finnish studio" claim (search summary only).

## Implications for our game

1. **Own look:** "Apollo-documentary realism plus premium industrial UI". Moon Sweepers occupies toy-cosy. We differentiate on light (hard sun, black sky, ground bounce, backscatter) and material truth (dark, detailed regolith).
2. **Keep their best idea in physical form:** instant, legible clean/dirty contrast. Make it with photometry (smoothing brightens at low phase, tracks darken) and a thin dust layer with real micro-relief, not just a white swap. Add a "clean-view" exposure or highlight overlay if readability suffers up-sun.
3. **Use player colour** on suit trims, lamps and UI to keep 16-player co-op readable against grey ground.
4. **Treat night as a feature:** earthlit plus lamps, the moment where we most clearly exceed the references.
5. **Budget for no haze:** without atmospheric fog, LOD transitions and distant tiling are fully exposed. Invest in a horizon-scale terrain pipeline and anti-tiling first.

## Sources

1. Moon Sweepers on Steam — https://store.steampowered.com/app/5335510/Moon_Sweepers/ — accessed 2026-11-11 — official store page [F]
2. Steam appdetails API, app 5335510 (screenshots/movies) — https://store.steampowered.com/api/appdetails?appids=5335510&l=english — accessed 2026-11-11 — official data [F]
3. PC Games Hardware, "'Mondreinigungs-Simulation' dreht bei Steam auf…" — https://www.pcgameshardware.de/Steam-Software-69900/News/Mondreinigungs-Simulation-Moon-Sweepers-dreht-bei-Steam-auf-1557786/ — accessed 2026-11-11 — press [S]
4. itechguides, "Clean a whole moon with a toothbrush in Moon Sweepers…" — https://www.itechguides.com/clean-a-whole-moon-with-a-toothbrush-in-moon-sweepers-the-powerwash-genres-latest-crime-against-perfectionists/ — accessed 2026-11-11 — press [S]
5. Netto's Game Room, "16 Player Moon Cleaning Game 'Moon Sweepers' is Out Now" — https://www.nettosgameroom.com/2026/10/16-player-moon-cleaning-game-moon.html — accessed 2026-11-11 — press release [F]
6. dlcompare, "Moon Sweepers: The Bizarre Game About Cleaning the Moon" — https://www.dlcompare.com/gaming-news/moon-sweepers-cleaning-has-never-been-so-popular — accessed 2026-11-11 — press [S]
7. NASA NSSDCA, Moon Fact Sheet (updated 11 Jan 2024) — https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html — accessed 2026-11-11 — NASA [F]
8. Opposition surge (summarising Buratti et al. 1996 *Icarus* 124; Hapke et al. 1998 *Icarus* 133; Hillier et al. 1999 *Icarus* 141) — https://en.wikipedia.org/wiki/Opposition_surge — accessed 2026-11-11 — encyclopedia [S]
9. NASA NTRS record (Clementine lunar photometry) — https://ntrs.nasa.gov/citations/19990098019 — and DPS 1998 abstract — https://aasarchives.blob.core.windows.net/archives/BAAS/v30n3/dps98/227.htm — accessed 2026-11-11 — NASA/AAS [S]
10. Royal Museums Greenwich, "Moon landing conspiracy theories debunked" — https://rmg.co.uk//stories/space-astronomy/moon-landing-conspiracy-theories-debunked — accessed 2026-11-11 — museum [S]
11. ASU Ask an Expert, "Was the Moon landing live?" — https://askanexpert.asu.edu/earthspace/top-question/moon-landing — accessed 2026-11-11 — university [S]
12. Darula, Kittler & Gueymard (2005) "Reference luminous solar constant…", *Solar Energy* 79:559–565, DOI 10.1016/j.solener.2005.01.004; value via Kittler & Darula — https://core.ac.uk/download/357192384.pdf — accessed 2026-11-11 — peer-reviewed [S]
13. Unreal Engine blog, "Download UE4 Apollo demo for Maxwell GPUs" (2014-11-11) — https://www.unrealengine.com/blog/download-ue4-apollo-demo-maxwell-gpus — accessed 2026-11-11 — official [S]
14. Tom's Hardware, "Nvidia Uses Ray Tracing to Recreate Apollo 11 Moon Landing" — https://www.tomshardware.com/news/apollo-11-moon-landing-anniversary-nvidia-ray-tracing,39980.html — accessed 2026-11-11 — press [S]
15. Big Think (E. Siegel), "From the Moon, how would the 'full Earth' compare?" — https://bigthink.com/?p=151561 — accessed 2026-11-11 — science journalism [S]
16. Science@NASA (2005, archived), "The Da Vinci Glow" — https://webarchive.library.unt.edu/eot2008/20090826110250/http://science.nasa.gov/headlines/y2005/04oct_leonardo.htm — accessed 2026-11-11 — NASA (archive) [S]
17. Astronomical League/Asterism, "How Bright is the Moon?" — https://asterism.org/2019/04/12/how-bright-is-the-moon/ — accessed 2026-11-11 — amateur astronomy [S]
18. LROC, "LROC's First Look at the Apollo Landing Sites" — https://lroc.im-ldi.com/posts/157 (alt. https://www.lroc.asu.edu/images/157) — accessed 2026-11-11 — mission team [S]
19. Universe Today, "NASA Releases Closer Looks at Apollo Landing Sites from LRO" — https://www.universetoday.com/88692/nasa-releases-closer-looks-at-apollo-landing-sites-from-the-lunar-reconnaissance-orbiter/ — accessed 2026-11-11 — press [S]
20. Earth Magazine, "Down to Earth With: Neil Armstrong" — https://www.earthmagazine.org/article/down-earth-neil-armstrong-first-astrogeologist-moon/ — accessed 2026-11-11 — magazine [S]
21. Apollo 11 Spacelog EVA transcript — https://apollo11.spacelog.org/04:13:20:38/04:13:44:28 — accessed 2026-11-11 — transcript (from NASA records) [S]
22. web.dev, "WebGPU is now supported in major browsers" — https://web.dev/blog/webgpu-supported-major-browsers — accessed 2026-11-11 — official (Google) [S]
23. three.js docs, CSMShadowNode — https://threejs.org/docs/pages/CSMShadowNode.html — accessed 2026-11-11 — official docs [S]
24. Babylon.js docs (mirror), Cascaded Shadow Maps — https://documentation-17aey64q4-babylonjs.vercel.app/divingDeeper/lights/shadows_csm — accessed 2026-11-11 — official docs mirror [S]
25. NASA/JPL Photojournal PIA00302, Clementine near-side albedo — https://photojournal.jpl.nasa.gov/catalog/PIA00302 — accessed 2026-11-11 — NASA [S]
26. Gaier, J.R., "The Effects of Lunar Dust on EVA Systems During the Apollo Missions", NASA/TM-2005-213610 (REV1 2007) — https://ntrs.nasa.gov/citations/20050160460 ; https://ntrs.nasa.gov/citations/20070021819 — accessed 2026-11-11 — NASA technical memo [S]
27. Roblox experience pages (Sweep The Moon; Clean The Moon! ×2; Clean THE Moon) — URLs in §1.2 — accessed 2026-11-11 — official platform [S]
