# First-click pointer lock investigation

2026-11-18, temporary Codex worker. Scope: `apps/client/src/gameplay/input/dom-input.ts` and narrow regression tests. Reproduce terrain's intermittent first-click lock failure, investigate lifecycle/user activation, fix only an evidenced cause. No speculative request retries or timers.

Initial evidence: terrain acceptance recorded 2/4 terrain first-click failures versus 0/2 flat failures; the later diagnostic run locked normally, without pointerlockerror. Existing input invokes `requestPointerLock` synchronously on canvas mousedown, refuses suspended/hidden input, and releases lock on blur/visibility/page exit/menu suspension. Promise rejections are swallowed. Browser lane requested from lead; no browser/server started yet. Static lifecycle tracing in progress.
