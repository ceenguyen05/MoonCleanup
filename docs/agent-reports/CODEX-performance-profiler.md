# Codex performance profiler

Status: CHECKPOINT COMPLETE / PARTIAL EVIDENCE (2026-11-17). Scope: read-only code; local UHD 620 device capture, regolith paired swaps, Windows SIGTERM and webgpu-compat checks. No source edits or full verify.

## Done
- Read CLAUDE.md, STATUS pause checkpoint, MODEL_POLICY, Medium 0.75 report and tools/perf instructions.

## Not run yet
- Real-GPU device matrix; regolith remeasurement; Windows SIGTERM; webgpu-compat.

## Constraints
- No visible popups. Headless/off-screen Chrome only. Real GPU must be identified; software results are invalid.
- swap.mjs mutates materials in-page only; any harness adaptation will be isolated in temporary files.
- All started processes must be stopped.
## Progress 1
- Original device-report running off-screen Chrome (Node v26.13.1); Intel adapter and timestamp-query confirmed. Bench uses real terrain, not placeholder.
- Preliminary bench: WebGPU Low 30.2 fps / frame p95 49.5 ms; Medium 22.3 / 64.3; High 8.8 / 139.0. WebGL2 Low 39.2 / 36.8; Medium 28.0 / 53.9. Await full artifact; these are not acceptance passes.
- fnm cannot directly spawn pnpm shim; existing tsx CLI invoked with Node 26 instead.
- First isolated memory-server SIGTERM attempt timed out waiting for /healthz and was stopped. Diagnosing once with captured boot output.
- Shared machine is active, so GPU numbers are provisional/noisy. Other applications were left alone.
## SIGTERM checkpoint
- Two local Windows boots used Node 26 `--import tsx`, apps/server/src/app/index.ts, explicit memory persistence, ws transport, port 5297, and dummy test auth values. No env file loaded and production database variables removed.
- Both logged only server config and failed the /healthz readiness wait. The children were killed in finally cleanup. Actual SIGTERM delivery was NOT REACHED; no shutdown or room-checkpoint claim.
- Per lead, no further boot retries under this load.
## Device matrix DONE
- Command: `fnm exec --using=26 node tools/perf/node_modules/tsx/dist/cli.mjs tools/perf/src/cli.ts device-report --verdict --warmup 4 --duration 10`.
- Exit 0, 12/12 captured, original harness cleanup completed. Installed Chrome, off-screen, 1920x1080 DPR1; scales Low .75, Medium .85, High 1.00 (preset ceilings; does NOT test the Medium .75 floor).
- Evidence: `tools/perf/results/device-reports/84e3a171ebf5.json` and `.md`.
- Actual renderer: ANGLE Intel UHD Graphics 620 (0x00005917), D3D11; softwareRenderer=false; Intel WebGPU adapter, timestamp-query available. Real hardware, not SwiftShader.

| Scene | Backend | Preset | FPS | Frame p95 ms |
| --- | --- | --- | ---: | ---: |
| bench | WebGPU | Low | 30.2 | 49.5 |
| bench | WebGPU | Medium | 22.3 | 64.3 |
| bench | WebGPU | High | 8.8 | 139.0 |
| bench | WebGL2 | Low | 39.2 | 36.8 |
| bench | WebGL2 | Medium | 28.0 | 53.9 |
| bench | WebGL2 | High | 11.8 | 124.6 |
| s01 | WebGPU | Low | 34.2 | 45.6 |
| s01 | WebGPU | Medium | 23.9 | 64.3 |
| s01 | WebGPU | High | 8.0 | 137.1 |
| s01 | WebGL2 | Low | 47.7 | 36.0 |
| s01 | WebGL2 | Medium | 36.6 | 40.4 |
| s01 | WebGL2 | High | 10.8 | 131.6 |

### Findings and limits
- No floor performance pass: all four Low scene/backend comparisons exceeded 33.3 ms frame p95. Bench Low draws also exceed 350 (WebGPU 425.5; WebGL2 378.5). Draw count is independent of machine load.
- Medium bench WebGPU draws 489 >350. S01 Medium GPU p95 39.5 >28 ms; Low GPU p95 26.1 <=28 ms. Bench GPU timestamps were n/a despite device support.
- UHD620 is the iGPU-floor device, not Tier A RTX nor the specified Tier B Iris Xe/Arc140V/780M. Those Tier A/B rows are provisional and cannot close those hardware gates.
- Shared laptop remained active; frame-time evidence is a noisy observed failure, not a quiet-machine regression attribution. No other applications were stopped.
- S06 and a Medium .75 floor run NOT RUN by this matrix.
## webgpu-compat DONE (probe only)
- Real-GPU `?scene=verify&row=11&backend=webgpu&preset=medium&solo=0`, 1280x720 DPR1, off-screen installed Chrome.
- Existing row11 verdict PASS: compatibility adapter returned; three r187 exposes boolean compatibilityMode.
- Facts: compatAdapter=true; compatAdapterHasCoreFeatures=true; coreAdapter=true; isWebGPUBackend=true; compatibilityModeFlag=false; actual backend=webgpu.
- Compatibility-only rendering NOT RUN: this hardware exposes core WebGPU even for the compatibility feature-level adapter. URL naming alone cannot force a compatibility-only device. This probe does not establish that branch's visual/performance parity.

## Regolith progress
- Temporary driver follows original swap.mjs in-page procedure: same launch flags, Medium, 1280x720 DPR1, variants plain/default/single/noclose,nofar, alternating forward/reverse cycle order, 2500ms variant prewarm, eight cycles, 300ms settle +1500ms measure.
- Added row11 before measurements and finally cleanup; no source modification. Local Vite on a free loopback port.
- First sun30 ground: default paired median +1.82ms vs plain ~10.38ms, misses <0.5ms target.
- Timing defect: exact 0 GPU ms samples appear in multiple windows (4/8 in the first no-tap variant). Treat these as missing timing; do not count them as zero-cost renders. Report valid nonzero pairs separately. Warmup also reports timedOut=true (~19s), pipelines continued after warmup.
## Regolith final checkpoint (PARTIAL; no marginal-cost pass)

| Scene | Variant | Valid nonzero pairs / 8 | Paired upper-median delta ms |
| --- | --- | ---: | ---: |
| sun30 ground | default | 7 | +1.820 |
| sun30 ground | single | 6 | +1.588 |
| sun30 ground | noclose,nofar | 4 | +1.517 |
| sun5 ground | default | 7 | +1.894 |
| sun5 ground | single | 7 | +1.538 |
| sun5 ground | noclose,nofar | 7 | -0.098 |

Use original swap.mjs upper-middle median convention, but exclude any pair with a zero plain or variant timestamp. The original unfiltered estimator printed default +1.820/+2.020ms; it printed no-taps +1.439/+0.629ms, showing why zero readings cannot be interpreted as real timings.

- Sun30 plain nonzero median 10.381ms; default nonzero median 12.209ms. Final render scale .75; dynres steps=0. Default remains well above the <.5ms marginal target, consistent with the owner's provisional ~2ms acceptance.
- Sun5 final scale .75 but dynres steps=2; because the original procedure does not pin scale, this condition can change scale between variants. Sun5 paired deltas are **confounded**, not an acceptance result. Default positive cost persisted; negative no-taps delta is not a claimed optimization gain.
- Sun60 ground and sun30 rim NOT COMPLETED: page.evaluate threw `Execution context was destroyed, most likely because of a navigation` while starting the third condition. A Vite reload during concurrent source work is plausible but was not proven. No retries while another GPU consumer was waiting.
- Whole temporary runner exit 1 after preserving the two completed sets. Finally cleanup closed Chrome and killed local Vite PID 33292. GPU window released to custodian worker promptly.

### Raw samples (ms, cycle order)

sun30 ground:
- plain: 0,10.466919,10.529670,10.337924,10.295173,10.380671,10.350420,10.404752
- default: 0,10.187425,12.312392,12.157558,12.173479,12.754800,12.958214,12.209308
- single: 0,9.689931,13.724038,0,12.874465,11.846649,11.938646,11.876147
- noclose,nofar: 0,0,0,0,11.804233,11.913481,11.867565,11.843400

sun5 ground:
- plain: 0,10.725330,10.602832,10.601754,10.633502,9.046691,8.826030,9.860596
- default: 10.191425,13.697288,12.623302,12.493808,12.378723,11.729899,10.720165,10.676584
- single: 0,12.263225,12.251059,11.901232,12.051393,11.307658,11.426990,11.321158
- noclose,nofar: 10.750833,11.354571,10.346754,10.504000,10.527834,10.007176,10.400423,9.600683

## Cleanup VERIFIED
- Original device-report exited 0 through its cleanup handler.
- Temporary GPU driver closed its browser and killed its Vite process in finally; PID33292 absent on follow-up.
- Both memory server children stopped after startup timeouts; port5297 has no listener.
- No profiler runner/device-report Node process remained in targeted process inspection.
- Only this new report was edited in docs. No source or git mutations; no full verify; no production/paid action.

## Remaining checks
- Quiet-machine floor capture (including S06 and Medium .75) remains open.
- Complete regolith sun60/rim and repeat sparse/confounded cells with valid GPU timing and fixed render scale; coordinate a stable source/GPU window.
- Real Windows SIGTERM drain still blocked at local server boot readiness; no signal/checkpoint pass.
- Genuine compatibility-only GPU rendering and actual Tier A/Tier B devices remain unmeasured.

