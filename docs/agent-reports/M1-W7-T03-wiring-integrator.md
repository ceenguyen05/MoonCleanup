# M1-W7-T03 onboarding app wiring (integrator)

Status: PARTIAL (wiring complete and tested at unit level; compass marker bearings blocked on a UI owner change; no runtime/browser check run).
Scope: `apps/client/src/app/**` only. No browser opened.

## Added (apps/client/src/app/)
- `onboarding-writer.ts` (+ test): `OnboardingWriter` follows the `roomHost` facade. Seeds `checklist` (mode induction, 8 items from game-data `onboarding.induction`) and `achievements` (all game-data ids, `unlockedAtMs` null so later unlocks toast as fresh). Own-slot events complete steps: `dust.collected` (firstStroke), `cell.full`, `cargo.sold` at `assay_counter`, `plot.polished`, `purchase.completed` (`tool.crescent_squeegee`, `node.dust_cell_*`), `collectible.found` (`stray_cargo` / `near_parcel`), plus `onboarding.step_completed` if the sim ever emits it. Plot Card step comes from `UiFrameBridge.onInspect(true)`. `achievement.unlocked` (own slot) sets `unlockedAtMs`. DOT lines via `dot.say`: `dot.induction_start` + `dot.tip_handbook` (keep, once), `dot.induction_complete`, `tip_cell_full`, `tip_first_night`, `tip_plot_stamped {remaining}` (once each), `tip_shine_milestone {pct}`. Step progress persists in localStorage (`mc.onboarding.induction.v1`); failures go through the error boundary.
- `handbook-key.ts` (+ test): H (kbm) toggles `menus.open handbook` / `menus.back`; ignores repeat, modifiers, text fields, and any other open surface or modal. Done at app level, so `gameplay/input` is untouched.
- `objective-markers.ts` (+ test): per active step sets `compass.objectiveMarkerId` and calls `setMarkerBearing` (10 Hz, change-only, reused vectors). Mapping: first_stroke / polish_apron_plot -> `landing_apron`; pour -> `assay_counter`; buy steps -> `requisitions_desk`; find_near_parcel -> `near_parcel` (nearest uncollected). `markerSink` forwards to `UiModule.setMarkerBearing` if present, else warns once.
- `boot.ts`: constructs the writer, feeds the game-data catalog in the existing lazy chunk, installs the H key (gameplay only), adds markers to `interactionPump`, `onInspect` calls `plotCardOpened()`.

## Evidence
- `vitest` (Node 22): onboarding-writer, handbook-key, objective-markers, app, boot-wiring, round5-wiring, ui-reducer: 7 files, 55 tests passed (log `%TEMP%/w7t03-vitest2.log`).
- `tsc --noEmit -p apps/client`: no errors in app/ or ui/. Only 2 pre-existing errors in `src/terrain/terrain-material-hook.test.ts:21-22` (terrain owner).
- prettier run on all touched files. Full `pnpm verify` NOT run (lead owns the final one).

## Returned to owners (not patched)
1. UI owner: `apps/client/src/ui/module.tsx` ~line 206 has `setOutpostBearing` but no `setMarkerBearing(id, deg)` forwarding to `this.parcels.setMarkerBearing` (parcels-store.tsx:59). Until added, the objective label shows (compass.objectiveMarkerId) but the marker is not drawn (a one-time console warning says so). Remove the `markerSink` shim afterwards.
2. Sim/contracts owner: no Landing Apron plot position exists, so `landing_apron` points at home outpost 0 (Boreal). The `outpost_boreal` marker id is unused (no step needs it). The sim does not emit `onboarding.step_completed`, and "first stroke / polish" are not restricted to the Apron plot (any plot).
3. Optional: `handbookUnread` is never incremented; the writer does not set it.

## Not done
No real-browser or real-server check; no multi-step Solo-host integration test (events are faked); online-room remote slot uses `store.shift.mySlot` like HudWriter.
