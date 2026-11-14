# M0 release checklist v0.1.0 (local) and VT-M0-12 matrix / P4 verdict

qa-test-engineer, 2026-11-14. Node 26.13.1 via the fnm prefix. UHD 620 laptop only (provisional below-Tier-B). No client source edited, no git. Harness stopped its own `vite preview` (port 5182, offset 9) and browsers; no listener left on 5182. Listeners on 5173 and 2567 existed before and after (not mine, left alone).

## Done (local)

| Item | Result |
| --- | --- |
| `pnpm verify` | PASS: 52/52 tasks, 19 cached, 4m01s, exit 0. Build prints only the framer-motion "use client" bundler warnings |
| Secrets scan (postgres URLs with passwords, private keys, cloud key patterns) | PASS: hits are only fake test fixtures (`hunter2`, `u:p@h`) and the `.env.example`/HOSTING_GUIDE placeholders. No real `.env*` outside `*.example` is tracked or untracked-unignored; `.gitignore` covers `.env*` |
| Env placeholders | PASS: `apps/server/.env.example` secrets are `replace-me-...`, `DATABASE_URL` empty |
| Licensing | PASS by ledger review: ASSET_LICENSES has rows for rocks/hab source, proof GLBs, LOLA terrain, Inter/Space Grotesk/JetBrains Mono (OFL files present), Lucide, custom icons, KTX tool (git-ignored), procedural audio. `assets/terrain/raw` holds the LOLA download (policy: never commit raw; confirm it is git-ignored) |
| VT-M0-12 harness matrix | RAN (below). Names, sidecars, ROI measures, `index.md`, production serve mode all produced |

## VT-M0-12 matrix run

Harness, `--lane gpu --preview` (production build, vite preview), 1920x1080 DPR 1, `--scale floor`, 30 settle frames. Output (git-ignored): `tools/screenshots/output/m0-final/`.

| Cell | Frames | Result |
| --- | --- | --- |
| B-Medium-webgpu | S01 noon, S01 dawn, S02, S03, S05 noon, S06 night-near, S12 | 7 PNG + 7 sidecars + `index.md`; sun el and EV100 verified (dawn 4.0 deg / 11.5, noon 60 / 14.3, S06 -24 / 7.3) |
| C-Low-webgl2 | same 7 | 7 PNG + sidecars; backend recorded webgl2. Whole-frame numbers close to Medium (S02 chips identical luma 121.3, b* 5.61; S02 edgeLeft 6.4 vs 6.1 px, edgeRight 4.5 vs 4.5) |
| A-High-webgpu | not run | BLOCKED: no Tier A hardware |

Notes: S06 only supports `tod=night-near` (S06 with noon throws by design). Viewed S03, S06 (webgl2), S12 (webgl2): all render, no black or missing materials; the S12 hairline rows are not re-verified here (VT-10 stays as the reviewer's final-rerun FAIL at DPR 1/2 until ui-engineer's fix is re-run with `hud10.mjs`). Console errors: none reported by the harness. Verdict columns in `index.md` stay N/A (generated; the reviewer fills them).
VT-M0-12 verdict: **PASS for the items the harness can check** (naming, size = CSS x DPR, sidecar per PNG, ROI measures, tod, S12 alias, production mode, measure self-tests in the unit run). **Still open:** camera pose / vFOV in sidecar (needs read-only `camera` in `__mcLook.info()`), adaptation / dust ring fields null, A-High column.

## P4 verdict (flyover, 30 m altitude, 300 m, dawn)

Stepped 16 keyframes (`fly:<t>`, pose from `flyoverPose`: y 30 m, z -150 to +150, 8 deg down), Medium webgpu and Low webgpu, production build. Frames viewed: Medium f00, f03, f07, f11, f14, f15; Low f03. Ground frame-to-frame diff spike ratio 1.36 (Medium), 1.32 (Low), max at f13/f14: no spike.

Verdict: **CONDITIONAL, not PASS.**
- LOD pop: none seen and no metric spike, but S01 look-dev is a fixed mesh with no CDLOD, so the check is not truly exercised; a real 30 s real-time run is NOT RUN.
- CSM to horizon-shadow handoff: crater and rock shadows continue past the cascade range (shadow present, no missing region), but the far shadows are **stair-stepped and toothed**: f11 crater shadow has blocky steps and wedge teeth; f07 left crater shows striated teeth; f03 the hab shadow has a hard parallel stripe; the outpost-pad dust edge is visibly stair-stepped at distance. Matches the known far-cascade/horizon-map limits (VT-M1-08 edge ratio not measured here).
- Ground reads as a strongly curved dome at 30 m; f15 (z = +150) has no ground at all (terrain falls away or ends): path end shows sky only. A faint horizontal seam line sits in the sky gradient at about y = 400 (visible in f14/f15). Confirm whether the S01 patch ends or the camera clears it.
- Medium vs Low look near identical at this distance.

## BLOCKED (hardware or Cee's accounts)

VT-M0-11 and every Tier A/B verdict (no hardware); A-High-webgpu column; real Windows SIGTERM; `webgpu-compat`; migrations over real TLS/Neon; first Render/Vercel deploy, hosted netcode check, CSP on the deployed site; remote CI (WebGL2 lane on GitHub).

## NOT RUN

Real-time 30 s P4; 16-bot / 10 min load test (not re-run this session; prior bot evidence in earlier reports); e2e Playwright flows beyond harness captures; VT-10 re-run after a fix; High/Ultra far-cascade look; RF-03 motion; reference side-by-side (Cee views the reference).

## Defects

1. `pnpm format:check` FAILS: `packages/shared/src/config/world.schema.ts`, `tools/perf/scripts/gpu-timing-ab.mjs`, `tools/perf/scripts/gpu-timing-probe.mjs` (written after the last green check, likely by the concurrent perf job). Fix: `prettier --write` those three (not mine to edit).
2. P4: toothed/stair-stepped far shadows and pad dust edge; path end shows no ground; sky seam line (above). Owner: lighting/rendering.
3. Harness gap: no camera pose/vFOV in sidecars until the client exposes it.
4. Carried: HUD hairlines/panel geometry at DPR 1 and 2 (VT-10), Low far shadow length (VT-04b), dev overlay overlapping the Lumens caption at DPR 1 (confirm absent in production; the production-preview S12 frame did not show it).
5. For Cee: stray `C:\c\` outside the repo holds a copy of Claude config including `.credentials.json`; review and delete. `assets/terrain/raw/ldem_16.img` must stay git-ignored.

Files: `tools/screenshots/output/m0-final/**` (PNGs, sidecars, `index.md`, `run-*.log`, `P4-*/…pathreport.json`).
