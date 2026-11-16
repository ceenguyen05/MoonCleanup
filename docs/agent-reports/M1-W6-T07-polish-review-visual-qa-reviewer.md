# M1-W6-T07 polish review (visual-qa-reviewer)

Source read-only, no git. Reviewing `M1-W6-T07-polish-ui-ux-motion-designer.md`. Headless Chromium (software rendering, no Tier A/B claim), Vite `_qa.vite.config.mjs` on port 5461 (stopped; no listener left), page `/src/ui/dev/preview.html?uihud=1&save=conflict[&hudpct=130]`, DPR 1, native-resolution PNGs. Evidence: `docs/agent-reports/M1-W6-T07-polish-evidence/` (`capture-log.txt` has the raw measurements; every PNG cited was viewed). No page errors in any run.

## Verdicts
| # | Item | Verdict |
|---|---|---|
| 1a | 1280x720 DPR1 control: no cue when not scrollable | PASS |
| 1b | 720x540: cue visible when scrollable and not at end; hidden at end | PASS (minor note) |
| 1c | UI size 130% at 720x540: same | PASS (minor note) |
| 1d | Foot pinned, no clipping, readable | PASS |
| 2a | `:active` button computes `scale(0.97)` | PASS |
| 2b | Reduced motion has no transform animation | PASS |
| 3 | tsc / eslint / prettier on src/ui, Node 26.13.1 | tsc PASS, eslint PASS, prettier FAIL (2 files) |

## Item 1 detail
- Control, `conflict-1280x720-dpr1-top.png`: body scrollHeight 474 = clientHeight 474, `data-visible` absent, opacity 0. Both copy cards fit, no pill. Correct.
- 720x540, `conflict-720x540-dpr1-top.png`: body 756 scroll vs 391 client. `data-visible="true"`, opacity 1, pill "Scroll for more" with chevron centered above the footer, fade into the panel colour. `...-end.png`: scrollTop 365 (max), cue opacity 0, cue gone. Foot (Decide later, hint, key line) at y 427-508 in both states, identical, inside the 540 viewport; no clipping of the panel or foot.
- UI 130% at 720x540, `conflict-720x540-ui130-top.png`: body 1057 vs 307 client; cue visible (pill 46 px high, scales with UI size); `...-end.png` scrollTop 750, cue hidden. Foot at y 357-498 pinned in both. Also checked 1280x720 at 130% (body 610 vs 523): cue shows until the end (scrollTop 87), then hides.
- Minor notes (not blocking): the pill sits over the faded content, so at 720x540 the hint line "Continue with the copy on this device... " runs up to the pill edges and the row "Windows PC" is half under the fade at 130%. The pill label itself is crisp and readable. Content is hard-clipped at the top edge when scrolled (no top fade); acceptable. Suggest a slightly more opaque pill background if you want zero text bleed.

## Item 2 detail (`capture-log.txt`, `pressed-normal.png`, `pressed-reduced.png`)
- Normal motion, mouse down on `save-choose-keep_local`: computed transform goes `none` at rest, then `matrix(0.970151,...)` at ~25 ms, then `matrix(0.97, 0, 0, 0.97, 0, 0)` and holds. Transition `transform 0.08s cubic-bezier(0.33, 1, 0.68, 1)` (80 ms, out-cubic as in art-direction 8.7). Rest returns to `none` (no scale at rest, text stays crisp).
- Reduced (`data-motion="reduced"`, plus OS reduced-motion emulated): the pressed state is already `matrix(0.97,...)` at the first sample (instant), the transition has zero duration (computed `transition` shows no time value, `--mc-dur-press` 0 ms), `getAnimations()` length 0. So the press is a static state, no transform tween. The scale itself is a state change, not an animation; matches the author's stated design.

## Item 3 (Node 26.13.1, `apps/client`, not fixed)
- `tsc --noEmit -p tsconfig.json`: exit 0, no output.
- `eslint src/ui`: exit 0, no output.
- `prettier --check src/ui`: exit 1. Failures: `src/ui/online/online-model.ts`, `src/ui/online/online.test.tsx` (outside the files the polish author said they touched; the author only checked the changed files).

## Overall
Polish visuals and press feedback confirmed. One non-blocking prettier issue for the owner of `src/ui/online/**` to format.
