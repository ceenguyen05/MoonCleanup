# M1-W2 Medium render-scale floor 0.75 (owner decision 2026-11-16)

Task / status: **done** / 2026-11-17 / rendering-engineer / Opus 5.5. No git, no device capture.

## Done

- Code and data were already on 0.75 when I started: `packages/shared/src/render/quality.ts` Medium `dynres` = `scaleMin 0.75, scaleMax 0.85`. The tests already pin it: `quality.test.ts` (row `dynres.scaleMin [0.5, 0.75, 0.75, 0.85]`), `apps/client/src/render/dynres-pace.test.ts` ("Medium preset floor (owner decision 2026-11-16)"), `module.test.ts` (Medium range 0.75-0.85, starts at the floor at 0.75). `render/README.md` already says "Medium 0.75-0.85 (floor raised from 0.60, owner 2026-11-16)".
- Docs, which still said 0.60, now agree:
  - `docs/architecture/rendering-pipeline.md` §14.1 (canonical table): Medium render scale range `0.75–0.85 (floor raised from 0.60, owner 2026-11-16)`.
  - Same doc §14.2 ladder step 5: `0.75 → 0.50`, marked as needing an owner decision (it would undo the owner's floor).
  - `docs/architecture/performance-budgets.md` §1 Tier B row: `Medium 0.75–0.85`.
- Not changed: Low 0.50-0.75, High 0.75-1.00, Ultra 0.85-1.00 (no doc ties them to Medium). ADR-0005's "Tier B 0.5-0.75" is a historical decision record, left as is. `dynres-pace.test.ts` uses a wider 0.60-0.85 range on purpose to exercise several controller steps; the shipped floor is pinned by its own test.

## Evidence

- vitest client `src/render/{dynres,dynres-pace,module,frame-loop}.test.ts`: 4 files, 77/77 pass.
- vitest shared `src/render/quality.test.ts`: 19/19 pass.
- tsc `--noEmit`: shared clean; client has errors only in `src/visuals/characters/blockout/__scratch/dump.test.ts`. That is another role's scratch file and has nothing to do with this change. No errors in `render/**`.

## Risk to note

M1-W2-T03 saw S06 on WebGPU sit at the old 0.60 floor at about 40 fps on the UHD 620. With a 0.75 floor, that scene has less resolution headroom: expect a lower fps at the floor and an earlier `floorHint`. Re-check it in the next UHD 620 capture.

## Regolith GPU cost (read-only summary, for Cee)

Source: `docs/agent-reports/M1-W2-T04-technical-artist.md` checkpoint 2; STATUS line 74 (W2-T04 still running).

- Target: the regolith should cost "marginal" (< 0.5 ms GPU) on the UHD 620 at Medium.
- Measured on the UHD 620 (WebGPU, Medium, 1280x720, DPR 1, sun 30). These are in-page paired swaps, median delta vs the plain material:
  - Ground view (eye 1.7 m): about 9.5-10.2 ms plain. The current default adds +1.95 ms (it was +2.66 before the cuts). Low path (`single`) adds +1.47 ms. With no taps (`noclose,nofar`) it adds +0.47 ms.
  - Rim view (eye 30 m): +1.07 ms (was +3.34).
  - Ground breakdown: about 0.5 ms fixed ALU, about 0.5 ms for the 3 far taps, about 1.0 ms for the close block.
  - Cross-page A/B runs were noise of about ±1 ms. Only the in-page swap numbers can be trusted.
- Decision pending: getting below 0.5 ms needs fewer taps, for example the Low single-tap path on Medium. The T04 report calls this an owner/lead decision.

### How Cee re-measures on the UHD 620

Run from the repo root on the UHD 620 laptop, plugged in, machine otherwise idle, Node 26:

1. Start the dev server on the port the driver expects:
   `pnpm --filter @moon-cleanup/client exec vite --port 5283 --strictPort`
2. In a second shell, run the in-page paired swap. It uses installed Chrome, off-screen. It needs `tools/screenshots` dependencies installed. Scene URL: `http://localhost:5283/?scene=moon&solo=0&preset=medium&backend=webgpu&sun=30&view=ground`.
   `node docs/agent-reports/M1-W2-T04-evidence/swap.mjs webgpu "sun=30&view=ground" "plain,default,single,noclose+nofar" 8 1500`
   - Output per variant: `p50` and `delta-vs-plain`.
   - Pass = `default` delta < 0.5 ms.
   - Repeat with `sun=5` and `sun=60`.
   - For the rim view, use the query `"sun=30&view=rim"`.
   - Both URL keys are confirmed in `apps/client/src/terrain/terrain-scene.ts`:
     - `sun` = sun elevation in degrees (default 14).
     - `view` = `ground` (default, eye 1.7 m), `rim` (eye 30 m), `pad`, `fence` or `high`.
3. Optional whole-game check (no regolith A/B), about 4 min:
   `pnpm --filter @moon-cleanup/perf device-report`
   It writes `tools/perf/results/device-reports/<id>.{json,md}`. Its cells are pinned to the preset ceiling (`?scale=ceil`), so it does not test the floor.

## Files

Changed: `docs/architecture/rendering-pipeline.md`, `docs/architecture/performance-budgets.md`. Report: this file. Code and tests already matched, so no code edits were needed.
