# Audio direction — Clean The Moon!

Direction: `docs/design/REFERENCE_TARGET.md` overrides retired naming/style/custom-gate rules.

Status: **Accepted for build (planning session 2026-11-12)** · Owner: audio-engineer · Related: [`art-direction.md`](art-direction.md) (departure D-17), [`visual-target.md`](visual-target.md), [`naming-bible.md`](naming-bible.md) (all names), [`../research/asset-and-data-licensing.md`](../research/asset-and-data-licensing.md) §8 (audio licensing), [`../architecture/tech-stack.md`](../architecture/tech-stack.md) (Opus/WebM + AAC fallback).

**Direction in one line:** you are inside a helmet on an airless world. Everything you hear arrives through the **suit, your body, the ground or the radio**. That makes it intimate, tactile and cheerful, with a **dry outdoor sound and no reverb**, which is our signature.

---

## 1. Vacuum premise

### 1.1 Hearing channels

| Channel | Physical basis | Carries | Processing | Audible when |
|---|---|---|---|---|
| **Suit interior** | Air inside the helmet | Breathing, suit fans and pumps, servo whirs, Hop Pack valves, helmet bumps | Full band, close, centered, tiny 2–4 ms helmet early reflection | Always |
| **Contact** (body conduction) | Through gloves, boots, seat | Your own tool on the ground, your footsteps, the vehicle you ride, objects you touch | Low-mid emphasis, high shelf −6 dB above 5 kHz, dry | While touching |
| **Ground conduction** | Through regolith and structures into the boots | Nearby machines, other custodians' vehicles and heavy tools, Railshot, Behemoth | Distance low-pass (≈ 8 kHz at 2 m → 400 Hz at 60 m), bass-forward, partly non-directional | Listener **and** source both grounded; fades out over 150 ms when you leave the ground |
| **Suit relay** (in fiction: Brightside suit sensors sonify nearby activity) | Departure D-17 | Light cues that would be inaudible: robots, other players' hand tools, Inspector's Stamp in the world, Flare Beacons | Band-limited 300 Hz–6 kHz, faint "sensor" grain, spatialized | Within 25 m |
| **Radio** | Comms | DOT, teammate pings, notifications, music (diegetic "suit radio" framing) | Radio chain: band-pass 300 Hz–3.4 kHz, light saturation, squelch click on and off (music is not band-passed by default; optional "radio music" toggle) | Anywhere |
| **Pressurized interior** (only if interiors ship) | Air | Normal acoustics, short room reverb | Full band + small convolution | Inside only: a deliberate "ears pop open" contrast |

### 1.2 Rules that follow from the premise

| Rule | Detail |
|---|---|
| No outdoor reverb, no echo, no Doppler | Silence around sounds is the lunar signature. Reverb only inside pressurized interiors |
| Jumping mutes the world | In the air (jump, Hop Pack, vehicle Hang Time), ground conduction fades out in 150 ms and only suit, contact (vehicle body) and radio remain. Landing brings the world back with a thump. This is our best tactile cue |
| Nothing is heard from far away | Hard cap: ground conduction 60 m (vehicles 120 m, Behemoth 200 m, Railshot 300 m). Suit relay 25 m. Beyond that, radio only |
| Big events are felt more than heard | Railshot, Behemoth and the Bead Kiln: sub-bass and controller rumble, with little top end |
| Ground state is audible | Brushing over **grime** gives a full, soft "shhh"; over **clean** ground it is thinner, higher and slightly squeaky. You can *hear* that a spot is done |

---

## 2. Sound palette

### 2.1 Hand tools (contact channel for your own tool; suit relay for others')

| Tool | Core layer | Detail layer | Signature | Parameter mapping |
|---|---|---|---|---|
| **Desk Duster** | Tiny circular bristle "swirl-swirl", high and dry (the palm-held puck brush is wiped in small circles, [art-direction §5.3](art-direction.md#53-hand-tools)) | Soft glove-on-plastic pat as the puck is re-gripped every few circles | Comedic and fussy: a small rising "fwip" at the end of each circle, like polishing a desk. No flick or "brushing teeth" rhythm, so it never echoes a toothbrush gag | Circle speed → swirl rate ±15%, gain |
| **Crescent Squeegee** | Crisp stiff-bristle swish | Grip creak | Snappier, rhythmic | Same |
| **Bristle Broom** | Long sweeping scrape | Aluminum shaft ring on direction change | Satisfying "push" with a tail | Stroke length → tail length |
| **Lane Broom** | Wide, rhythmic "shhk", heavy | Rubber edge squeak at lane ends | Steady cadence ties to lane stripes | Speed → cadence |
| **Static Rake** | Electrostatic crackle bed | Grain "tick" pops as dust snaps up; rising whine with charge | Electric, sparkly | Charge → whine pitch; dust lifted → pop density |
| **Ion Curtain** | Shimmering harmonic hum (tuned to the music key) | Granular sizzle as dust enters the field | Smooth, premium, "powerful but calm" | Throughput → brightness and harmonic count |
| **Assembly Gun** | Projector hum | Blueprint chirps on snap; Place = solid thunk + latch; Shift = soft lift whoosh; Reclaim = reverse zip + refund chime | Precise, mechanical | Valid/invalid → major/minor chirp |
| **Dust Cell** (all tools) | Granular hiss into the Dust Cell | Pitch rises with fill level | At 90%: soft two-tone. Full: "clunk" + rattle, and the tool sound goes "dry" (no dust) | Fill % → pitch +7 semitones over the range |

### 2.2 Suit gear

| Item | Sound |
|---|---|
| Hop Pack | Valve click + short cold-gas hiss (suit channel) per burst; landing thump (contact) |
| Ballast Soles | Magnetic "clack" on toggle; heavier footstep layer while on |
| Crown Lamp | Soft relay click; Searchlight adds a faint ballast hum |
| Lowlight Visor | Glassy "shff" + faint electronic whine at very low level |
| Holster Rig | Tool clip in and out (latch), per slot |
| Footsteps | Contact thumps: grime = soft crunch-thud; clean = firmer tap; Deck Plates = metallic; slow 1/6 g cadence |

### 2.3 Machines, logistics and buildings (ground conduction ≤ 60 m unless noted)

| Source | Sound |
|---|---|
| Assay Counter | Pour = granular stream; scale ticks; readout flip-digits; **ka-ching** = bright two-note chime + a soft register thunk (our motif, not a coin sound) |
| Receiving Gate | Scanner blip per puck + a smaller ka-ching |
| **Railshot** (≤ 300 m) | 2 s rising coil charge (suit relay + ground), a deep "thoom" through the ground, sled release clack, then radio "Railshot away" chime |
| Requisitions Desk / Ops Console | Kiosk hum; Brightside "hold music" (§4) while a panel is open |
| Relay Pad | Rising whoosh-in (suit), ring "wipe", soft arrival thump |
| Flare Beacons | Faint tonal hum per beacon color (suit relay ≤ 25 m) |
| Motor Pool | Roll-up door rattle; garage work-light buzz |
| Dust Vault / Dump Plate | Hollow fill rumble rising in pitch / grate rattle + tip pour |
| Puck Former | Hydraulic press "ka-chunk" + stamp click per Dust Puck |
| Glide Rail | Low maglev hum (**one emitter per rail cluster**, never per puck); puck "fffp" glides; Rail Fork/Join = soft diverter click |
| Bead Kiln | Low burner roar *felt* through the ground; glass ticking and tinkling as Glass Beads drop |
| Tile Sinterer | Heavy stamp thud + ceramic clink as Sinter Tiles stack |
| Sun Sprig / Sun Fan / Heliostat | Small servo steps / fan-out motor / slow tracking motor |
| Night Cell | Quiet electrical hum; level-change blips |
| Roost / Nests | Docking clamp click, charging hum / bale catch thump |
| Inspector's Stamp (world) | Big rubber-stamp **thunk** + rising major chord + ivory shimmer (suit relay + UI layer) |

### 2.4 Vehicles (all electric: no combustion sounds)

Your own vehicle comes through the contact channel and is loud and clear. Others come through ground conduction ≤ 120 m.

| Vehicle | Drive | Work | Signature |
|---|---|---|---|
| **Trundle** | Small motor whir, cart rattle | Brush-drum spin "wsshh" | Push-handle creaks |
| **Skiff** | Bright electric whine rising with speed, balloon-tire thumps | Brush-deck sweep | Seat-spring "boing" on landings |
| **Carryall** | Mid motor, six-wheel rumble, rack rattles | — | Grab-rail clanks with passengers |
| **Bulldust** | Heavy motor, articulation joint clunks | Intake roar (felt), skirt-flap patter | Hopper fill rumble |
| **Behemoth** (≤ 200 m) | Track clank loop + giant low hum | Multi-roller chorus | Hopper "slosh" of tonnes of dust; cab door seal hiss |
| Upgrades | Gear Ratio: motor pitch range; Afterburner: whoosh + whine spike; Throttle Lock: two-tone engage click; Wide Mouth: intake widens (brighter); Fast Tip: faster tip pour; Cargo Expander: deeper fill tone; Running Lamps: relay click + ballast hum | | |
| Air time | Ground layer fades out (rule 1.2); landing thump scaled by fall; Faceplant = crunch + suit bump | | Callout stingers (Hang Time, Moonshot!, Lunar Loop, Corkscrew, Faceplant) on the UI bus |

### 2.5 Robots (suit relay ≤ 25 m: synthetic, bird-*inspired*, never real birdcalls)

| Robot | Movement | Voice-like chirps | Work |
|---|---|---|---|
| **Sandpiper** | Skittery tick-tick steps | Short high servo "peeps" (2–3 notes) | Beak brush pecks |
| **Plover** | Steadier trot, deeper steps | Rounder two-tone chirps | Twin-brush rhythm |
| **Albatross** | Cold-gas hop puffs (suit relay), landing thump | Long gliding synth "call" on take-off | Wing-panel unfold servo; Bale clamp |
| States | Docking click · Emptying pour · Bin Full / Roost Full = amber two-note alert (radio, with a visual cue) · Plot Done = three rising notes · Scanning = soft sweep | | |

### 2.6 UI (UI bus, never spatialized)

| Event | Sound | Notes |
|---|---|---|
| Hover / focus | Very soft glass tick | Rate-limited to 12/s |
| Click / confirm | Soft rounded click | — |
| Toggle | Two-state click (up/down pitch) | — |
| Panel open / close | Glass whoosh up / down | Matches `spring-ui` timing (art-direction §8.7) |
| Purchase ("Requisition approved") | Pleasant 2-note rise + soft stamp | Synced to the purchase timeline at 0 ms / 120 ms |
| Insufficient LM | Soft low double buzz | Never harsh |
| LM income tick | "Lumen shimmer" granular ticks, pitch rising over a streak | Merged like the visual tick-up |
| Inspector's Stamp / "Plot stamped" | Stamp thunk + chord (shared with the world event) | — |
| Plot Card (`G`) | Sonar-like sweep + soft ping per edge | — |
| Survey Globe | Deep glassy open; rotate = subtle detents | — |
| DOT message | Amber "bloop" (two notes) before each line | Matches the amber status light |
| Achievement | Short bright motif | — |
| Contract Fulfilled | Full fanfare cue (music bus) | — |
| Clock In | Brightside jingle (3–4 s) | Plays once per session |

---

## 3. Ambience and suit bed

| Layer | Content | Behavior |
|---|---|---|
| Suit bed | Fan hum, faint pump cycles, radio hiss floor | Always on, low. Helps the "inside a helmet" feel |
| Breathing | Calm breathing; heavier after sprinting or Hop Pack bursts, settling over 5 s | Separate slider, can be turned off (some players find breathing stressful) |
| Thermal ticks | Hardware and regolith creaks and ticks at dawn and dusk (nod to real thermal moonquakes) | Ground conduction; denser at the terminator |
| Outposts | Generator hum and signage buzz within 40 m | Ground conduction |
| Night, near side | Quieter suit bed, cold creaks, a cooler hiss tint | — |
| Night, far side | Almost silence: just the suit | Deliberately stark, to contrast with lamp-lit work |
| Crowds | "Shift cleaning" aggregate bed scaled by how many custodians are working within 25 m | Replaces individual voices beyond the cap (§7.3) |

---

## 4. Music approach

### 4.1 Structure

| Set | Tempo / feel | Palette | Plays when |
|---|---|---|---|
| **Day** | ≈ 100 BPM, major/lydian, bright | Plucked synths, marimba, warm electric piano, soft kick, **brushed snare** (cleaning pun), round bass | Sun > 10° |
| **Dawn/Dusk bridge** | Free-time swell → set change | Pad + bells | Sun 0–10°, on bar boundaries |
| **Night** | ≈ 76 BPM, sparse, glassy | Pads, celesta, soft sub, distant bell | Sun < 0°; far side sparser still |
| **Vehicle layer** | Locks to the current set's tempo | Driving bass + hats | While driving a vehicle |
| **Brightside hold music** | Corporate-muzak parody (light jazz) | Electric piano, vibraphone | Requisitions Desk / Ops Console panels |
| **Menu** | Calm day-set variant | — | Clock In, Contracts, Locker, Settings, Credits |
| **Stingers** | 1–4 s | Set-key-aware | Inspector's Stamp, Railshot away, achievements, purchases, air-time callouts, Contract Fulfilled |

### 4.2 Adaptive layers (per set)

| Layer | Driven by | Range |
|---|---|---|
| L0 Bed (pad/harmony) | Always (while music is on) | — |
| L1 Pulse (rhythm) | Cleaning activity: your stroke rate + custodians working within 25 m | 0 → full over 4 bars; falls back after 8 s idle |
| L2 Melody | Progress: the plot you stand in ≥ 80% clean, or Shine milestones | Enters on the next 4-bar boundary |
| L3 Drive | Vehicle | Enters on the next bar |

| Rule | Value |
|---|---|
| Music density | Cues of 2–5 min, then 1–3 min of ambience only (long sessions must not fatigue) |
| Transitions | Bar-quantized; 2-bar crossfades; key-related sets |
| Ducking | Under DOT lines (§5.3) |
| Loop format | 16- or 32-bar seamless loops, sample-accurate loop points in the audio manifest |
| Sourcing | Original compositions (owner or volunteer, rights assigned) **or** CC0 / CC BY tracks with stems. AI-generated music only with lead approval per track. Never NC |

---

## 5. Mix buses and loudness

### 5.1 Bus graph

| Bus | Feeds | Default level (dB, relative) | Player slider |
|---|---|---|---|
| **Master** | Everything → limiter (−1 dBTP ceiling) | 0 | Master |
| Voice (DOT) | Radio chain | 0 | Voice |
| UI | — | −6 | Interface |
| SFX → Tools | Own + others' hand tools, Dust Cell | −3 | Effects |
| SFX → Vehicles | — | −6 | Effects |
| SFX → World | Machines, logistics, buildings, Railshot | −8 | Effects |
| SFX → Robots | — | −10 | Effects |
| SFX → Foley | Footsteps, suit gear | −9 | Effects |
| Suit / Ambience | Suit bed, breathing (own sub-slider), thermal ticks, crowd bed | −14 | Ambience (+ Breathing) |
| Music | All sets, stingers | −12 | Music |

### 5.2 Loudness targets

| Target | Value | Measured on |
|---|---|---|
| Integrated loudness, gameplay | **−18 LUFS ±2** | 10-minute capture of typical play (path P1 in visual-target) at the master, default sliders |
| True peak | **≤ −1 dBTP** | Master |
| Momentary max | ≤ −10 LUFS, and only for Railshot / Inspector's Stamp / Contract Fulfilled | Master |
| DOT lines | −18 LUFS integrated per line (dialogue-gated), consistent ±1 LU | Per file |
| Music | Full stem stack −20 LUFS integrated; single stems −24 to −28 | Per set |
| SFX asset normalization | Peak −3 dBFS; short-term loudness classes: tiny −30, small −24, medium −20, large −16 LUFS | Per file, in the audio manifest |
| "Night mode" option | Master compressor 3:1 above −24 LUFS; lowers peaks by about 6 dB | Settings |

### 5.3 Ducking and priorities

| Trigger | Ducks | Amount / attack / release |
|---|---|---|
| DOT line | Music, Suit/Ambience, World | −6 / −4 / −3 dB, 80 ms / 400 ms |
| Inspector's Stamp, Railshot away | Music | −4 dB, 30 ms / 600 ms |
| In-vehicle (own) | Suit bed | −4 dB |
| Panel open (Requisitions Desk / Ops Console) | World, Tools | −6 dB (hold music takes over) |

---

## 6. DOT voice

### 6.1 Options

| Option | Cost ($0 budget) | Consistency | License risk | Iteration speed | Fits "dispatch terminal" fiction | Mixable (duck/process) | Verdict |
|---|---|---|---|---|---|---|---|
| A. Recorded human VO | Volunteer only | High | Needs a signed release | Slow (re-record each change) | Good | Yes | Only if a volunteer signs a release |
| B. **Pre-rendered TTS** (offline at build time, shipped as Opus) | Free with an open engine | High (one voice, fixed files) | **Voice-model license must allow commercial distribution of output**; reject NC voices; log in the manifest | Fast (regenerate lines) | **Excellent**: DOT *is* a terminal AI; slight synthesis is in character | Yes | **v1.0** |
| C. Runtime TTS (browser speech synthesis) | Free | Poor: different voice per OS/browser | Low | Instant | Weak | **No**: output can't be routed through Web Audio (no ducking, no radio chain) | Rejected |
| D. **"Chirp-speak"** (procedural tonal syllables in sync with text, amber light pulses) | Free | High | None | Instant | Charming, Brightside-cute | Yes | **MVP** |

### 6.2 Recommendation

| Milestone | DOT voice |
|---|---|
| M1 (MVP) | **D + subtitles always on**: every DOT line is text, with chirp-speak whose syllable count follows word count and pitch contour follows punctuation. Zero license risk, tiny download |
| M2 (v1.0) | **B for key lines** (tutorial, contract reports, milestone reports: ≈ 150–300 lines, ≤ 8 MB), through the radio chain; D stays for short barks. No voice cloning of any real person |
| Any | A replaces B only if a volunteer records with a signed release |

DOT character: dry corporate politeness, about 150 words per minute, barks ≤ 12 words, always preceded by the amber bloop. Processing: radio band-pass, light saturation, a subtle 12-bit "terminal" grain at a 20% mix.

---

## 7. Spatialization

### 7.1 Model (Web Audio API)

| Item | Rule |
|---|---|
| Context unlock | `AudioContext` resumes on the **Clock In** click (the same gesture as pointer lock and fullscreen) |
| Listener | At the custodian's head, oriented by camera yaw (third person) or by the camera (first person) |
| Panning | **HRTF** for the highest-priority sources: ≤ 8 (Tier A) / ≤ 4 (Tier B). Equal-power for the rest |
| Distance | Inverse model, reference 2 m, rolloff 1, hard max per channel (§1.2) + per-channel low-pass curve |
| Ground conduction | Partly non-directional: 60% directional / 40% centered (feet feel it everywhere) |
| Occlusion | None in vacuum. Ground conduction instead needs a grounded path, so a source on a Gantry still conducts through structure |
| Doppler | Off |
| Reverb | Off outdoors. Small convolution only for pressurized interiors |
| Multiplayer | Other custodians' sounds come from replicated state and events (no extra bandwidth). Your own sounds are predicted locally with zero latency |

### 7.2 Priorities (highest first)

Voice (DOT) > UI > own tool > own vehicle > Inspector's Stamp / Railshot > nearby vehicles > others' tools > robots > logistics > ambience.

### 7.3 Voice and instance caps

| Category | Cap | Overflow |
|---|---|---|
| Total simultaneous voices | 40 (Tier A) / 24 (Tier B) | Lowest priority stolen with a 30 ms fade |
| Others' hand tools | 4 nearest individual | "Shift cleaning" aggregate bed |
| Footsteps (others) | 6 | Dropped |
| Robots | 6 individual | Aggregate "flock" bed |
| Glide Rail | 1 emitter per rail cluster within 30 m | — |
| Dust particles | **Never** trigger per-grain sounds | — |
| Active audio nodes | ≤ 150 | Pool nodes; no per-frame node creation |

---

## 8. Sourcing (licenses)

| Source | Status | Commit to the public repo? | Notes |
|---|---|---|---|
| **Own recordings** (foley) | ✅ Preferred | Game-ready files yes; WAV masters outside git (ADR-0017) | **Contact-mic foley**: brushes over flour, cornstarch, charcoal powder and sand in a tray; contact mics give the conduction timbre for free |
| Own synthesis (DAW or offline Web Audio) | ✅ | Yes | UI, chirp-speak, robots, Ion Curtain |
| **Freesound CC0** | ✅ | Yes | Check each sound's license at download |
| **Freesound CC BY (4.0 or 3.0)** | ✅ with credit | Yes | Per-file credit in `CREDITS.md` + in-game Credits; log author, URL and license version |
| **Kenney audio** (CC0) | ✅ | Yes (keep the license file) | UI placeholders |
| Freesound **CC BY-NC**, **Sampling+**, any NC/ND | ❌ | — | — |
| **Sonniss GDC bundles**, **Pixabay** | ⚠ Human decision | **Never** raw | If approved: processed derivatives only, inside the shipped game; originals in private storage |
| Moon Sweepers / Roblox game audio, ripped audio, YouTube rips, unlicensed packs | ❌ | — | — |
| AI-generated SFX or music | ⚠ Lead approval per asset | — | Logged in the manifest |
| TTS voice models (DOT, v1.0) | ⚠ Verify per voice | Rendered lines only | Output must be licensed for commercial redistribution; no NC; no cloning of real people |

Every file goes into the audio manifest: source URL, author, license + version, date, edits, loudness class and loop points.

---

## 9. Accessibility

| Feature | Default | Spec |
|---|---|---|
| **Subtitles** (DOT, all spoken or chirp-speak lines) | **On** | Speaker tag "DOT" in `dot-amber` mono. ≤ 2 lines, ≤ 42 characters per line. Shown for 1.5 s + 60 ms per character. Sizes S/M/L/XL = 16/20/24/32 px. Background opacity 0–100% (default `ui-glass-bg-strong`) |
| **Captions** for key sounds | Off (one toggle) | Bracketed, e.g. [Dust Cell full], [Railshot away], [Robot: Bin Full], [Teammate ping], [Behemoth approaching] |
| Directional indicators | On | Edge-of-screen chevrons for off-screen audio events (robot alerts, pings, Railshot, vehicles approaching within 20 m) |
| Mono audio | Off | Sums to mono after spatialization |
| Per-bus volume | — | Master, Music, Effects, Interface, Voice, Ambience, Breathing |
| Reduce sudden loud sounds | Off | "Night mode" compressor (§5.2) |
| Haptics | On (gamepad) | Stroke contact, landing thumps, Railshot, Dust Cell full |
| No audio-only information | Rule | Every gameplay cue has a visual equivalent (table below) |

| Audio cue | Visual equivalent |
|---|---|
| Dust Cell 90% / full | HUD Cell gauge pulse + Dust Cell window blink on the suit |
| Grime vs clean brushing timbre | Grime/clean albedo contrast + Plot Card % |
| Robot Bin Full / Roost Full | Robot amber state light + robot state chip + edge chevron |
| DOT message bloop | Amber status light on the HUD panel + subtitle |
| Railshot charge | Coil light sequence + "Railshot away" toast |
| Inspector's Stamp | Outline + stamp VFX + "Plot stamped" toast |
| Ground world going quiet when airborne | (Feel only; no information lost) |
| Insufficient LM buzz | Danger outline + shake (reduced motion: outline flash) |

---

## 10. Formats, memory and streaming budgets

### 10.1 Formats

| Use | Primary | Fallback | Rate / bitrate |
|---|---|---|---|
| SFX one-shots | **Opus in WebM** (`.webm`) | AAC-LC in MP4 (`.m4a`) | 48 kHz mono, 64 kbps (stereo only where it matters, 128 kbps) |
| SFX loops | Opus/WebM | AAC | 48 kHz, 96 kbps mono. Decoded to `AudioBuffer` with sample-exact `loopStart`/`loopEnd` (handles the Opus pre-skip) |
| Music stems | Opus/WebM | AAC | 48 kHz stereo 112–128 kbps (AAC 160) |
| DOT voice (v1.0) | Opus/WebM | AAC | 48 kHz mono 40–48 kbps (AAC 64) |
| Masters | WAV 48 kHz / 24-bit | — | **Outside git** (ADR-0017) |

Format selection: feature-detect once by test-decoding a tiny Opus clip, then cache the choice. Never ship both formats to one client.

### 10.2 Download budgets

Audio counts inside the [browser-feasibility](../research/browser-feasibility.md#recommended-budgets) totals.

| Bucket | Budget |
|---|---|
| Before Clock In (UI, suit bed, Desk Duster, footsteps, chirp-speak, Clock In jingle) | ≤ 1.5 MB |
| MVP total audio | ≤ 12 MB |
| v1.0 total audio (excl. DOT voice) | ≤ 30 MB |
| DOT voice pack (v1.0) | ≤ 8 MB, streamed per line |
| Lazy loading | By unlock and proximity: vehicle banks when a Motor Pool exists; robot banks on the first Roost; logistics on the first Glide Rail; night music set during dusk |

### 10.3 Decoded memory (Float32 PCM ≈ 188 KB per second per channel at 48 kHz)

| Bucket | Tier B | Tier A |
|---|---|---|
| SFX resident (decoded) | ≤ 32 MB | ≤ 48 MB |
| Music (current set: 3 stems × ≤ 30 s stereo ≈ 35 MB, plus one bridge stem during transitions; old set unloaded after the crossfade) | ≤ 40 MB | ≤ 64 MB |
| DOT voice | Streamed via media element per line: ≈ 0 resident | same |
| **Total decoded audio** | **≤ 80 MB** | **≤ 120 MB** |
| Main-thread audio work | ≤ 0.3 ms per frame (event dispatch, parameter updates ≤ 30 Hz) | same |

---

## 11. Open items for the lead

| # | Item | Default if no decision |
|---|---|---|
| 1 | Do pressurized interiors exist? | No interior acoustics; §1.1 row unused |
| 2 | Player voice chat | Out of scope; teammate pings only |
| 3 | Composer source | Owner or volunteer originals; CC0/CC BY with stems as a fallback |
| 4 | Sonniss/Pixabay approval | Not used |
| 5 | TTS engine and voice for DOT v1.0 | Chosen at M2 after a license check; MVP uses chirp-speak |
