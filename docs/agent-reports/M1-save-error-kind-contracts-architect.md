# M1 save error kind (local_store_failed) - contracts-architect

Status: done. Additive, no version bump (vocabulary addition is non-breaking per sync-rules header).

## Change
- `packages/shared/src/save/sync-rules.ts`: `SAVE_UPLOAD_FAILURE_KINDS` gains `local_store_failed` (appended last). Doc comment: device could not write the local store or install a copy; never from HTTP; no reason; unknown consumers treat it like `server_error` for retry.
- `apps/client/src/app/save-sync-wiring.ts` `requestFailurePatch`: `why: "local" | "install"` now maps to `local_store_failed`. `corrupt`, `too_large`, `mixed_generation` and the like stay `rejected`; download/upload/null stay `server_error`.
- `apps/client/src/ui/strings.ts` (single separate line, line 378, required by the `errorKinds` record type): `local_store_failed: "This device could not save the copy."` No CSS/layout touched. UI owner: this line is the only edit in ui/**.
- Consumers: `save-sync.ts` TRANSIENT does not include it, so state is `error` (not offline), correct. `save-sync-model.ts` indexes `errorKinds` by kind, now covered. Events/UI slice types follow the enum automatically.

## Tests
- shared `sync-rules.test.ts`: exact ordered list, parse, stranger rejected, type-level union.
- client `save-sync-wiring.test.ts`: install and local map to `local_store_failed`; corrupt still `rejected`.

## Evidence (Node 26.13.1)
vitest shared (save + events/save) 36 pass; client (wiring, sync, ui/save) 70 pass; tsc shared and client clean; eslint and prettier clean on touched files.

## Follow-ups
- UI owner may want `SaveSettings`/prompt wording reviewed; no layout impact expected.
