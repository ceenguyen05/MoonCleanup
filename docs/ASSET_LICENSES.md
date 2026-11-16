# Asset license policy and ledger

Owner: `docs-keeper` - Rows are **appended by the agent that adds an asset**, in the same commit as the asset.
Evidence and caveats behind this policy: [`research/asset-and-data-licensing.md`](research/asset-and-data-licensing.md) (research, not legal advice).
Asset storage rules: ADR-0017 (no Git LFS; only compressed, budgeted derivatives are committed).

## 1. Policy

### Allowed licenses

| License | Conditions |
| --- | --- |
| CC0 1.0 / public domain (including US government works with a public-domain statement) | None required; credit anyway when the source asks for it |
| CC BY 4.0 (and 3.0) | Attribution recorded in the ledger **and** shown in the in-game credits screen |
| SIL OFL 1.1 (fonts) | Keep the license text next to the font; do not sell the font by itself; list in the ledger |
| MIT / ISC / Apache-2.0 (icons, code-like assets) | Keep the license notice; list in the ledger |
| CC BY-SA 4.0 | **Only** for the specific derived file(s) (for example HYG-derived star data), shipped as a separate file with its own notice; ShareAlike applies to that file only |
| Original or commissioned work | Record author and the agreement (commission, work-for-hire) |
| AI-generated assets | Only with a tool whose terms grant commercial rights; disclose in the ledger and in credits (OPEN_QUESTIONS Q15) |

### Forbidden

- Any **NC** (non-commercial) or **ND** (no-derivatives) license.
- Unclear, unknown or missing license terms ("free to download" is not a license).
- Assets, textures, models, sounds, UI or names taken from **reference games** (Moon Sweepers, Roblox games, or any other game).
- **Gaia-derived data** (ESA Gaia is CC BY-NC 3.0 IGO). This includes the NASA SVS Deep Star Maps unless a human clears it. Use HYG instead.
- SLDEM2015 (contains JAXA data with unclear terms): use LOLA-only products.

### Never commit raw files from

Mixamo, Sonniss, Pixabay, Quaternius (Quaternius Asset License v1.0 forbids standalone redistribution). These may be used inside the shipped game
where their licenses allow it, but the raw downloaded files must not be committed to this repository. If a transformed derivative is committed, the
ledger row must say so and "Commit raw OK?" must be `no`. Also never commit: `assets/terrain/raw/` downloads, `.blend`/`.psd` masters, paid store
assets without a redistributable license, or anything whose license file you have not read.

### Rules for the ledger

1. Every new asset file or group of files gets **one row** in the same PR (CI, `.github/workflows/asset-validation.yml`, fails otherwise).
2. **Path(s)**: exact repo paths, or a directory prefix ending in `/`, `/*` or `/**`. Pipeline outputs under `apps/client/public/assets/` are covered by
   listing their directory.
3. **License (SPDX)**: SPDX identifier (`CC0-1.0`, `CC-BY-4.0`, `OFL-1.1`, `MIT`, `ISC`, `Apache-2.0`, `CC-BY-SA-4.0`, `LicenseRef-Original`, `LicenseRef-NASA-PD`).
4. **Attribution**: the exact credit line to show in the credits screen (or `none required`).
5. **Modified?**: what we changed (resized, compressed to KTX2, re-encoded, retargeted).
6. **Commit raw OK?**: `yes` only if the license permits redistributing the unmodified file in a public repo.
7. **Reviewed by**: a second role (not the one that added it), for example `docs-keeper` or `visual-qa-reviewer`.

## 2. Required credit lines

Use these exact lines (or stricter ones from the source) in the in-game credits screen and `CREDITS.md`. Re-check each source's live page before release.

| Source | Credit line | Notes |
| --- | --- | --- |
| NASA Scientific Visualization Studio (CGI Moon Kit, SVS 4720) | "NASA's Scientific Visualization Studio." | NASA material: acknowledge NASA as the source; no endorsement implied |
| LRO LOLA elevation (PDS Geosciences Node, LDEM) | "Elevation: NASA LRO Lunar Orbiter Laser Altimeter (LOLA) Science Team, NASA/GSFC; data via NASA Planetary Data System." | Our wording; no official LOLA wording exists |
| LROC imagery (if used) | "NASA/GSFC/Arizona State University" | Short form: NASA/GSFC/ASU |
| NASA Blue Marble / Visible Earth | "NASA Earth Observatory / NASA Visible Earth" | The only mandatory credit is NASA |
| HYG Database v4.x (star data) | "Star data: HYG Database (astronexus.com), CC BY-SA 4.0; derived starfield (c) Clean The Moon! contributors, CC BY-SA 4.0." | ShareAlike applies to the derived star file(s) only |

## 3. Ledger

Columns: Asset ID | Path(s) | Description | Source URL | Author | License (SPDX) | License URL | Attribution | Modified? | Commit raw OK? | Added (date/role) | Reviewed by

<!-- LEDGER-START: CI reads only table rows below this marker. Append rows at the end of the table. Do not delete the header or separator rows. -->

| Asset ID | Path(s) | Description | Source URL | Author | License (SPDX) | License URL | Attribution | Modified? | Commit raw OK? | Added (date/role) | Reviewed by |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rock-boulder-a-source | `assets/models/rocks/**` | Source script for the procedural lunar boulder `rock_boulder_a` (headless Blender Python; every vertex and texel generated by code; shared generator in `tools/asset-pipeline/src/blender/`) | none (original work, M0-W0-T06) | Clean The Moon! contributors (technical-artist agent) | LicenseRef-Original | n/a | none required | n/a (original) | yes | 2026-11-12 / technical-artist | pending (lead to assign) |
| boreal-hab-module-source | `assets/models/outpost/**` | Source script for the outpost module `boreal_hab_module` (headless Blender Python; kitbash library v0 and procedural Brightside trim sheet v0 in `tools/asset-pipeline/src/blender/`) | none (original work, M0-W0-T06) | Clean The Moon! contributors (technical-artist agent) | LicenseRef-Original | n/a | none required | n/a (original) | yes | 2026-11-12 / technical-artist | pending (lead to assign) |
| blockout-custodian-duster-source | `assets/models/characters/blockout/**`, `assets/models/tools/blockout/**`, `tools/asset-pipeline/src/blender/ctm_blockout.py` | Source scripts for the blockout custodian `custodian_blockout` and the Desk Duster v0 `desk_duster_v0` (headless Blender Python; every vertex generated by code; material slots / parts in COLOR_0) | none (original work, M1-W3-T07) | Clean The Moon! contributors (technical-artist agent) | LicenseRef-Original | n/a | none required | n/a (original) | yes | 2026-11-16 / technical-artist | pending (lead to assign) |
| blockout-custodian-duster-web | `apps/client/public/assets/blockout/**` | Generated web assets: `custodian_blockout.<hash>.glb`, `desk_duster_v0.<hash>.glb` (glTF 2.0, meshopt, no textures) and `manifest.json`. Placeholder-tagged (replace by M1-W4-T07) | none (generated from our own scripts, M1-W3-T07) | Clean The Moon! contributors (technical-artist agent) | LicenseRef-Original | n/a | none required | n/a (generated) | yes | 2026-11-16 / technical-artist | pending (lead to assign) |
| asset-proof-m0 | `assets/models/proof/**` | Pipeline proof outputs built from the two scripts above: `rock_boulder_a.<hash>.glb`, `boreal_hab_module.<hash>.glb` (glTF 2.0, meshopt, embedded KTX2 textures: ETC1S colour, UASTC normal/ORM, encoded from PNGs generated by the scripts) and `manifest.json`. Placeholder-tagged; no external mesh, texture, HDRI or add-on | none (original work, M0-W0-T06) | Clean The Moon! contributors (technical-artist agent) | LicenseRef-Original | n/a | none required | n/a (generated from our own scripts) | yes | 2026-11-12 / technical-artist | pending (lead to assign) |
| terrain-lola-ldem16-derivatives | `assets/terrain/**` | Height cube maps (`height-cube-1024.<hash>.bin`, `height-cube-256.<hash>.bin`, deflate-compressed uint16, two-band vertically exaggerated, outpost pads flattened), far-occluder horizon map (`horizon-map.<hash>.bin`), 64x64 unit-test fixture + golden samples (`fixtures/`) and `manifest.json`, all baked by `tools/terrain-bake` from LOLA LDEM_16 (`LDEM_16.IMG`/`.LBL`, raw files stay in git-ignored `assets/terrain/raw/`, never committed) | https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_16.img | NASA LRO LOLA Science Team (NASA/GSFC); data via NASA Planetary Data System (no licence text published; NASA mission data, credit requested) | LicenseRef-NASA-PD | n/a (PDS publishes no licence text) | Elevation: NASA LRO Lunar Orbiter Laser Altimeter (LOLA) Science Team, NASA/GSFC; data via NASA Planetary Data System. | yes: reprojected to a cube, vertically exaggerated, edited, quantised and compressed (derivative only) | no (raw LDEM stays out of git) | 2026-11-12 / terrain-dust-engineer | pending (lead to assign) |
| ui-font-inter | `assets/ui/fonts/inter-latin-wght.woff2`, `assets/ui/fonts/OFL-Inter.txt` | Inter variable (wght), Latin subset woff2: UI text | https://github.com/rsms/inter (via fontsource) | The Inter Project Authors | OFL-1.1 | https://openfontlicense.org | none required (license text kept next to the font) | Latin subset, woff2 (as distributed by fontsource) | yes | 2026-11-12 / ui-ux-motion-designer | pending |
| ui-font-space-grotesk | `assets/ui/fonts/space-grotesk-latin-wght.woff2`, `assets/ui/fonts/OFL-SpaceGrotesk.txt` | Space Grotesk variable (wght), Latin subset woff2: display and numerals | https://github.com/floriankarsten/space-grotesk (via fontsource) | The Space Grotesk Project Authors | OFL-1.1 | https://openfontlicense.org | none required (license text kept next to the font) | Latin subset, woff2 | yes | 2026-11-12 / ui-ux-motion-designer | pending |
| ui-font-jetbrains-mono | `assets/ui/fonts/jetbrains-mono-latin-wght.woff2`, `assets/ui/fonts/OFL-JetBrainsMono.txt` | JetBrains Mono variable (wght), Latin subset woff2: timers, plot IDs, DOT tag | https://github.com/JetBrains/JetBrainsMono (via fontsource) | The JetBrains Mono Project Authors | OFL-1.1 | https://openfontlicense.org | none required (license text kept next to the font) | Latin subset, woff2 | yes | 2026-11-12 / ui-ux-motion-designer | pending |
| ui-icons-lucide | npm `lucide-react` 1.72.0 (bundled into the client build; no files under assets/) | Lucide base icon set, inline SVG React components | https://lucide.dev | Lucide Contributors | ISC | https://lucide.dev/license | Lucide (ISC); keep the notice in the in-game credits | none | n/a (npm dependency) | 2026-11-12 / ui-ux-motion-designer | pending |
| ui-icons-custom | `apps/client/src/ui/icons/custom.tsx`, `apps/client/src/ui/screens/MoonMark.tsx` | Custom glyphs (Lumens, Dust Cell, Plot hex, Shine) and the waking-screen moon mark, authored as inline SVG | none (original work) | ui-ux-motion-designer (Clean The Moon! team) | LicenseRef-Original | none | none required | none | yes | 2026-11-12 / ui-ux-motion-designer | pending |
| tool-ktx-software | `tools/.bin/ktx/**` (git-ignored, per-user; NOT committed) | KTX-Software v4.4.2 `ktx` CLI (`ktx create`) used by `tools/asset-pipeline` to encode KTX2 (ETC1S/UASTC). Extracted from the Authenticode-signed (Khronos Group Inc, DigiCert) Windows-x64 installer without running it; sha256 `1f323b0fec19794f5e6c0425a61d4b1da396872a10be862d105f4f4b2d2957fe` (matches the GitHub-published digest). 7-Zip 26.06 x64 MSI (sha256 `6dc822569e777d9a3ecd5ffcbc22b55600af87e6c5d9810a64e8566cf5a4af9f`) was used once to unpack it, also git-ignored | https://github.com/KhronosGroup/KTX-Software/releases/tag/v4.4.2 | The Khronos Group Inc. | Apache-2.0 | https://github.com/KhronosGroup/KTX-Software/blob/main/LICENSE.md | none (build tool, not shipped; outputs are our own textures) | no | no | 2026-11-12 / devops-engineer | pending |
| audio-procedural-cues | `apps/client/src/audio/recipes.ts`, `apps/client/src/audio/music-recipes.ts` (code only; no files under assets/audio) | All 63 cue sounds and the day/bridge/night/menu/hold music beds, synthesised at runtime from sine partials, filtered noise and envelopes | none (original work) | audio-engineer (Clean The Moon! team) | LicenseRef-Original | none | none required | none | yes | 2026-11-14 / audio-engineer | pending |
