# M1 integrator round 5: interaction prompt, purchase port, menus wiring

Status: **done except the own online avatar feed slot (not started)**. Date: 2026-11-15. Model: Opus 5.5. No git, no servers left running.
Edited `app/` and `gameplay/input`. Not touched: `ui/`, `packages/sim`, render/visuals/terrain/dust, sim-host, net.

## Part A: interaction prompt and purchase port
- **Interaction prompt.** `app/hud-interaction.ts` adds `InteractionWriter`.
  - Uses gameplay `rig.feet` and the stations from `@moon-cleanup/sim`: `borealStandInSellPoints`, `ASSAY_POUR_REACH_M` and `DUMP_PLATE_RADIUS_M`. These are loaded lazily, and only when gameplay exists.
  - Prompts:

    | Station | Action | Text id | Hold |
    | --- | --- | --- | --- |
    | Assay Counter | `pour` | `prompt.assay` | yes |
    | Gate | `pour` | `prompt.pour` | no |
    | Desk | `open_desk` | `prompt.open_desk` | no |
  - Samples at most 10 Hz and dispatches `interaction.set` only when the prompt changes. It does not allocate per frame.
  - **The Desk position is a stand-in:** 6 m north-east of the Assay Counter, 2.5 m reach. No outpost layout gives it a position yet.
- **Purchase port.** `createPurchasePort` sends `purchase` intents (request ids are UUIDs parsed with `RequestIdSchema`) to the published host.
  - It keeps `desk.pending` and `wallet.pendingSpendLm` up to date.
  - On the own actor's `purchase.completed` or `purchase.rejected` it clears the pending entry.
  - A rejection also pushes notice `notice.purchase_rejected {reason}`; the UI now has the string for it.

## Part B: UI part 2 wiring (this round)
- **`app/menu-writer.ts`:**
  - **`MenuWriter`** follows `roomHost` shift state and writes, at most `HUD_WRITE_HZ`:
    - **`desk.items`:** tools (owned bit), plus the MVP suit-gear lines up to their `MVP_SCOPE.suitGearMaxLevel` cap.
    - **`board.nodes`:** `MVP_SCOPE.boardNodeIds`. Levels come from `sharedUpgrades`. Dust Cell nodes are capped at `dustCellMaxLevel`. `anyOf` prerequisites are handled, and the hub counts as held.
    - **`board.caps.roost`:** the sum of `robotCounts` against `MVP_SCOPE.roostCap`.
  - **`UiFrameBridge`** runs once per frame before the UI flush:
    - Gamepad menu edges go to `ui.navigate(...)`, only while a menu is open.
    - An interact press while the Desk prompt is up dispatches `menus.open requisitions_desk`.
    - The look yaw goes to `ui.setCompassHeading(deg)`. The call is skipped when the heading is unchanged, and the bridge does not allocate.
- **`gameplay/input/input-state.ts`:** gains `takeInteractPresses()` and `takeNav()`.
  - `takeNav()` returns `PAD_NAV_*` rising-edge bits for A, B, LB, RB and the D-pad, independent of the bindings.
  - Both are fed from the existing press and gamepad path, so there are no new window listeners. The constants are exported from the `gameplay` barrel.
- **`boot.ts`:**
  - The `UiModule` gets `purchase: purchasePort.purchase`.
  - `MenuWriter` follows `roomHost`, with its catalog built from game-data in the existing lazy load.
  - The bridge is built when gameplay exists.
  - The interaction writer, menu writer and bridge are all pumped by `withHudPump` before each UI flush.

## Evidence
- `vitest run src/app/menu-writer.test.ts`: 2/2 passed. The first test uses a real Solo `LocalRoomHostImpl` started with 500 LM and checks:
  - an E press at the Desk opens `requisitions_desk`;
  - the Desk rows come from shift state (Holster Rig L0, 100 LM, max 1);
  - buying through the port leaves one pending entry, then the rig reaches level 1 and pending/spend clear;
  - a second level is refused and gives a notice;
  - pad D-pad and B produce nav edges, which are routed to `navigate` only while a menu is open.

  The second test covers board rows.
- `vitest run src/app/hud-interaction.test.ts`: 3/3 passed.
- `vitest run src/app src/ui src/gameplay`: 180/181 passed. The one failure was `online-loop.integration.test.ts` (real ShiftRoom, 20.7 s under parallel load). It **passed 1/1 when rerun alone**. It is a load-sensitive integration test; none of its code changed.
- `tsc --noEmit -p apps/client` (whole client): 0 errors.
- eslint on all changed files: clean.
- Not run: `pnpm verify`, a browser check of the Desk, prompt and compass in the real app, and an alloc profile.

## Open / returned to owners
1. **Gameplay input gating (gameplay owner):** while a menu is open, gameplay still acts on the same input. Pad A also jumps, E still interacts, and movement continues. Gameplay should suppress sim input while `menus.open !== null`, for example through a flag the app sets from the store.
2. **Prices:** the Desk and Board show list prices. Rebate and Repeat Requisition are applied by the sim, so the shown price can be higher than the charge.
   - Desk "requires" is always empty, because the sim has no tool prerequisites.
   - Exact prices would need the sim or shift state to expose the discount.
3. **Compass:** heading = `yawRad` in degrees. `InputState` documents yaw 0 as heading-frame north, positive toward east. The heading-frame flip near the pole is not handled.
   - Not written: `compass.outposts`, pings, fence bearing, `plotCard`. No source exists for the plot under the cursor or avatar, and no visited flag except `visitedOutposts`. The coordinator asked for these; returned to gameplay (plot pick) and sim (outpost visit state).
4. **Desk position:** the stand-in should be replaced by the outpost layout (world/visuals). The sim sell points are stand-ins too.
5. **Own online avatar feed slot: not done (budget).**
   - Findings: the server slot table excludes the own avatar (`apps/server/src/net/shift/shift-core.ts:898,906`). No sim change is needed.
   - Plan: make pool slot 0 the own avatar, from `room.predictor.state` + `offset`; shift remote avatars to slots 1..15; add `setLocalSlot` to `AnimationBinder`, called with 0 on open and -1 on close. Nothing reads `animatorFor` yet, so this cannot double-render.

## Part C (latest): menu input gating, Rebate prices, own online avatar slot
This part closes open items 1, 2 and 5 above.
- **Menu input gating** (`gameplay/input/input-state.ts`):
  - New `setSuspended(on)` and `isSuspended`. Every change releases all game actions: held, latches, pending slot, interact presses and camera toggles.
  - While suspended, presses are dropped and the move stick is ignored. Look and `takeNav` edges still work.
  - Keys that are still down when the menu closes do nothing until pressed again, so no key sticks.
  - `UiFrameBridge` calls `input.setSuspended(menus.open !== null)` each frame.
  - Test: `gameplay/input/input-suspend.test.ts`, 2/2 passed. While a menu is open, move, jump, interact, tool and slot do nothing, while look and pad nav still work. After close there are no stuck keys and fresh presses act normally.
- **Prices:** the sim exposes `PromotionsBoard` and `discountedPriceLm`, so the client reproduces the charge cheaply.
  - `createMenuPricing(board, STAT_PURCHASE_DISCOUNT_FRAC, discountedPriceLm)` mirrors the sim: Rebate applies to tools and Dust Cell nodes; suit gear and other nodes pay list.
  - Boot builds it in the gameplay-only lazy sim chunk and passes it with `MenuWriter.setPricing`.
  - **Still list price:** Repeat Requisition (the second copy of a tier ≥ the minimum tier). Shift state has no copies-bought count. That needs a sim/shift-state field (sim owner).
  - Test: "menu pricing" in `menu-writer.test.ts` (rebate L1: squeegee and Dust Cell node discounted, Holster Rig and plain nodes at list).
- **Own online avatar** (`app/remote-avatars.ts`, `app/online-launch.ts`):
  - Pool slot `OWN_POOL_SLOT` = 15 (the last one; `feed.ownSlot`) is filled from the room predictor: `state` + `offset`, velocity, facing, grounded, height, jumped, impact; teleport on the first frame. Remote avatars use slots 0..14.
  - `AnimationBinder` gains `setLocalSlot`, called with `ownSlot` on open and -1 on close.
  - Test: `online-loop.integration.test.ts` now also asserts that A's own slot matches A's predictor pose, and that a pool with `setLocalSlot` animates it (1/1, real ShiftRoom, run alone).
- **Evidence:**
  - `tsc --noEmit -p apps/client` (whole client): exit 0.
  - eslint on every changed file: exit 0.
  - `vitest run src/app src/ui src/gameplay`: **23 files, 184/184 passed**.
  - Not run: `pnpm verify`, a browser check.
- **Still open:**
  - `compass.outposts`, pings and fence bearing, and `plotCard`: no source for them.
  - The Desk position is a stand-in.
  - Repeat Requisition price, as above.

## Files
- New (Part C): `apps/client/src/gameplay/input/input-suspend.test.ts`
- Edited (Part C): `remote-avatars.ts`, `online-launch.ts`, `online-loop.integration.test.ts` (all in `apps/client/src/app/`)
- New:
  - `apps/client/src/app/hud-interaction.ts` and `hud-interaction.test.ts`
  - `apps/client/src/app/menu-writer.ts` and `menu-writer.test.ts`
- Edited:
  - `apps/client/src/app/boot.ts`
  - `apps/client/src/app/hud-writer.ts` (`withHudPump` takes an extra pump)
  - `apps/client/src/gameplay/input/input-state.ts`
  - `apps/client/src/gameplay/index.ts`

## Pass 5 follow-up: sim read-outs into the HUD (2026-11-15)
Status: PARTIAL. Writers, price quote path, compass chips and tests done; Hop / Lamp / Plot Card / quotes are UNFED in Solo because the sim runs in the worker and the main thread has no MoonRoomSim.

- New `apps/client/src/app/readout-writer.ts`: `SimReadoutSource` port (pickPlot, hopReadout, lampReadout, quotePriceLm; MoonRoomSim satisfies it with no cast, proven in the test), `ReadoutWriter` (10 Hz, reused out-buffers, patch only on rounded change; `suit.hop` null when max 0, `lampMode` = lit ? lamp : off; `plotCard.*` from pickPlot only while `setInspecting(true)`, `open:false` when the pick ends; `setOutposts` -> `compass.outposts`), `attachSimReadouts(targets, source|null)`.
- `menu-writer.ts`: `deskItems`/`boardNodes` take a `PriceQuote`; `MenuWriter.setQuote`. Quote >= 0 replaces the row price (0 = free handback; Repeat Requisition included), -1 keeps the list/Rebate price.
- `boot.ts`: ReadoutWriter pumped with the other writers before the UI flush; compass chips written from `sim.BOREAL_STAND_IN_OUTPOSTS` (Boreal, visited, accent teal) when the lazy sim chunk loads (live now); `interactionPump.attachSimReadouts(source)` is the single hook; detached on dispose.
- Tests: `readout-writer.test.ts` (7). `src/app` vitest 15 files pass; client tsc and eslint clean; prettier applied; sim goldens re-run `test/golden` 2/2 (unchanged, nothing re-recorded).

### Returned to owners
1. sim-host owner (`apps/client/src/sim-host/worker-core.ts`, `local-room-host.ts`, contract `packages/shared/src/client/room-host.ts`): the worker owns the only MoonRoomSim. Needed: a worker->main read-out message (about 10 Hz and after each purchase) carrying `hopReadout`, `lampReadout`, `pickPlot(slot, out)` (inspecting only; main sends an `inspect on/off` flag), and `quotePriceLm` for the desk/board item ids; the host exposes a cached `SimReadoutSource`, and boot calls `interactionPump.attachSimReadouts(host.readouts)` for a local host (detach on remote/closed). Needs a RoomHost contract proposal (contracts-architect).
2. Remote (online) host: no source; the server sends no read-outs. Unfed, per brief.
3. UI/store (`apps/client/src/ui`, `packages/shared/src/ui`): there is no Near Parcels slice or field and the compass has no bearing for outposts (chips only), so `nearParcel()` and outpost unit dirs have nowhere to go. Needs `compass.nearParcels`/bearings if wanted.
4. Gameplay input: no Plot Card action exists (`KeyC` is `descend`); nothing calls `ReadoutWriter.setInspecting`. Needs a `plotInspect` action bound to a free key/pad button, bridged by the UI frame bridge. Plot Card `label` is `String(plotId)` until a "41-207" label scheme exists.

## Pass 6: Solo worker read-outs (Job A) and Controls / settings wiring (Job B) (2026-11-15)
Status: Job A PARTIAL (data path done and tested; Plot Card bound to C, documented). Job B DONE except items under "Not done". The wrapped-up smoke and unit evidence is below; no `pnpm verify`, no human check of a live Plot Card.

### Job A
- **Worker -> main read-out message** (sim-host, zero cost to input/frame path):
  - `sim-host/readouts.ts`: `ReadoutSampler` (worker) samples `hopReadout`, `lampReadout`, `pickPlot` (only while inspecting) and `quotePriceLm` for the requested item ids at most every 100 ms from the tick loop, into reused scratch objects (two alternating message objects, no per-sample allocation), and posts `{t:"ro"}` only when a value changed. `HostReadouts` (main) caches the newest message and answers the same four reads synchronously with no allocation; samples of an older request (`reqSeq`) are dropped.
  - `messages.ts`: new `ro_req` (main->worker: seq, inspecting, itemIds) and `SimReadoutMessage`, `READOUT_INTERVAL_MS`; `SIM_HOST_PROTOCOL_VERSION` 3 -> 4. `worker-core.ts`: handles `ro_req`, samples at the end of `tickOnce`. `local-room-host.ts`: `readonly readouts: HostReadouts`, `setReadoutRequest(inspecting, itemIds)`, re-sent on `ready` (worker reboot).
  - App: `app/readout-link.ts` (`ReadoutLink`, `hasReadouts` type guard): follows `roomHost.onChange`, attaches `host.readouts` through `interactionPump.attachSimReadouts` for a readout-capable (Solo) host, detaches for remote/closed. Quote ids come from `catalogItemIds(catalog)` (menu-writer). Nothing for online (no server read-outs, unchanged).
- **Plot Card trigger: DOCUMENTED, bound.** `docs/design/game-feel-and-controls.md` 6.2 (Plot Card: C, toggle, option Hold), 6.3 (pad: D-pad Up tap), also GDD 9. New input action `plotCard` (ExtraAction, `ACTION_PLOT_CARD` = 27, `ACTION_COUNT` 28), default `KeyC` (was `descend`; Touchdown/descend stays on Left Ctrl as documented). `InputState.takePlotCardToggles()`; `UiFrameBridge` toggles inspecting (a menu opening closes it) and calls `onInspect` -> `ReadoutWriter.setInspecting` + `ReadoutLink.setInspecting` (worker starts reading the plot).
- Goldens: `packages/sim` `vitest run test/golden` 2/2 pass, nothing re-recorded; `packages/sim` not edited. (Hash values 1076468633/4164540033 and 1838396500/2469925789 are asserted by those tests.)

### Job B
- `app/controls-port.ts` (`createControlsPort`, `toBindingTable`): `UiModuleOptions.controls` backed by the real `InputState.setBindings`; `apply` validates (throws on unknown action/device -> UI "not accepted"), persists, notifies; `reset` = `DEFAULT_BINDINGS`.
- Pad capture: `InputState.takePadEdges()` (bit mask of newly pressed pads, recorded while suspended too); `UiFrameBridge` sends each press to `ui.offerInput("Pad<n>")` while `ui.capturing()==="pad"` and drops nav edges that frame (B included).
- `app/ui-intents.ts` (`createUiIntents`): full `UiIntentPort` (the UI uses `intents` OR `purchase`): purchases as before, `setQualityPreset = quality.setPreset(p,"user")` + save, `openControls` hook (no-op in boot; menus already suspend gameplay input).
- **Persistence:** no shared settings/save path exists, so `app/settings-storage.ts` uses localStorage (`mc.settings.hudScalePct`, `mc.settings.quality`, `mc.controls.bindings`), validated on read (corrupt value is reported through the boundary and ignored). Boot applies the stored UI size (`settings.set`) and, right after render init, the stored quality preset (`"user"`, an explicit `?preset=` wins), and saves the slider and the bindings on change. Not a server/Contract save; Cee/contracts-architect may want a proper settings slice later.

### Evidence
- `tsc --noEmit -p apps/client`: 0 errors. eslint on all touched files: clean. prettier --write applied.
- `vitest run src/app src/gameplay src/sim-host src/ui` (apps/client): 28 files; the first run 244/245 (the only failure was my new Solo read-out test timing out at 5 s under 28-worker load); after giving it a 30 s timeout `round5-wiring.test.ts` passes 4/4 alone (worker cache answers hop/quote -> 100 LM for gear.holster_rig, unknown id -> -1, not inspecting -> no plot; controls apply/reject/reset; settings round trip and corrupt reject; pad capture and C toggle). I did not re-run the whole 28-file batch after only that timeout change.
- Smoke (own dev server `vite --port 5440`, tool-shell PATH, which reported Node v22.20.0, not 26):
  - `solo-smoke.mjs http://localhost:5440 "?play=1&perf=1" 10`: exit 0; console contains warnings only (WebGPU "No available adapters", GL ReadPixels stall; swiftshader), no errors / page errors listed. 20 s soak run before: exit 0.
  - `desk-smoke.mjs http://localhost:5440`: exit 0, every check ok incl. `no-console-errors` (`[]`).
  - Dev server on :5440 killed (PID 38008; listener count 0).

### Not done / returned
1. **UI (`apps/client/src/ui/menus/controls-model.ts`):** `CONTROL_GROUPS` has no `plotCard` row, so the rebinding screen cannot show or rebind the Plot Card key; `ui/dev/preview.ts` DEFAULT table still maps `KeyC: "descend"`.
2. Plot Card on gamepad (D-pad Up tap, doc 6.3): not bound. Current Pad12 is `lampCycle`, Pad15 `seatSwitch`, which differ from the doc table; remapping the pad layout is a gameplay-owner decision. Plot Card "Hold" option and the `label` scheme ("41-207") also not done (`label` is still `String(plotId)`).
3. Not exercised in a browser: a live Plot Card open with a real plot, pad capture in the real app, persisted-setting reload; they are covered by unit tests only. The ~10 Hz worker sampling cost was not profiled (no per-tick allocation by design; `tickMs` measured only by the existing stats).
4. `compass.outposts` stays the static boot write (sim `outpost(k)` is not read; `visited` is k===0, which is what the sim returns today).
5. Contract proposal for contracts-architect: `ReadoutHost` / `SimReadoutMessage` are currently sim-host-local plus a structural port in `app/`; a shared `RoomHost` read-out extension is not made (no shared-package edits).

### Files
- New: `apps/client/src/sim-host/readouts.ts`; `apps/client/src/app/{controls-port,settings-storage,ui-intents,readout-link}.ts`, `apps/client/src/app/round5-wiring.test.ts`.
- Edited: `apps/client/src/sim-host/{messages,worker-core,local-room-host}.ts`; `apps/client/src/gameplay/input/{bindings,input-state}.ts`; `apps/client/src/app/{boot,menu-writer,menu-writer.test}.ts`.

## Pass 7: Near Parcels and outpost bearings (follow-up, 2026-11-15)
Status: feed DONE and unit-tested; full batch green; solo-smoke PASS; desk-smoke FAIL in this session (unresolved, see below).

- **Worker message** (`sim-host/messages.ts`, `readouts.ts`): `SimReadoutMessage` now carries `parcelCount`, `parcelMask`, `parcelDirs` (xyz triples), `outpostIds`, `outpostDirs`. The sampler reuses its two alternating message objects and one scratch direction; the comparison covers the new fields, so a post happens only on change. `HostReadouts` answers `nearParcelCount`, `nearParcel(k,out)` (the UI's `NearParcelSource` shape), `outpostCount`, `outpost(k,out)` from the cache with no allocation.
- **Main feed** (`app/parcel-feed.ts`, `readout-link.ts`, `boot.ts`): `ParcelFeed.pump` runs inside `interactionPump.pump` (before the store flush), at most 10 Hz, only with a Solo source and a posed avatar. It normalises the avatar feet vector, calls `ui.setNearParcels(source, bearing)` and `ui.setOutpostBearing(id, bearing)` for every outpost, using the UI's `sphereBearingDeg`; the UI store publishes only on a changed value. `ReadoutLink` now attaches a `HostReadoutSource` (`SimReadoutSource` plus `ParcelReadoutSource`).
- **North check:** world north is +Y (`ICO_NORTH = [0,1,0]`, `packages/world/src/grid/icosahedron.ts`). Test "bearing" builds the sim's `headingBasis` for an off-axis point: a target along heading-frame north gives 0 deg and one along east gives 90 deg with `sphereBearingDeg` (passes), so it agrees with the compass heading (`yawRad` 0 = north, + toward east).
- **Online:** not fed. The remote host has no `readouts` and the server sends no parcel/outpost data, so the markers stay unfed online; a feed would need server-sent data (or a client-side copy of the Contract's parcel directions, which depend on the Contract seed). Detaching (leaving Solo) stops the feed and leaves the last UI values (the UI store has `clear` but the module does not expose it): UI could expose `clearNearParcels()`.
- **Tests:** `round5-wiring.test.ts` now 6/6 (adds outposts through the real worker message: Boreal, unit length; the bearing/headingBasis check; the feed with a fake source: 2 parcels 1 collected, outpost, 10 Hz gate).

### Evidence (this pass)
- `tsc --noEmit -p apps/client`: exit 0. eslint on touched files: exit 0. prettier applied.
- `vitest run src/app src/gameplay src/sim-host src/ui`: **29 files, 258/258 passed** (includes `round5-wiring.test.ts` and `online-loop.integration.test.ts`).
- `solo-smoke.mjs http://localhost:5460 "?play=1&perf=1" 15`: exit 0, no console errors (warnings only).
- `desk-smoke.mjs`: **FAIL**, 3 runs on 5460/5461 plus A/B runs. Run 1 (5460): every check ok except `wallet-changed` (wallet stayed 500, `rowStatus` "buy"), `no-console-errors` ok. Later runs (5461, twice): `locator.focus` timeout 30 s waiting for the `desk-row-gear.holster_rig` button (Desk did not show its rows). The same smoke PASSED in Pass 6 (before this follow-up). A/B: with the `ParcelFeed` disabled in boot, and again with parcel/outpost sampling zeroed in the worker, it still failed the same way, so neither new piece is the cause; I restored both files afterwards (verified by grep). Not found yet: possible suspects are machine load (the user's Chrome shows heavy CPU while swiftshader runs) or something older. Needs a rerun on a quiet machine, or a debugging pass on the Desk open (E press -> `menus.open`) / purchase path before claiming the Desk smoke green. I did not re-run Pass 6 code to bisect (call budget).
- Dev servers on 5460, 5461, 5462, 5463 all killed (no listeners).

### Files (this pass)
New: `app/parcel-feed.ts`. Edited: `app/{boot,readout-link,round5-wiring.test}.ts`, `sim-host/{messages,readouts}.ts`.
