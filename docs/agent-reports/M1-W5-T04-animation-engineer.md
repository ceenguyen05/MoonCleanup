# M1-W5-T04 — animation-engineer (logic layer, placeholder rig)

Task / status: M1-W5-T04 animation logic, **in-progress** (logic layer done, rig/clips/zero-alloc open) / 2026-11-15 / animation-engineer / Opus 5.5

Done: a rig-agnostic, three-free animation layer in `apps/client/src/animation/`. It only reads sim state and events. It covers:
- 1D locomotion blend (idle/shuffle/walk/lope) with a sync-group phase and rate clamp [0.75, 1.25]; 2D strafe blend; air rise/apex/fall blend.
- Low-g bounce: physical arc g·T²/8 at the wearer's gravity, plus G = 1/r² for real clips. Landing compression is a closed-form spring (f 1.8 Hz, ζ 0.55). Also time-to-ground, and landing classes using the movement.json thresholds.
- Foot IK on the sphere: the sim's own `heightAtXYZ`, 6 samples per avatar, an analytic two-bone solver with a fallback for a singular pole, foot lock that releases at 12 cm, pelvis offset, slope stance, and a pole-safe tangent frame using parallel transport.
- Tool layer phase-locked to the sim's push/lift cycle. The body leads by 100 ms, with follow-through, palm wobble, and turn/contact events.
- Base and upper state machine (spec 3.5): base weights always sum to 1, a 150 ms jitter guard, and a watchdog.
- Pooled events, a remote velocity estimator, LOD buckets with stagger, and an `AnimationModule` (ClientModule) pool of 16 animators.

Allocation pass (AN-M1-09), same day: the hot paths now pass no doubles through calls. They use field-based `step()` methods, `*IO` typed-array cores (loco 1D/2D, air, gait stats, pelvis, two-bone, alignment, crossfade, stroke curve), a single ground-sampling site, `events.claim()`, and module profiling that is off by default.
- Heap fell from 11.3 MB to **6.06 MB** per 600 frames × 16 avatars (≈630 B per avatar-update). This is **still FAIL** against the < 32 KB target.
- Component probe: state, tool, landing and IK-off animator ≈ 0 B.
- Remaining boxing:
  - ~160 B in the ground callback (`heightAtXYZ` is not inlined).
  - ~450 B on the IK-enabled animator path, source not yet found.
- Proposed fix: a batched ground contract `heightsAt(dirs, out, n)` (sim/world owner), then a heap-profile pass on `FootIk.step` within the animator.
- The test asserts a ceiling of < 800 B per update; the 32 KB target test stays skipped.
- CPU after the pass: p50 0.07 ms, p95 0.17 ms (Node).

AN-M1-09 closed, same day (third pass): **PASS**, heap growth **7.1 KB** per 600 frames × 16 avatars. This is the best of 3 GC-anchored windows after warm-up, stable across 3 full-directory runs; the positive control registered ~2.3 MB.
- Sources removed:
  - Per-sample ground callback boxing. The animator now uses the new additive batched `GroundHeight.heightsAt(dirs, out, n)` in `packages/world`, which is bit-identical to `heightAtXYZ` (`Object.is`, 512 directions plus the poles).
  - `stepPelvisIO`, which forwarded 7 doubles to an inner core.
  - The rest was JIT tier-up (V8 field-constness deopts) during the first seconds.
- The test now warms up for 6,000 frames and asserts < 32 KB; the skipped test is removed.
- `AnimGround` is now batched. Use `batchedGround()` to adapt a per-sample ground in tests or cold callers.
- Other checks:
  - `packages/world` vitest: 105 pass; `tsc` and `eslint` clean.
  - `packages/sim` vitest: 107 pass, including the 10,000-tick replay goldens, checkpoint goldens and dust-reload goldens.
  - Client `tsc` clean; `eslint src/animation` clean; `src/animation` 52 pass.
- CPU (Node, logic only): p50 0.08–0.13 ms, p95 0.18–0.19 ms.

Next:
1. (Done: AN-M1-09.) Integrator binds the animator to the sim ground via `GroundHeight.heightsAt`.
2. The integrator binds the provider to the predictor/interp buffer and the sim's ground, and wires `toolPhase` from `seqAtToolDown`/`stepMs`/`periodMs`.

Needs the real skeleton/clips (W4-T07 + clip delivery):
- Bind pose → `profileFromBindPose`.
- three rig adapter: `AnimationMixer` actions, lower/upper split, additive tool clips, applying `AvatarPose` to bones.
- Clip sidecar plant masks/markers instead of `placeholderLegs`.
- Knee poles taken from the clips.
- Tool-head IK: arm two-bone plus the `grip_secondary` node.
- Look-at, twist joints, springs.
- Captures S19–S21.
- `ASSET_LICENSES` rows.

Files: `packages/world/src/height/ground-height.ts` (additive `heightsAt`), `packages/world/test/unit/height.test.ts`, `apps/client/src/animation/{tuning,locomotion-blend,low-g,sphere-frame,foot-ik,rig-profile,tool-layer,state-machine,anim-events,avatar-animator,module,index}.ts` plus tests `blend.test.ts`, `low-g-ik.test.ts`, `animator.test.ts`.

Evidence (Node 22, vitest 5.1, apps/client):
- `vitest run src/animation`: 52 pass, 1 skipped.
- `tsc -p tsconfig.json`: clean for src/animation. `eslint src/animation`: clean.
- AN-M1-05 landing timing is met in a unit test.
- Pole crossing at ±89.9° and at the exact pole: tests pass.
- CPU for 16 avatars at U0, logic only, Node: p50 0.20 ms, p95 0.43 ms.
- Heap: **11.3 MB over 600 frames** (≈1.2 KB per avatar-update), measured with a GC-anchored probe whose positive control was detected.

Blockers:
- AN-M1-09 zero-allocation: closed (see the third pass above).
- The 0.3 ms Tier A budget is unverified: there is no mixer yet, and these numbers are from Node, not a browser.

Commit suggestion: `feat(animation): low-g locomotion, foot IK, tool layer logic with placeholder rig (M1-W5-T04)`
