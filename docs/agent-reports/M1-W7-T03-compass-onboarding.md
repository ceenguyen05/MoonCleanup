# M1-W7-T03 Compass, onboarding, invite UI: audit + capture-guidance flag (2026-11-18)

## Audit against the card
Acceptance already met in the tree (see M1-W7-T03-T06.md): compass (Outpost + Plot Card/objective markers, no Flare Beacons) `ui/hud/CompassStrip.tsx`; Induction Checklist (8 steps from game-data), DOT subtitle/tips, Handbook (H), achievement toasts `ui/onboarding/*` + `app/onboarding-writer.ts`; invite code/link screens + roster `ui/online/*`; waking overlay `ui/screens/WakingOverlay`. Nothing structural was missing.
Gap found: no way to keep first-run guidance off the screen. No "tutorial camera overlay" exists in ui/ or onboarding-writer; the on-screen first-run pieces are the Induction panel (top-left), DOT subtitle (bottom-centre, auto-dismisses) and the waking overlay. None sits on the avatar, but captures still showed them.

## Changes
- `ui/ui-options.ts`: new `guidance` option. `?onboarding=0` turns it off, `?capture=1` implies off, `?onboarding=1` wins.
- `ui/hud/Hud.tsx` (`guidance` prop) + `ui/UiRoot.tsx`: Induction Checklist and DotSubtitle are not mounted when guidance is off.
- `app/onboarding-writer.ts`: `guidance?: boolean` option. When false the checklist is hidden, and no DOT lines and no Handbook badge are raised. Steps and achievements still track.
- Tests (written first): `ui/ui.test.ts` (url parsing), `app/onboarding-writer.test.ts` (guidance off).

## Results
Node 26, vitest on `src/ui/ui.test.ts src/app/onboarding-writer.test.ts src/ui/onboarding`: 3 files, 29/29 pass. `tsc --noEmit -p apps/client`: no errors in ui/ or onboarding files.

## Not run
- Look-check at 1280x720 and 1920x1080 on the UHD 620 (not captured; no GPU lane used). VT-M1-24 still open.
- `pnpm verify`, real-browser H key and clipboard flow.

## Request outside my paths
`app/boot.ts` line ~185: construct the writer with `guidance: new URLSearchParams(win.location.search)` logic matching `parseUiUrlOptions(...).guidance` (import `parseUiUrlOptions` from ui). The UI side already honours the flag with no boot change; the writer flag only stops DOT lines being queued.
