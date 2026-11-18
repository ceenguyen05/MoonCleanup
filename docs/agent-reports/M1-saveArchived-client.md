# M1 saveArchived client (ui-ux-motion-designer)

Status: session + string + server test done; one boot/app hook remains (not in my paths).

## Done
- `apps/client/src/net/room-session.ts`: new optional handler `RoomSessionHandlers.onSaveArchived?()`, fired right after `core.onHello` when `hello.data.saveArchived === true`. Once per HELLO, no per-frame cost, solo flow untouched.
- `apps/client/src/ui/strings.ts`: `notices["notice.save_archived"]` = "Your saved shift was from an older moon and has been archived. Starting fresh."
- `room-session.test.ts`: plain HELLO does not fire, `saveArchived:true` fires once.
- `apps/server/src/net/shift/shift-room-save-archived.test.ts` (new): real ShiftRoom over ws with a store whose `takeArchived` is one-shot true; first joiner HELLO has `saveArchived: true`, second joiner's does not.

## Hook needed (integrator; I did not touch it)
In `apps/client/src/app/online-room.ts` (~line 389 `handlers: {...}`) add:
`onSaveArchived: () => store.dispatch({ type: "notices.push", notice: { priority: "progress", textId: "notice.save_archived", params: {}, mergeKey: "save_archived", actionId: null } })`
using whatever UI store handle that file holds (hud-writer.ts shows the same dispatch shape). Renders through the existing notice stack (`noticeText` resolves the string).

## Evidence
- Server test: 1 passed. Client room-session.test.ts: 25 passed.
- tsc (apps/client): only errors are in untracked `visuals/characters/blockout/__scratch/dump.test.ts` (not mine). Server tsc not rerun; the new test file is covered by the vitest transform only.
- Note: `pnpm` not spawnable via `fnm exec` here; used `node node_modules/vitest/vitest.mjs`.
