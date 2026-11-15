# M0-W1-T05 harness fixes (S12 DPR readout, overlay gate, HUD sidecar)

qa-test-engineer, 2026-11-14. Status: items 1 and 3 done; item 2 finds a real defect in apps/client (not edited).

## 1. S12 readout "1.5" at DPR 1 and 2 - fixed (tools/screenshots)
Cause: `readback.ts` CDP `Page.captureScreenshot` with a clip `scale` correcting for the OS display scale (150 %) left
`window.devicePixelRatio` at 1.5 after the shot (probe: 1.0000000298 -> 1.5 right after readback, stays). The HUD page
reads `--mc-dpr`, which `installDisplayMetrics` rewrites on the DPR change, so the frame and readout showed 1.5. Direct
page probes never take a CDP shot, hence correct there.
Fix: `readback.ts` pins `Emulation.setDeviceMetricsOverride` (viewport, emulated DPR) once per page/viewport before capture.
Probe after fix: DPR stays 1.0000000298, readout "1" after shot and later.
Assertion: `src/dpr-check.ts` (`assertDprReadout`, called in `captureCurrent`): page DPR and S12 readout must equal the
request or the capture throws; sidecar `dprCheck`. Unit tests in `src/dpr-check.test.ts` (symptom cases fail). tsc clean, vitest 46/46.
Re-captured (production build, scratch dist, `--preview --client-out`, port offset 9) over
`docs/visual-reviews/M0/vt10-recheck/S12-...@1`, `@1.5`, `@2` (1920x1080, 1920x1080 at css 1280x720, 2560x1600 at css 1280x800):
sidecar `dprCheck.readout` "1", "1.5", "2", ok true; frame at DPR 1 viewed, readout "1".

## 2. Dev text overlay in production - PRESENT, needs a fix
Production build (`vite build`, served by `vite preview`, default URL, no params): `#mc-overlay` is `display:block` with
"Clean The Moon!  dev (local) / backend ... / server asleep". Gate is URL-only:
`apps/client/src/app/config.ts:55` `showOverlay: hud === null ? !capture : hud !== "0"` -> `boot.ts:122` `visible: config.showOverlay`.
Nothing checks `import.meta.env.PROD` (contrast `perfEnabled` at boot.ts:128). Note version/label also read "dev (local)"
because VITE_BUILD_VERSION / VITE_ENV were unset in this build. Suggested gate for the owner of apps/client: in PROD show
only on an explicit `?hud=1|dbg` (default hidden), e.g. `import.meta.env.PROD ? hud === "1" || hud === "dbg" : (...)`;
config.ts takes the raw env bag, so pass `PROD` into `readClientConfig`. Harness frames use `hud=1`, so S12 frames will keep
showing it until the overlay is moved clear of the Lumens panel or hidden for HUD scenes.

## 3. HUD numbers in sidecars - done
`src/hud-measure.ts`: sidecar `hudMeasure` on S12 = `panelsOffDevicePx` and per-hairline `rowsOverHalfPeak`/`peak`.
Re-captured sidecars: panelsOffDevicePx 0 and hairline rowsOverHalfPeak 1 at the three DPRs (checked @1.5 and @2 files).

Files: tools/screenshots/src/{readback,capture,dpr-check,dpr-check.test,hud-measure}.ts, README.md. Servers stopped; scratch dist in the session temp dir.

## Addendum: item 2 fixed (apps/client/src/app)
- `config.ts` `readClientConfig`: `showOverlay = env["PROD"] === true ? hud === "1" || hud === "dbg" : (hud === null ? !capture : hud !== "0")`. `RawClientEnv` already carries Vite's `PROD`, so no signature change and `boot.ts` is unchanged (it passes `import.meta.env`). Doc comment updated.
- Tests (`app.test.ts`, new case): dev default true, prod default false, prod `?capture=1` false, prod `?hud=1` / `?hud=dbg` true, prod `?hud=0` / `?hud=true` false; existing dev cases unchanged. Client tsc clean, eslint clean on src/app, vitest src/app 46/46.
- Rebuilt production page (headless probe): default `display:none`, `?hud=dbg` block, `?hud=1` block, `?hud=0` none. `#mc-overlay` still exists (data-* e2e hooks intact), only hidden.
- tools/screenshots: harness HUD frames pass `hud=1`, so they still get the overlay where requested (re-capture with `--hud hud` on the production build shows it, readout "1"); default production loads and `nohud` captures no longer show it. The overlay still overlaps the Lumens panel in explicit `hud=1` frames; the visuals/ui owner may move it if that matters. apps/client/src/visuals untouched.
