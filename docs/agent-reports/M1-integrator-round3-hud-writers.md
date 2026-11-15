# M1 integrator round 3: HUD store writers (integrator)

**Status: done for shift/wallet/Shine/Holster/day ring/Next Requisition/notices; interaction prompt and Hop/lamp not written (no source, see Open).** Date: 2026-11-15. Model: Opus 5.5. No git.
Not touched: `ui/hud/*`, `packages/sim`, visuals/terrain/render, sim-host source.

## Wiring
- New `apps/client/src/app/hud-writer.ts`: `HudWriter` follows the `roomHost` facade (`follow(service)`), listens to `onShiftState`, `onEvent`, `onStateChange`. Listeners only copy numbers and set dirty flags. `pump(nowMs)` writes slices at most `HUD_WRITE_HZ` = 10 per second, returns at once with no allocation when nothing is dirty. Rare discrete events (Stamp, sale, purchase, milestone, Cell full, funding tick) dispatch deltas/notices immediately; the store still applies them at its 15 Hz flush.
- `withHudPump(store, writer)`: the store handed to `UiModule` calls `writer.pump(now)` just before `store.flush(now)` (same state and listeners). The registered `uiStore` service is unchanged.
- `app/boot.ts`: builds the writer after `roomHost` is registered, disposes it on teardown, loads the tool catalog (ids, `cellBaseKg`) from `@moon-cleanup/game-data` in a lazy import (failure goes to the error boundary).

## Slice mapping
| Slice | Source |
| --- | --- |
| `shift.set {ready, contractId, shiftType, elapsedS}` | host `running` and a shift state received; `ready:false` when the host is unpublished. `open` shift type is not written (UiShiftType has no `open`). |
| `wallet.set {lm}` / `wallet.delta` (settle:true) | `walletLumens`; deltas: `plot.polished` stampLm (stamp), `cargo.sold` (sale), `purchase.completed` (-price, purchase) |
| `shine.set {polished,total,pct,milestonePct}` | `shinePolished`/`plotCount`; `shine.milestone` |
| `holster.set {slots,active:0,slotCount}` | own player's `equippedTool`/`toolsOwned`, `suitGear["gear.holster_rig"]` (2 slots at level 1+), `suitGear["cellLevel.<tool>"]`; live Cell from `dust.collected`/`cell.full` (own slot), emptied on own `cargo.sold`; written only when the gauge changes by 10 g |
| `suit.set {day}` | `daynight.changed` (isDay = day/dawn, minutes to terminator; ringFrac01 kept) |
| `nextReq.set` | `requisition.progress` (itemId, fundedPct, lastPingStep); 100% on purchase of the tracked item |
| `notices.push` | `notice.plot_polished {plot}` (ambient, own credit), `notice.shine_milestone {pct}` (progress), `notice.cell_full` (action, actionId `pour`), `notice.requisition_approved` (progress), `notice.requisition_funded {pct}` (ambient); one merge key per kind |

Own slot: 0 on a local host, `shift.mySlot` from the store on a remote host. No new text ids needed; `notice.plot_stamped` and all `prompt.*` ids are unused for now.

## Evidence
- `pnpm exec vitest run src/app/hud-writer.test.ts`: 3/3 pass. (1) a real Solo `LocalRoomHostImpl` (channel worker, manual clock, 300 scripted ticks): `shift.ready` true, wallet/Shine equal the host's shift state, Holster slot 0 = equipped tool id with Cell kg = last `dust.collected`; unpublishing sets `ready:false`. (2) events give the expected delta, four notice ids, nextReq, milestone, day ring. (3) 30 dust events inside one 100 ms interval give one Holster write; an idle pump dispatches nothing.
- `pnpm exec vitest run src/app`: 12 files, 82/82 pass. `tsc --noEmit -p apps/client`: 0 errors. eslint on the 3 files: clean; prettier applied.
- Not run: `pnpm verify`, browser look at the HUD in the real app (only the store is tested), heap/alloc profile.

## Open / returned to owners
1. **gameplay (interaction):** `interaction.set` needs a proximity source (near the Dump Plate / Desk / Assay Counter). No sim event or shift field gives it; gameplay owns the avatar position and should write `interaction.prompt` with `prompt.*` ids, or expose a proximity flag the writer can read.
2. **sim/protocol (Holster):** frames and shift state report only the equipped tool and its Cell; the second Holster slot shows the next owned tool by table order with 0 kg. The economy agent's Holster gating should expose the holster order (and per-tool Cell grams if wanted) in `PlayerInfo`; the writer then maps it directly.
3. **suit:** Hop charges are in the frame Self block only (`FrameAvatarSource` does not keep them), lamp level/mode has no source; `suit.hop`/`lamp*` left at their defaults. `shine.albedo`/`dustRemovedKg` have no source in shift state.
4. `nextReq.priceLm` stays 0 until the Desk tracks an item (W6-T02).
