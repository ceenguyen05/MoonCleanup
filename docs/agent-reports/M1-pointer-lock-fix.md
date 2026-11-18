# M1 pointer-lock first-click investigation

2026-11-18, gameplay-systems-engineer. Owned path: `apps/client/src/gameplay/input/dom-input.ts`.

**Result: no code change.** The only observed failure was a Chrome-side rejection, not a defect in the input layer. This supersedes the static-only `CODEX-pointer-lock-2026-11-18.md`.

## Method
- Own Vite on :5611 (stopped afterwards).
- Installed Chrome 157, headed, `--window-position=-32000,-32000`, one fresh context per load, 1280x720.
- URL: `?perf=1&audio=0&preset=low&scale=0.5&ground=<flat|terrain>`.
- After `__mcReady` and 3 s, a Playwright mouse move and click at the centre. 1.5 s later the lock state was read.
- An init script logged `pointerlockchange`, `pointerlockerror`, blur, focus, visibilitychange, and every `requestPointerLock` / `exitPointerLock` call. A capture-phase `mousedown` logged the element under the cursor and user activation. Each log entry carries `document.hasFocus()` and visibility.
- Scripts and raw logs are in the scratchpad (`plrepro.cjs`, `plflat.out`, `plterr.out`). They are not part of the repo.

## Evidence
| Lane | Loads | Locked on first click | Failed |
|---|---|---|---|
| flat | 10 | 9 | 1 (load 5) |
| terrain | 10 | 10 | 0 |

In all 20 loads the click landed on the `CANVAS` (the stage's child), not an overlay. `hasFocus` was true, visibility was `visible`, and user activation was active at `mousedown` and at `requestPointerLock`.

The one failure (flat load 5), in order:
1. `mousedown` on CANVAS, focus true, activation true.
2. `reqPL`, called synchronously in the same millisecond, with activation active.
3. About 16 ms later the `requestPointerLock` promise rejected with `WrongDocumentError: The root document of this element is not valid for pointer lock.`
4. `pointerlockerror` fired.
5. No `exitPointerLock`, blur or visibilitychange occurred.

- The menu, blur and visibility handlers never released a lock right after it was acquired. In the 19 successes, `pointerlockchange` was the only event after the request, and no `exitPL` call was logged.
- The input layer made one request, with valid activation and focus, on the right element. Chrome refused it.
- In my own earlier unlogged harness runs (init script syntax error, so no logs) flat also failed 2 of about 7 loads. So the failure is not terrain-specific. The earlier 2/4 terrain versus 0/2 flat is sample noise.
- Most likely cause (not proven): the off-screen headed window is intermittently not OS-active or valid for lock in Chrome. Playwright fakes `hasFocus` and activation, so those values do not rule it out.
- No evidence points to the game code or to terrain. I did not test a human-driven on-screen window.

## Change
None. A fix for this would need a retry or timer on `pointerlockerror`, which the brief rules out as speculative. The existing behaviour is acceptable: the first click fails visibly and the next click locks, and the lock-error handler already clears state and re-syncs `locked`. Existing `dom-input-lock.test.ts` (8 tests) is untouched, and no failing-first test was written because there is no defect to fail on.

## Not run
- On-screen (foreground, human-driven) Chrome to confirm real players do not hit `WrongDocumentError`. Recommend Cee watch for it on the Vercel build.
- The tutorial and menu overlay paths (Induction overlay clicks).
- Unit tests, `pnpm verify`.

## Cleanup
Vite :5611 stopped, all Playwright Chromes closed (checked by command line), GPU lock released. No `STATUS.md` edits.
