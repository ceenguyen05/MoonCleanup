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
| HYG Database v4.x (star data) | "Star data: HYG Database (astronexus.com), CC BY-SA 4.0; derived starfield (c) Moon Cleanup contributors, CC BY-SA 4.0." | ShareAlike applies to the derived star file(s) only |

## 3. Ledger

Columns: Asset ID | Path(s) | Description | Source URL | Author | License (SPDX) | License URL | Attribution | Modified? | Commit raw OK? | Added (date/role) | Reviewed by

<!-- LEDGER-START: CI reads only table rows below this marker. Append rows at the end of the table. Do not delete the header or separator rows. -->

| Asset ID | Path(s) | Description | Source URL | Author | License (SPDX) | License URL | Attribution | Modified? | Commit raw OK? | Added (date/role) | Reviewed by |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
