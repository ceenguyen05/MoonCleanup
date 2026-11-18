# M1 balance review: Dump Plate sell loop and 7 vehicle upgrade lines (balance-reviewer)

Verdict: PASS, no blocking finding. Read-only; no data or sim edits.

## Evidence
- Simulator, Node 26, `cd tools/balance-sim; node_modules/.bin/tsx src/cli.ts --runs 200 --seed 7`: all `mvp_*` rows PASS.
  Solo: first stamp 5.50 min (5-8), first tool upgrade 6.13 min (5-10), first vehicle 1.16 h (1-1.5), first Roost 1.54 h (1.5-2),
  first Dust Cell 8.87 min (7-12). 4p: stamp 2.17 min (1.5-4), tool upgrade 3.40 (2-6), vehicle 0.53 h (0.3-0.8), Roost 0.65 h (0.4-1).
  `efficient`/v1.0 rows SKIPPED (need the M2 simulator). No baseline file to diff against.
- The simulator does not model vehicle upgrade stats, Fast Tip or tip time (README: Trundle haul is a rate model with a 100 s trip).
  So findings 1-2 are by code trace and arithmetic, not by sim run.

## 1. Fast Tip stop-and-go sell loop: not an exploit (info)
- `packages/sim/src/vehicles/room-vehicles.ts:465-482` (`stepTip`): the tip needs hopper > 0, grounded, |speed| < 0.05 m/s, and a Gate within 3 m.
  It then sells the whole hopper once, after `tipTicks`. Moving off resets the timer, and the dust stays aboard (no loss, no partial sale).
- `moon-room-sim.ts:2371-2407`: payout is only `grams x lmPerKg(5 LM/kg, economy.json:4) x payoutMult`. Dust comes only from cleaning, and the
  hopper is capped at payload (Trundle 200 kg = 1,000 LM). Stopping, tipping and driving off cannot mint Lumens. Each gram sells once.
- Quantified: Trundle fill is about 3.0 min per 200 kg (doc §8), so about 333 LM/min ceiling per Trundle. A base tip of 2.0 s is about 1.1% of a
  180 s fill cycle. Max Fast Tip (0.6 s) saves 1.4 s per load, about 0.8%, and the loop adds no income beyond that. At the doc's
  100 s trip model it is about 1.4%. The designer's figure holds.
- Base 2 s tip is a small nerf versus instant sell. Motor Pool return (`room-vehicles.ts:324-331`) still sells instantly, but only against a Gate.
  That matches doc §8 (Motor Pool includes a Dump Plate), so there is no bypass.
- Keep `tipS` = 2.0. Optional only: clamp `tipTicks` at 6 ticks (0.3 s) at the floor. Current floor is 1 tick (`tuning.ts:285`), which is unreachable with the data.

## 2. Upgrade lines
Data costs match doc §8.1 exactly (`vehicle-upgrades.json`; max 6.30x = 13,230 LM on a 2,100 Trundle). Effects match the doc.

### Medium: Fast Tip data carries `vehicleTripTimeMult` 0.6 / 0.3 (latent)
- `vehicle-upgrades.json:83,90`. The doc says Fast Tip is "unload -40% / -70%" only. Today `tripTimeMult` is stored but unused
  (`tuning.ts:262`, nothing reads it). If the sim or balance-sim later consumes it, Fast Tip II would cut 70% of the 100 s round trip (-70 s).
  Afterburner is -6% and Throttle Lock -3% on the same stat. That would make a 630 LM purchase the best line in the game by about 10x.
- Afterburner and Throttle Lock `vehicleTripTimeMult` (0.94 / 0.88 / 0.97) also double-count speed effects that the sim already applies
  through `boostMult` and cruise control.
- Suggest: drop `vehicleTripTimeMult` from Fast Tip, or set it to 0.99 / 0.97 (the unload share of a 100 s trip). Note in the doc that the
  trip mult is a balance-model proxy only, not a sim stat. Not blocking.

### Low: Fast Tip II is a trap purchase
- 630 LM (0.30x) buys at most 1.4 s per load, about 0.8% of income. Not exploitable, just poor value. Level I (210 LM, 0.8 s) is fine.
  Optional: raise `tipS` to 2.5 so Fast Tip saves more (the designer's own fallback), or accept it as flavor.

### No line trivialises progression
Arithmetic from the doc §8 Trundle (2.65 m2/s, about 333 LM/min at fill):
- Gear Ratio I (420 LM): +8% rate, about +27 LM/min, so it pays back in about 16 min. Best early buy, and a generous opening that
  is not runaway. III (2,100 LM): +24%.
- Wide Mouth III (2,520 LM): area x1.25 net, with a speed penalty. Gear III plus Wide III together give about x1.55 (1.24 x 1.6 x 0.78)
  = about 4.1 m2/s, with 440 kg payload (Cargo III). That is still about half the Skiff (7.9 m2/s, 12,000 LM), so a maxed Trundle
  (15,330 LM including the vehicle) does not replace tier 2. It is the intended ceiling for M1.
- Afterburner/boost is metered (`vehicle.ts:357-366`, `boostMeterMs`), so it is not free sustained speed.
- Cargo Expander only cuts trip count (fill rate unchanged). It cannot raise Lumens per minute by itself.
- Throttle Lock at 105 LM and Running Lamps at 105 / 315 LM are cheap and cosmetic or QoL. No problem.

### Buy order
- No prerequisites between lines (`quote` only needs an owned vehicle copy, `room-vehicles.ts:244-247`), so any order works. The best ROI order is
  Gear I, Wide I, Cargo I. No sequence breaks the vehicle gate (first vehicle 1.16 h, first Roost 1.54 h): upgrades cost 420 LM or more per
  step on a vehicle that already costs 2,100 LM, so none can be bought before the vehicle.
- No sell or buy loop: upgrades have no refund path in the code I read (`buyUpgrade` only spends from the shared wallet).
  Rebate applies via `rebateFrac`. Not checked: `rebateFrac` stacking with Cell discounts (outside this scope).

## Not checked
- `pnpm verify`, server tests, any browser. Skiff/Carryall/Bulldust/Behemoth are not modelled until M2, so their lines were not tested.
- Multiplayer wallet scaling (1 to 6 players) beyond the 4p rows above.
