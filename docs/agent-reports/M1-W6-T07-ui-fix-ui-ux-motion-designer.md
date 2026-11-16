# M1-W6-T07 UI fix: save-conflict prompt fit and heading focus ring

Agent: ui-ux-motion-designer. Scope: `apps/client/src/ui/**` only. No git.

## Status: both V2 defects fixed; needs visual-qa re-check

## Defect 1: modal overflow
- `save/SaveConflictPrompt.tsx` and `.module.css`: panel no longer scrolls. Title, intro, copies and safety note sit in a scrolling `.body`; the foot ("Decide later", its note, key hints) is a pinned sibling, so the way out is always visible.
- Removed the reserved empty status row. Status now shares the foot row and replaces the "Decide later" note while shown (still `role="status"`), so messages cause no layout jump.
- Copy rows use one shared two-column grid; "Saved" values stay on one line.
- `@media (max-height: 800px)`: tighter padding, gaps and card spacing.
- Dialog is top-anchored at a rounded offset instead of flex-centred, so no half-pixel positions.
- Measured (`M1-W6-T07-ui-fix-evidence/`): at 1280x720 DPR 1/2/3 the panel is 591 px high at y=60..651. The body does not scroll, "Decide later" is at 537..577 and the key hint ends at y=605. Previously content was 719 px in a 656 px panel.
- 1920x1080 fits (panel 240..887). 720x540 and UI size 130% scroll only the copies; the foot stays visible (1280x720 at 130%: foot ends y=678 of 720).

## Defect 2: heading focus box
- `tokens/tokens.css`: global ring is now `#mc-ui :focus-visible:not(h1..h6)`. Script-focused headings (prompt, menus, online, remap) get no ring; buttons, inputs and roving-tabindex controls still do. Measured `outline-style: none` on the focused H2.

## Checks (Node 26.13.1)
- Client vitest `src/ui`: 11 files, 127 tests pass. New `ui/focus-ring-rule.test.ts` (2 tests: ring excludes headings; panel hidden / body scrolls / foot outside the scroller).
- `tsc --noEmit` clean; eslint clean on touched files; prettier check clean.
- Screenshots: `docs/agent-reports/M1-W6-T07-ui-fix-evidence/conflict-{1280x720-dpr1,1280x720-dpr2,1280x720-dpr3,1920x1080-dpr1,720x540-dpr1,1280x720-ui130-dpr1}.png`. All were captured; DPR 2, 720x540, UI 130% and DPR 1 were viewed. Dev server (port 5392) stopped.

## Notes
- DPR 1.25/1.5 not re-captured; layout metrics are DPR-independent (identical at 1/2/3). No browser-zoom pass.
- No scroll-shadow affordance: a first attempt painted a visible band, so it was removed. When scrolling is needed, a cut-off card and the thin scrollbar are the cues.
- Not addressed (out of brief): pad-nav integration test, footer separators, Settings restore-confirm box spacing.
