# M1-W6-T07 polish: scroll cue and 0.97 press (ui-ux-motion-designer)

Scope: `apps/client/src/ui/**` only. No git. Source: V3 notes in `M1-W6-T07-visual-rereview-visual-qa-reviewer.md`.

## Status
- Item 1 (scroll cue): DONE in code and tests. Visual capture NOT done (turn limit; a script error stopped the one capture, no screenshots exist).
- Item 2 (0.97 press): DONE in code and tests. Computed-style check in a browser NOT done.

## Item 1: scroll cue in the save-conflict modal
- `save/SaveConflictPrompt.tsx`: the copies body now sits in `.bodyWrap` (positioned, carries the focus-ring pull-back margin). A decorative `.more` overlay (`aria-hidden`, `data-testid="save-prompt-more"`) sits at its bottom: a fade into the panel colour plus a small pill "Scroll for more" with a chevron. It never takes pointer input, so it cannot block a button. The foot stays pinned and visible.
- Visibility is driven by `data-visible`, set from `hasMoreBelow(scrollTop, clientHeight, scrollHeight)` (new, in `save/save-sync-model.ts`), updated on `scroll` of the body element and via `ResizeObserver` (guarded when absent). So it shows only when the body is scrollable and not at the end, and goes away at the end of the scroll. No global listeners.
- CSS: opacity-only transition (160 ms out / 200 ms in via existing fade tokens, 0 ms-equivalent behavior unchanged for reduced motion because it is a plain fade). No transform, so text stays crisp.
- String added to the one strings module: `saveSync.prompt.moreBelow`.

## Item 2: press feedback 0.97
- Spec: `docs/design/art-direction.md` 8.7 (press = 80 ms to scale 0.97, out-cubic; also `ui-screens-and-flows.md` 266 / 600 / 1326).
- There was no shared button component; seven `:active` rules in five CSS modules each used `translateY(var(--mc-px))`. All now use one token, `--mc-press-transform: scale(0.97)` in `tokens/tokens.css`: SaveConflictPrompt, OnlinePanel (3 rules), OnlineEntry, WakingOverlay, HudTestPage (2). The existing `--mc-dur-press` (80 ms; 0 ms under `data-motion="reduced"`) drives the transition, so under reduced motion the press is an instant state with no tween.
- The scale applies only while pressed (transient feedback, as the spec requires); at rest nothing is transformed, so text and icons render at integer sizes. The save-screens rule "no literal `scale(` in save files" still holds because the module uses the token.
- Caveat: buttons in other modules that never had an `:active` rule (e.g. Settings, menu frame) were not touched; they had no press feedback before either. Flag if you want those added.

## Tests added (`save/save.test.tsx`)
- Scroll cue present, decorative, hidden on first render, with its label.
- `hasMoreBelow` boundary cases.
- Every `:active` rule in the four product modules uses `--mc-press-transform`, the token is `scale(0.97)`, and `--mc-dur-press` is 0 ms in reduced motion.

## Checks (Node 26.13.1 on PATH, `apps/client`)
- `vitest run src/ui`: 11 files, 130 tests passed.
- `tsc --noEmit`: clean (earlier run on the same source, no output). A final repeat was started and was still running when this was written.
- `eslint` on `src/ui/save`, `src/ui/tokens`, `src/ui/strings.ts`: clean.
- `prettier --check` on the changed TSX/test/token files: clean (CSS modules were formatted with `--write`).

## Evidence / loose ends
- No screenshots. The capture script failed on a Windows ESM path import (`C:/` instead of a `file://` URL) before writing anything. Capture later at 720x540 and `hudpct=130` using `preview.html?uihud=1&save=conflict&hudpct=130` (the script is in the session scratchpad).
- Dev server on port 5417 stopped (no listener). No browser left running.
- Recommended follow-up for the visual QA reviewer: confirm the cue at 720x540 and UI 130%, and the pressed computed transform (`matrix(0.97, 0, 0, 0.97, 0, 0)`).
