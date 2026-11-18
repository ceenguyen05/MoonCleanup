# M1 app writers: Handbook unread dot + objectiveDistanceM

## Changes
- Unread: UI (DotSubtitle badge, Handbook clears on open, strings) already existed but nothing ever raised `dot.handbookUnread`. `app/onboarding-writer.ts` `tipOnce` now bumps it by 1 per new tip (once per session per tip). Outside the stated ownership list; one-line change, flag if you want it elsewhere.
- Distance: `app/objective-markers.ts` gains optional `moonRadiusM`; it writes `compass.objectiveDistanceM` (whole metres, great-circle `R*acos(dot)`) from the existing 10 Hz pump, change-only (no dispatch/allocation while the value holds), null when no place or marker clears. No radius -> no distance written.
- HUD: `CompassStrip` objective chip shows the distance (`STRINGS...compass.objectiveDistance` "{m} m", `data-testid=hud-objective-distance`).
- No sim-host/messages.ts change needed.

## boot.ts hook needed (integrator)
Pass `moonRadiusM` (already in scope as `gameData.world.moonRadiusM`) to the `new ObjectiveMarkers({...})` call at boot.ts ~485. Until then the distance stays null.

## Verified
- vitest: objective-markers.test.ts (new distance test) + onboarding-writer tests: 12/12 pass. `tsc --noEmit` on apps/client clean.

## Not run
- Full pnpm verify, screenshots/DPR check of the new chip text, a dedicated test of the unread bump.

## Defects
- None found.
