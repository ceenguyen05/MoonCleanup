# W3-T07 Solo custodian integration

2026-11-17. Temporary Codex worker. Ownership: app/boot.ts and narrow new app integration modules/tests. Character and terrain sources remain owned by other workers. No git mutations or servers started.

## Done

- Read CLAUDE.md, STATUS, MODEL_POLICY, REFERENCE_TARGET and the technical artist's W3-T07 report.
- Added lazy `app/solo-avatar.ts`: fills the local animation slot from the actual Solo predictor's velocity, facing, grounded state, height, landing impact and one-shot jump. Position is the same smoothed/predicted feet used by the gameplay camera, including floating-origin/debug presentation shifts.
- Uses the actual `GroundHeight.heightsAt` on terrain and a batched zero-height provider on flat ground. No frame-local arrays/objects are created by the new provider or module wrapper; full integration heap measurement is NOT RUN.
- Loaded custodian + Desk Duster view replaces the gameplay capsule only after assets load. Failed asset load reports the error and retains the capsule. Capture/look-dev and non-player lanes do not load the avatar chunk.
- Frame order remains gameplay -> animation -> custodian pose -> visuals/render. Local avatar hides in first person. Own avatar is suppressed while driving because the delivered blockout has no seated pose.
- Authoritative shift state selects the held tool class. Work/contact animation remains off because true sim phase/contact data is not exposed. No fabricated working animation.
- Cold online binding proxy restores the Solo provider/local slot on online unbind; no per-frame network import/poll was added.
- Model/view/cast and host/shift subscriptions dispose with the animation frame module.

## Checks and evidence

- Node 26 via fnm: client `tsc -p apps/client/tsconfig.json` PASS.
- Focused `solo-avatar.test.ts` + `boot-wiring.test.ts`: 18/18 PASS (final run 9.76 s). Covers presented feet vs physical state, true air/landing data, jump edge, absent/remote/driving suppression, authoritative tool class without false contact, online-to-Solo binding restoration.
- ESLint PASS for boot.ts and both new app files. Prettier applied to those files.
- Headless installed Chrome, real Intel UHD 620, WebGPU Medium, 1280x720/DPR1: flat and opt-in terrain game both booted, predicted local host running, zero FRAME decode errors, actual third-person custodian rendered. Keyboard walk changed position approximately 14 m in each lane. No browser console errors/page errors recorded. Browser closed in `finally`.
- New evidence: `CODEX-W3-T07-solo-integration-evidence/{flat,terrain}-{idle,walk-0,walk-1,walk-2,jump}.png` and `smoke.json`. Inspected flat idle and terrain walking frames. The live induction toast obscures much of the torso; suit is dark from this camera/light angle. These captures prove hookup, not animation/look/performance acceptance.
- Startup-heavy timing includes multi-second compilation stalls and screenshots; no FPS budget PASS claimed. The terrain walking frame shows nonzero animation work (~0.38 ms displayed), but this is not an isolated measurement.
- All started processes stopped: Vite on 5295 interrupted, listen-port check empty; Playwright browser closed; checks completed. No git writes.

## Not run

- WebGL2 integrated gameplay, asset-load-failure browser exercise, online end-to-end return-to-Solo, isolated CPU/heap measurement, final `pnpm verify` (explicitly out of scope).
- Deterministic motion/ground-contact acceptance remains with character worker and subsequent integrated QA. The smoke's jump screenshot alone does not certify jump/landing motion.

## Open scope

- First-person held tool/shadow, seated pose and non-palm tool models remain existing upstream limitations.
- **Authoritative tool telemetry gap:** `SelfState` FRAME and `RoomHost` expose no sweeping/phase/head/contact fields. `sim-host/readouts.ts` only provides HUD readouts at <=10 Hz and is inappropriate for a smooth sim-phase feed. Targeted follow-up could add pooled private fields to the Solo frame message in `sim-host/messages.ts`, fill them in `worker-core.ts`, expose a reused tool-animation snapshot on concrete `LocalRoomHostImpl` in `local-room-host.ts`, and consume that optional concrete method here. Derive phase from the authoritative tool `seqAtToolDown`/processed input seq, period and stepMs; include `sweeping`, `inContact`, `headValid`, head position and tool code. Check the RoomSim public surface before adding any sim accessor. This avoids changing the shared RoomHost/protocol contract or adding net code to Solo.
- Half-done feature paths: `app/solo-avatar.ts` and its boot hookup are intentionally locomotion/held-tool only; W3-T07 working scrub is incomplete until actual telemetry exists. Report this item partial, not complete.
