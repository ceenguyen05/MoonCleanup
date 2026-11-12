# Progression & Economy — Clean The Moon!

Direction: `docs/design/REFERENCE_TARGET.md` overrides retired naming/style/custom-gate rules.

Status: **Draft v2 for build (2026-11-12, after the independent game-design review).** Owner: game-designer. These are **candidate tuning tables**, not verified reference-game parity. Apply REFERENCE_TARGET before implementation: matching equipment roles/progression matters; no arbitrary number/name difference is required. Recompute the baseline after removing optional custom gates/multipliers.
**Source of truth for pacing.** The v1 numbers came from a scratch prototype that is not in the repo. v2 keeps that prototype's rows from 3 h onward and re-derives everything else by hand in this file (§17, §18, Appendix B). §17 and §18 are therefore the **golden targets**: the first `tools/balance-sim` PR serialises them to `tools/balance-sim/golden/v2-targets.csv`, publishes its own diff against them, and the designer reconciles §17/§18 to the sim in the same PR (§22 Acceptance).
Names: editable [naming catalog](naming-bible.md); ordinary descriptive terms are allowed. Systems overview: [GDD.md](GDD.md).

**Units used everywhere:** LM (Lumens, integer), m, m², m/s, s, h, kg, t, kW, kWh. "Shine" = fraction of plots Polished. "Review n" = Performance Review n (§13). "Stage base income" = the §17 income column (no Docket, Review, collectible or trick income). Percentages in tables are of the stated base.

---

## 1. World and dust constants

| Constant | Value | Notes |
| --- | --- | --- |
| Moon radius | 2,000 m | Surface area 50,265,482 m² (50.27 km²) |
| Plot grid | GP(128,0), **163,842 plots** (12 pentagons) | Mean plot 306.8 m², about 19 m across |
| Gravity | 1.62 m/s² | Ballast Soles: Earth-feel 9.81 m/s² for the wearer only |
| Day length | 3,600 s: 1,800 lit + 1,800 dark | Server clock; the sun moves on a great circle. **A new contract starts at Outpost Boreal sunrise**, so its first 30 min are lit |
| Dust ledger | 4-bit levels (0–15) per ledger texel, 32×32 texels per active plot | Matches ADR-0009's coarse ledger; one texel is about 0.6 m |
| Mass per dust level | 0.062 kg/m² | |
| Opened threshold | ≥0.1% of the plot's starting dust removed | |
| Polished threshold | ≤1.0% of the plot's starting dust remaining | Integer server counts plus a recount on load ★. Polished is latched: a stamped plot never un-stamps |
| Steep slope | >25° (vehicles slide; hand tools, robots and Hop Pack fine) | About 6% of plots (crater walls, rilles). Hand tools sweep-walk at **×0.6 on Steep** unless their trait removes it (Sure Footing, Charge) |
| ★ Outpost compound | The outpost's own plot + ring 1 (7 plots per outpost) | Empty (Polished from the start) |
| ★ **Landing Apron** | 6 plots of ring 2 at every outpost | Lander exhaust blew most dust away: drifts cover **20%** of each plot at dust level 2 (≈61 m², ≈7.6 kg per plot). Reason: a first Inspector's Stamp in ≈6 min (review M1) |

### 1.1 Terrain classes and dust per plot

| Class | Share of plots | Dust level | kg/m² | Mean kg per plot | Passes needed at tool Depth 5 / 8 / 10 / 13 |
| --- | --- | --- | --- | --- | --- |
| Highland | 55% | 5 | 0.310 | 95 | 1 / 1 / 1 / 1 |
| Mare | 35% | 8 | 0.496 | 152 | 2 / 1 / 1 / 1 |
| Crater Floor | 10% | 13 | 0.806 | 247 | 3 / 2 / 2 / 1 |
| **Moon mean** | 100% | 6.85 | **0.424** | **130** | 1.55 / 1.10 / 1.10 / 1.00 |

- **Total Moon dust ≈ 21,310 t (21.31 million kg).** Raw value at the dust price = 106.6 M LM. (Compounds and Aprons remove <0.03% of this; ignored.)
- **Outpost mix** (all plots within 600 m of an outpost): 90% Highland, 8% Mare, 2% Crater Floor → **0.335 kg/m²**, passes **1.12** at Depth 5–6, **1.10** at Depth 7, **1.02** at Depth 8, 1.00 at Depth 13.
- **Depth** = dust levels removed per pass. A pass that doesn't clear a texel leaves visible residue: thinner dust, still Grimy-tinted.

## 2. Currency and payouts

| Item | Value | Notes |
| --- | --- | --- |
| Starting wallet | 0 LM | |
| Regolith dust | **5 LM/kg** | Paid at the Assay Counter (on pour) or a Receiving/Field Gate (on arrival) |
| Glass Beads | 16 LM/kg (×3.2 dust) | From the Bead Kiln |
| Sinter Tiles | 37.5 LM/kg (×7.5 dust) | From the Tile Sinterer |
| ★ **Bulk Rate** | Albatross Bales sold raw pay **25%** of the dust price (1.25 LM/kg) | Bales processed in Kilns or Tile Sinterers earn full product value. Roost dust pays full rate. Reason: keeps late money meaningful, so the late game stays money-paced instead of idle-snowballing [R C1, C9]. It is a pacing constant, not the player's main lever (that is Effort, §9.3) |
| Inspector's Stamp | **50 LM** per plot reaching Polished | Stamp Premium multiplies it for player-credited plots (§14) |
| Payout multiplier | 1.00 → 1.23 | Rate Review +5/+10/+15%, Golden Handshake +8%; applies to all sales, not Stamps, Settle or collectibles |
| Relay Pad fee | 50 LM per teleport | Shift wallet; not usable from vehicles |
| Outpost Recall | 100 LM | Hold 5 s; to the nearest visited outpost |
| ★ Repeat Requisition | Further copies of a **T4+ tool, the Assembly Gun or a vehicle** cost **40%** of list | Vehicle upgrades and Refits on repeat copies also cost 40% |
| ★ Standard Issue | Desk Duster, Crescent Squeegee and Bristle Broom: **once anyone in the shift owns one, every member (present or future) has it free** | §19 gives the per-tier cost formula |
| ★ **Settle** (building on dust) | Dust under a new footprint is cleared at the builder's own best hand-tool area rate and paid at the **Bulk Rate** | §12. No soft-lock, never faster or better-paid than sweeping |
| Vehicle tricks | Hang Time 25 · Moonshot! 100 · Lunar Loop 150 · Corkscrew 150 LM; ×1.5 per extra trick in one air; Faceplant voids | **Driver only** (passengers earn nothing). Capped at **250 LM per driver and 500 LM per shift per 10 min** (≤3,000 LM/h per shift: <5% of stage base income from the Skiff on). Not raised by payout bonuses |
| Refunds (Reclaim, any sale-back) | **The price that instance actually cost** | Recorded per entity; free items (Review issue, Fleet Voucher) refund 0. Grades and Refits refund with their machine or vehicle. Escalating prices are indexed on the count currently owned, so Reclaim → rebuy never gains LM |

**Effective earnings per m² cleaned:**
- By a Custodian, Moon mix: 0.424 × 5 + 50/306.8 = **2.28 LM/m²** (×payout multiplier on the dust part).
- By a Custodian, outpost mix: 0.335 × 5 + 0.163 = **1.84 LM/m²**.
- By an Albatross, sold raw: 0.424 × 1.25 + 0.163 = **0.69 LM/m²**.

## 3. Movement and suit base stats

| Stat | Value |
| --- | --- |
| Walk | 3.4 m/s |
| Lope (not while sweeping) | 5.0 m/s |
| Sweep-walk (while sweeping) | 2.2 m/s (Cadence and Second Wind apply); ×0.6 on Steep plots without Sure Footing or Charge |
| Jump apex (lunar g) | 1.6 m; Loft +20% / +40% |
| Hop Pack burst | +3.0 m/s forward-up impulse per burst; bursts recharge 4 s after landing |
| Night penalty without light | −30% effective cleaning rate at night, on foot and in vehicles. Each Crown Lamp level removes 5 points (on foot); Running Lamps remove 10/20 points (in that vehicle); relief stacks up to the full 30; the Lowlight Visor removes the rest everywhere. Robots have no night penalty. ★ A minimum-visibility floor (accessibility) keeps the ground readable without gear |
| Carry | 1 Dust Puck or Puck Stack in hand (Railhand Certification: 2) |

## 4. Hand tools (per player; Requisitions Desk)

Area rate = width × sweep-walk speed (2.2 m/s) × 0.75 coverage, divided by the passes the terrain needs.

| Tier | Tool | Price | Width | Depth | Reach | Stroke | Cell base | Area rate on Highland | Area rate, Moon mix | Trait | Gate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | Desk Duster | free | 0.15 m | 5 | 1.2 m | 0.45 s | 4 kg | 0.25 m²/s | 0.16 m²/s | ★ **Detailing:** RMB scrubs a 0.5 m circle to zero (stragglers, crater rims) | — |
| T2 | Crescent Squeegee | 75 | 0.28 m | 6 | 1.4 m | 0.55 s | 8 kg | 0.46 | 0.30 | ★ **Flick:** sweeps while airborne | — |
| T3 | Bristle Broom | 200 | 0.45 m | 8 | 1.8 m | 0.70 s | 15 kg | 0.74 | 0.67 | ★ **Sure Footing:** no Steep slowdown | — |
| T4 | Lane Broom | 750 | 0.75 m | 8 | 2.0 m | 0.80 s | 30 kg | 1.24 (1.42 locked) | 1.13 (1.29 locked) | **Lane Lock:** +15% sweep-walk speed while the angle is locked | — |
| T5 | Static Rake | **1,100** | 1.00 m | 13 | 2.6 m | 0.90 s | 55 kg | 1.65 | 1.65 | ★ **Charge:** no Steep slowdown, and a plot whose last dust the Rake removes pays its Stamp **×1.5** (stacks with Stamp Premium) | — |
| T6 | Ion Curtain | 9,000 | 1.40 m | 10 | 3.0 m | 1.00 s | 110 kg | 2.66 | 2.42 (2.66 at Depth 13) | ★ **Twin Pass:** cleans on the forward and return stroke (+15% effective width) | — (parity) |
| — | Assembly Gun | **750** | — | — | 12 m build range | — | — | — | — | Opens the build menu | — |

- Curves: price ×1.5–3.75 per tier up to T5, then ×8.2 to the Ion Curtain; width ×9.3 from T1 to T6; Cell base ×27.5.
- The Static Rake sits between the Lane Broom and the Trundle in price, so it is a real step (+18% area on outpost ground) and, through Charge, the best Steep and finishing tool. Efficient play buys it right after the Trundle (≈1.6 h); list-order play buys it before ★ [R C2].
- Every tier keeps a job via its trait, Steep plots, Review Briefs (§13) and Core Samples (§15) ★ [R C2].
- One Highland plot by hand takes about 21 min with the Desk Duster, 4.1 min with the Lane Broom and 1.9 min with the Ion Curtain. That is why the first Stamp comes from a Landing Apron plot (§1).

## 5. Dust Cells (Storage department; bought once for the shift)

Capacity per level = base × **1.75 (I) / 2.75 (II) / 4.0 (III)**. Densifier adds +20% / +40% to all Cells.

| Tool | Base kg | Cell I | Cell II | Cell III | Cell III + Densifier II | Cost I / II / III |
| --- | --- | --- | --- | --- | --- | --- |
| Desk Duster | 4 | 7 | 11 | 16 | 22.4 | 90 / 160 / 300 |
| Crescent Squeegee | 8 | 14 | 22 | 32 | 44.8 | 100 / 200 / 450 |
| Bristle Broom | 15 | 26.3 | 41.3 | 60 | 84 | 140 / 320 / 800 |
| Lane Broom | 30 | 52.5 | 82.5 | 120 | 168 | 500 / 1,100 / 2,700 |
| Static Rake | 55 | 96.3 | 151.3 | 220 | 308 | 1,800 / 4,000 / 10,000 |
| Ion Curtain | 110 | 192.5 | 302.5 | 440 | 616 | 6,000 / 13,500 / 33,000 |

- All 18 Cell levels cost **75,160 LM**.
- Cost per added kg rises with level (I is cheapest per kg). That is a deliberate early nudge, unlike the reference's flat per-kg curve.
- A full Cell stops pickup. **F** forms one 1-kg Dust Puck; **hold F** bands the whole Cell into Puck Stacks (≤20 kg each). Overflow Former does this automatically when the Cell fills (one Puck Stack at your feet, not a trail of pucks).
- ★ **Loose-puck caps** (review M13): at most **20 loose pucks/stacks per player and 200 per contract**. Pucks that touch merge into a stack (≤20 kg). Forming beyond your cap merges into your newest stack. A loose puck or stack untouched for 10 min is auto-collected into the nearest Gate's ledger at **50%** value. Rail, Dust Vault and Carryall contents don't count toward the cap.

## 6. Promotions Board (shared; Ops Console) — hub + 5 departments, 23 nodes

Rules:
- Secondaries need their root at level 1.
- A capstone needs its root at level 3 and all of its department's secondaries at level 2.
- Overflow Former needs Densifier II and any Cell line at level III.
- **No capstone is Review-gated (parity with the reference, review M3), except Golden Handshake (Review 2) ★.** Golden Handshake is the one economy capstone whose effect (Stamp Premium on robot plots) only matters once a fleet exists; gating it anchors "all personal upgrades ≈10–12 h".
- ★ The three hand-play capstones also help vehicles, so they keep a job after you start driving (review M3).

| Dept. | Node | Kind | Levels: effect (cost LM) | Gate |
| --- | --- | --- | --- | --- |
| — | **Employee Badge** | Hub | Owned at start | — |
| Storage | Dust Cell lines ×6 | Root (3 lv each) | See §5 (75,160 total) | — |
| Storage | **Densifier** | Secondary | +20% all Cells (4,000) · +40% (16,000) | — |
| Storage | **Overflow Former** | Capstone | A full Cell bands itself into one Puck Stack at your feet; keep sweeping (30,000) | — |
| Technique | **Broad Strokes** | Root | +8% width (350) · +16% (1,500) · +25% (6,000) | — |
| Technique | **Scour** | Secondary | +1 Depth (1,000) · +2 Depth (5,000) | — |
| Technique | **Telescoping Pole** | Secondary | +0.6 m reach, +3% rate (750) · +1.2 m, +6% (3,500) | — |
| Technique | **Master Stroke** | Capstone | +10% width, +1 Depth, −10% stroke time; ★ also +10% vehicle width (40,000) | — |
| Fitness | **Cadence** | Root | +7% move and sweep-walk speed (300) · +14% (1,200) · +20% (5,000) | — |
| Fitness | **Loft** | Secondary | +20% jump (900) · +40% (4,000) | — |
| Fitness | **Second Wind** | Capstone | +8% speed, Hop Pack recharge ×1.5, +1 burst; ★ vehicle trip time −5% (25,000) | — |
| Haulage | **Quick Pour** | Root | −25% pour time (250) · −45% (1,100) · −60% (4,500) | — |
| Haulage | **Puck Magnet** | Secondary | +1.5 m pickup reach (750) · +3 m (3,500) | — |
| Haulage | **Strong Arm** | Secondary | +30% throw (600) · +60% (3,000) | — |
| Haulage | **Smooth Handoff** | Capstone | Pour time −50% more; thrown pucks snap onto Glide Rails within 2 m; ★ vehicle unload −20% (22,000) | — |
| Accounts | **Rate Review** | Root | +5% payout (2,000) · +10% (9,000) · +15% (35,000) | — |
| Accounts | **Rebate** | Secondary | −5% tools, Cells and vehicles (3,000) · −10% (15,000) | — |
| Accounts | **Stamp Premium** | Secondary | Stamp ×1.5 on player-credited plots (2,500) · ×2 (12,000) | — |
| Accounts | **Golden Handshake** | Capstone | +8% payout; the Stamp Premium multiplier also applies to robot-credited plots (250,000) | Review 2 ★ |

| Department | Total cost (LM) | Share |
| --- | --- | --- |
| Storage (Cells + Densifier + Overflow Former) | 125,160 | 21% |
| Technique | 58,100 | 10% |
| Fitness | 36,400 | 6% |
| Haulage | 35,700 | 6% |
| Accounts | 328,500 | 56% |
| **Whole board** | **583,860** | 100% |

## 7. Suit gear (shared; Requisitions Desk) — 5 lines, 14 levels

| Line | Levels: effect (cost LM) | Total |
| --- | --- | --- |
| **Holster Rig** | 2 slots (100) · 3 (400) · 4 (1,500) · 5 (5,500) · 6 (20,000). Without it you carry 1 tool in hand | 27,500 |
| **Hop Pack** | 2 bursts (2,500) · 3 (10,000) · 4 (38,000) | 50,500 |
| **Ballast Soles** | Toggle Earth-feel gravity for yourself (1,500) | 1,500 |
| **Crown Lamp** | Clip Light 12 m (150) · Spot Ring 20 m (1,000) · Wide Halo 28 m wide (6,000) · Searchlight 36 m, no flicker (30,000). Each level removes 5 points of night penalty | 37,150 |
| **Lowlight Visor** | Night vision, removes the remaining night penalty; N cycles lamp/visor/off (4,500) | 4,500 |
| | **All suit gear** | **121,150** |

**"All personal upgrades"** = 6 tools + Assembly Gun (11,875) + the whole board including its 18 Cell levels (583,860) + 14 suit levels (121,150) = **716,885 LM**. That is about 3.1× the first Albatross with its Nest (230,000), and it completes just after Review 2 by design (§18).

## 8. Vehicles (per player; require a Motor Pool)

Area rate = width × cruise speed × 0.8 coverage ÷ passes (Moon mix). The duty cycle comes from payload fill time versus a 100 s unload trip.

| Tier | Vehicle | Price | Seats | Width | Cruise | Boost | Depth | Payload | Puck slots | Area rate | Payload fill | Gate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Trundle (walk-behind) | 1,800 | 0 | 1.6 m | 3.0 m/s | ×1.30 | 7 | 200 kg | 1 | 2.65 m²/s (3.49 outpost mix) | 3.0 min | — |
| 2 | Skiff | 12,000 | 1 | 2.2 m | 6.5 m/s | ×1.40 | 7 | 600 kg | 2 | 7.9 | 3.0 min | — |
| 3 | Carryall (transport) | 20,000 | 8 | — | 7.5 m/s | ×1.40 | — | Flatbed: 40 pucks, 8 Puck Stacks or 2 Bales | — | no cleaning | — | — |
| 4 | Bulldust | 28,000 | 1 | 3.4 m | 6.2 m/s | ×1.35 | 9 | 2,000 kg | 4 | 15.3 | 5.1 min | — |
| 5 | Behemoth | 120,000 | 1 + cab | 5.6 m | 4.8 m/s | ×1.25 | 13 | 6,000 kg | 6 | 21.5 | 11 min | Review 1 |

★ Each tier is a real step up in area rate (×3.0, ×1.9, ×1.4); the reference's top two cleaners are nearly equal [M§3c]. Bigger vehicles are still slower. The Behemoth's draw is one-pass Crater Floors and a huge payload. Vehicles can't climb Steep plots.
**Puck slots** carry pucks or Puck Stacks (T loads/unloads within 3 m). **One vehicle per Motor Pool** can be out at a time; demolishing a Motor Pool sends its vehicles to the nearest other Motor Pool (or to storage if none).

**Motor Pool parts:**
- **Motor Pool** 1,000 LM (garage; recalls, stores and upgrades any vehicle; **includes one Dump Plate**). v1 double-counted that Dump Plate in the Trundle step; the opening now costs 2,800 (Motor Pool + Trundle).
- Extra **Dump Plate** 200 (unload pad; a Dump Plate placed against a Gate pays directly).
- **Dust Vault** 1,500 (20 t buffer; outputs Puck Stacks to a rail or through a Bale Chute face into an adjacent Gate).

### 8.1 Vehicle upgrade lines (bought per vehicle by its owner; cost = multiple of that vehicle's price)

| Line | Levels: effect (cost × vehicle price) |
| --- | --- |
| **Gear Ratio** | +8% speed (0.20) · +16% (0.50) · +24% (1.00) |
| **Cargo Expander** | +40% payload (0.15) · +80% (0.40) · +120% (0.80) |
| **Afterburner** | Boost to ×1.45 cruise (0.15) · ×1.60 (0.40); −6% trip time per level |
| **Throttle Lock** | Hands-free cruise; −3% trip time (0.05) |
| **Wide Mouth** ★ | +20% width at ×0.92 speed (0.25) · +40% at ×0.85 (0.60) · +60% at ×0.78 (1.20). Net area ×1.10 / ×1.19 / ×1.25: a modest real gain, unlike the reference's near-zero trade-off [M§3c] |
| **Fast Tip** | Unload −40% (0.10) · −70% (0.30) |
| **Running Lamps** | 30 m beam, −10 points night penalty in this vehicle (0.05) · 45 m, −20 points (0.15) |

- Maxing a cleaning vehicle costs **6.30× its price** (1.70 + 1.35 + 0.55 + 0.05 + 2.05 + 0.40 + 0.20): Behemoth **756,000 LM**; Trundle 11,340.
- The Carryall takes only Gear Ratio, Afterburner, Throttle Lock and Running Lamps (2.50×).
- A maxed Behemoth reaches about 33 m²/s raw; 36 m²/s with Master Stroke.

### 8.2 ★ Refit (Review-gated personal track; not a parity upgrade line)

Late personal progression (review B1, M7). Bought per cleaning vehicle by its owner; each level is a separate purchase.

| Level | Gate | Effect (cumulative) | Cost × vehicle price | Behemoth | Bulldust | Skiff |
| --- | --- | --- | --- | --- | --- | --- |
| Refit I | Review 3 | +25% width and payload | ×4 | 480,000 | 112,000 | 48,000 |
| Refit II | Review 4 | +50% width and payload | ×8 | 960,000 | 224,000 | 96,000 |
| Refit III | Review 5 | +75% width and payload | ×16 | 1,920,000 | 448,000 | 192,000 |

- A maxed Behemoth with Master Stroke and Refit III cleans about **63 m²/s** raw (≈62 m²/s effective in §17).
- Width and payload grow together, so the duty cycle is unchanged; the gain is pure area.

## 9. Robots and the Flight Plan

### 9.1 Units

| Unit | Price | Rate | Store / bin | Patch | Delivery |
| --- | --- | --- | --- | --- | --- |
| **Roost + Sandpiper** (Mk I) | 4,500 × **1.15^(n−1)**, n = paid Roosts currently owned + 1 (free Roosts excluded) | 1.8 m²/s | Bin 15 kg; Roost store 300 kg | 2 rings = 19 plots (5,830 m², about 55 min) | Roost outputs **Puck Stacks** to a Glide Rail; full dust price |
| **Plover** (Mk II, upgrade in place) | 10,000 per Roost | 4.5 m²/s | Bin 40 kg; store 800 kg | 3 rings = 37 plots (11,350 m², about 42 min) | Same |
| **Albatross** (global) | 200,000 × **1.18^(n−1)**, n = Albatross owned + 1; +1 Nest (30,000) per 3 Albatross | 11 m²/s (about 28 s per Grimy plot) | 20-kg Bales | Nearest non-Polished plot to its **Work Front** (below), else anywhere; no travel overhead | Bales to the nearest Nest group <80% full (group = Nests within 100 m). ★ Bales sell at Bulk Rate unless processed |
| **Nest** | 30,000 | — | 40 Bales (800 kg) | — | Outputs to a Glide Rail (2 units/s) or a ★ **Bale Chute** straight into an adjacent Receiving/Field Gate, Bead Kiln or Tile Sinterer (no rate limit) |

- Example prices (Roosts include a 200 LM rail allowance): Roost #1 4,700; #8 12,170; #16 36,820; #24 112,200. Albatross #1 200k; #4 329k; #8 636k; #12 1.23M; #16 2.39M; #20 4.63M; #24 **8.98M**. All 24 Albatross cost **57.9M LM**.
- **Robot rates are net Moon-mix area rates.** Robots are depth-agnostic by design (their extra passes are folded into the quoted rate) and use Moon-mix density (0.424 kg/m²) for income everywhere.
- **Uptime:**
  - Local robots **0.64** with manual Re-site, **0.70** with Auto-Relocate; +0.08 per Wide Wing level, +0.02 per Deep Crop level, max 0.95. (0.70 = 0.22 lost to emptying; manual Re-site loses ≈4 more minutes per ≈50-min patch.)
  - Albatross 0.90, +0.02 per Deep Crop level, max 0.98.
- ★ **Re-site** (free, any time, review M6): one action from the Roost's panel or the Survey Globe. The Roost packs, hops to a chosen spot within 600 m and extends its rail automatically (2 LM/m); 60 s downtime. DOT pings "Roost idle: patch Polished" with a one-click Re-site to the nearest Grimy patch.
- Robots keep working with nobody nearby while the contract room is open, at the Unattended rate (§9.3) ★.
- ★ **Work Front** (Review 1): Albatross choose the nearest non-Polished plot within 800 m of a Work Front, else the nearest anywhere. A Work Front is any active Custodian with Effort ≥50% (§9.3), or a Flare Beacon a Custodian tags "Work Front" (one per Custodian). Plots finished there show as **Escorted** on the Plot Card and give that Custodian ½ Tenure XP. **Flock Formations** (Review 4) add modes: *Spread* (default), *Sweep Line* (a 200 m band ahead of your heading) and *Ring* (outward from your tagged Beacon). Work Front changes *where* the flock works, never its rate, so it is pacing-neutral.
- Robots can be **Grounded** (switched off) from their panel; a Grounded robot does nothing and costs nothing.
- Albatross never target texels under buildings (Settle has already cleared them, §12), and every plot is reachable by an Albatross.
- States (UI): **Foraging · Flying · Inbound · Molting · Patch Picked Clean · Roost Brimming · Crop Full · Grounded · Resting** (9).

### 9.2 Permits (bounded counts) ★

Counts stay small for performance (simulated at plot level on a 0.1-CPU server, rendered instanced) [R C4]. Growth comes from upgrades, not headcount. Permits are purchase caps: the buy button is disabled at the cap.

| Permits | Start | Review 1 (1%) | Review 2 (5%) | Review 3 (10%) | Review 4 (25%) | Review 5 (50%) |
| --- | --- | --- | --- | --- | --- | --- |
| Roost Permits | 16 | 20 | 20 | 24 | 24 | 24 |
| Flock Permits (Albatross) | 4 | 8 | 12 | 16 | 20 | 24 |
| Plant Permits (Kilns + Tile Sinterers) | 3 | 5 | 8 | 10 | 12 | 14 |

Hard ceiling per contract: **48 robots + 14 machines**, versus hundreds in the reference.

### 9.3 Reference baseline: robot activity

Default clean-rate multiplier = **1.0** independent of manual-cleaning Effort, player count, shared IP/subnet or
distance to a player. Robot work remains server-authoritative with the same measured budgets. Empty-room
checkpoint/suspension remains a hosting lifecycle rule; it is not a penalty for a connected player who stops sweeping.
The previous On-Shift/Unattended bonus curve is retired from the baseline; no household/subnet activity eligibility gate.
Custom fleet-upgrade/pacing variants may be revisited only as optional additions after reference fidelity.


## 10. Logistics

| Piece | Price | Spec |
| --- | --- | --- |
| **Puck Former** | 300 | 100-kg buffer; hold E to pour your Cell in; outputs **Puck Stacks** (a stack leaves at 20 kg or after 10 s) |
| **Glide Rail** (straight 4 m / short 1 m) | 8 / 2 (2 LM per m) | 1.5 m/s; units 0.75 m apart → **2 units/s**. A unit is a 1-kg puck, a Puck Stack (≤20 kg) or a 20-kg Bale → up to **144 t/h** per rail with stacks or Bales (7.2 t/h if fed loose pucks) |
| Glide Rail curve 45° / 90° · ramp · lift | 10 / 10 · 12 · 40 | Lift carries units up to 8 m vertically |
| ★ **Rail Run** | pieces at list price | Click-drag (LMB hold) lays straight, curve and ramp pieces along a path; shows the total before you confirm (review M5) |
| **Rail Fork** / **Rail Join** / Rail Stop | 25 / 25 / 10 | Fork alternates or can be set to "overflow". Join alternates inputs. Any Staff or higher may attach to anyone's rails |
| **Receiving Gate** | fixed: 4 per outpost | **3 rail inputs + 1 Bale Chute face** each; pays on arrival; no rate limit beyond its rails |
| **Field Gate** ★ | 60,000 (Review 2) | Buildable selling point: 2 rail inputs + 1 Bale Chute face; pays on arrival; mini-Railshot every 500 kg. Reason: players asked for placeable selling points [R C16] |
| **Remote Assay** ★ | 150,000 (Review 2; Review 1 with the Courier Pass Benefit) | Shift-wide suit add-on: pour your Cell from anywhere for 90% of value after a 10 s uplink; 60 s cooldown per player. This is the Roblox paid instant-sell made earnable [RB§5.4] |
| **Assay Counter** | fixed: 1 per outpost | Hold-to-pour; **4 pour slots** (a 5th player queues) |
| Railshot | fixed at each outpost | Fires a cargo sled after every 2 t sold there ("Railshot away"). Visual and shipped counter only; payment already happened on arrival |

- Starter kit for the sim's "Puck Former" step: Puck Former + 50 m of rail = **400 LM**.
- ★ **Throughput check (review M5).** Peak solo full-rate flows: Roosts ≈48 t/h at 5 h and ≈265 t/h at 31 h; the player's vehicle ≤95 t/h. With Puck Stacks each is 1–2 rails into one Gate's 3 inputs, so selling never binds; Bales (≈1,480 t/h at 31 h) go through Bale Chutes, which have no limit. The sim checks this every tick (§22) and reports any sell point above 80% of its rail capacity.
- ★ **Dust provenance (review M12).** Every unit carries `full` or `bale`. Bales are accepted only by Gates (paid at Bulk Rate), Bead Kilns and Tile Sinterers; they can't enter Cells, Puck Formers, Dust Vaults or the Assay Counter. Products made from Bale dust are full value (that is the processing reward).

## 11. Production and power

| Machine | Price | Grade I | Grade II (Review 2) | Grade III (Review 4) | Power (kW) I/II/III | Recipe | Gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Bead Kiln** | 15,000 | 1,800 kg/h in | 3,600 kg/h (+22,500) | 6,000 kg/h (+60,000) | 12 / 20.4 / 30 | 1 kg dust (or Bale dust) → 1 kg Glass Beads (16 LM/kg) | Assembly Gun |
| **Tile Sinterer** | 50,000 | 2,400 kg/h out | 4,800 kg/h (+75,000) | 8,000 kg/h (+200,000) | 20 / 34 / 50 | 1 kg dust + 1 kg Beads → 2 kg Sinter Tiles (37.5 LM/kg) | Review 1 |

- **Uplift per kg:**
  - Kiln on full-rate dust +11 LM/kg; on Bale dust +14.75 LM/kg.
  - Sinterer +28.9 LM per kg of tiles on Bale dust, or +27.75 on full-rate dust.
- **Ratio:** one Grade I Kiln feeds 1.5 Grade I Sinterers (2 Kilns : 3 Sinterers).
- Machines run at full speed at ≥100% power supply, scale linearly down to 10%, and stop below 10%.
- Status line ★: "Needs 20 kW, has 13 kW (Night Cell empty in 4 min)".

| Power piece | Price | Peak | Radius | Built-in storage | Day-average output |
| --- | --- | --- | --- | --- | --- |
| **Sun Sprig** (S) | 900 | 3 kW | 20 m | — | 64% of peak (fixed panel) |
| **Sun Fan** (M) | 2,400 | 8 kW | 30 m | 4 kWh | 64% |
| **Heliostat** (L, tracks the sun) | 6,000 | 18 kW | 45 m | 8 kWh | 90% |
| **Night Cell** (battery) | 2,800 | — | 30 m | 15 kWh | Charges from surplus at 92% round-trip efficiency |

**Solar model (review m4).** Fixed panels: output = peak × max(0, sin e), where e is the local sun elevation (averaged over the lit half of a day where the sun passes overhead this is 2/π ≈ **64%**). Heliostat: output = peak × min(1, sin e ÷ sin 20°) while e > 0 (≈**90%** average). At the **Twilight Strips** the sun grazes at e ≈ 0–3° all the time: fixed panels give ≈3% of peak and a Heliostat ≈10%, continuously. That is a photo spot, not a free 24/7 power farm.

**Sizing rule:**
- A machine drawing L kW continuously needs about 2.11·L kW of daytime generation (run + charge for the 30-min night) and 0.54·L kWh of storage.
- That costs about **900–1,100 LM per kW of load**. The balance sim uses 1,050 LM/kW.
- Example power packages: Kiln Grade I ≈ 12,600 LM; Sinterer Grade I ≈ 21,000 LM.

## 12. Build pieces (98; Assembly Gun; Reclaim refunds the paid price)

| Tab | Count | Pieces (representative prices, LM) |
| --- | --- | --- |
| Services | 7 | Motor Pool 1,000 · Dump Plate 200 · Dust Vault 1,500 · Roost (see §9) · Nest 30,000 · Field Gate 60,000 · Lamp Pylon 300 |
| Logistics | 10 | Puck Former 300 · Glide Rail straight 8 · short 2 · curve 45° 10 · curve 90° 10 · ramp 12 · lift 40 · Rail Fork 25 · Rail Join 25 · Rail Stop 10 |
| Production | 2 | Bead Kiln 15,000 · Tile Sinterer 50,000 |
| Power | 4 | Sun Sprig 900 · Sun Fan 2,400 · Heliostat 6,000 · Night Cell 2,800 |
| Structures | 75 | **Deck Plates** ×39 (hex S/M/L, square 1/2/4 m, triangle, quarter-round and ramps 15°/30°, each in 0.25/0.5/1 m thickness where it applies; 10–120) · **Gantries** ×20 (catwalk straight/corner/T/cross/stairs/ladder in 2 and 4 m; 30–150) · **Handrails** ×6 (handrail 2 m, handrail 4 m, corner post, swing gate, end post, grab bar; 10–40) · **Panels** ×9 (solid, porthole, archway and louvre panels, each 2 m or 4 m wide, plus a 4 m **Shine display panel** showing live Shine %; 25–80) · Brightside Banner (decorative, 100) |

- **Surface finishes** (cosmetic, free): **Brushed, Regolith Cast, Anodised, Enamel** at start; **Patina and Chrome** at Review 3 (6 finishes).
- ★ **Settle — building on dust (review B4).** A piece may be placed on dust. Its footprint's dust is cleared at the builder's own best hand-tool area rate (the hologram "settles" while you hold place: footprint m² ÷ that rate, in seconds) and paid at the **Bulk Rate** to the shift wallet, credited to the builder. Placement on already-clean ground is instant. Consequences:
  - No soft-lock: covered ground is genuinely clean, so plots under buildings reach Polished normally.
  - No free cleaning tool: Settle is never faster than sweeping with your own best tool and pays 25% instead of 100%.
  - **Reclaim never restores dust**, and refunds only the paid price, so Place/Reclaim loops gain nothing.
  - Elevated pieces (Gantries on posts) settle only their posts.
- Snaps to grid or edges, and hex Deck Plates rotate in 30° steps.
- **Reposition** moves a piece with everything attached (the new footprint settles as above).
- ★ **No-build zones:** nothing may be placed within 15 m of outpost services (Assay Counter, Gates, Railshot, Relay Pad, Requisitions Desk, Ops Console). Temps may place only Logistics and Structures pieces, and not within 10 m of a Services piece they didn't place.
- Every piece is tagged with its author; Temps' builds are revertible in one action (Incident Report).

## 13. Performance Reviews (contract milestones) ★

Fixes [R C1, C3, C14]: something new arrives at every milestone across the whole contract.

**How a Review fires.** Shine reaches the threshold **and** the Review's **Brief** is complete. A Brief is two short player-action tasks, shown from the previous Review onward, so an active shift finishes it before the threshold arrives (the sim's efficient policy does; cost ≈20 min of hand play per Brief, already in §18). Shift-level: any member's work counts. This is how late Reviews require player actions (review B1, M7).

**Rewards.** Reviews no longer pay cash (review M7: 2–10 min of income was trivial). They pay a **free issue**, Commendations, permits, a qualitative unlock and Tenure. ★

| Review | Shine | Brief (complete before or at the threshold) | Free issue | Comm. | Unlocks | Permits (Roost / Flock / Plant) |
| --- | --- | --- | --- | --- | --- | --- |
| Start | 0% | — | — | — | Tools T1–T6 (Ion Curtain is not gated), Assembly Gun, every board node except Golden Handshake, suit gear, Trundle/Skiff/Carryall/Bulldust, Roost/Plover, Albatross, Bead Kiln Grade I, Keen Beak I, Deep Crop I, Auto-Relocate | 16 / 4 / 3 |
| **1** | 1% | Stamp 25 plots yourselves (player-credited) · Deliver 1 t of Glass Beads | A Roost & Sandpiper | 2 | Behemoth, Tile Sinterer, Keen Beak II, Tailwind I, ★ **Work Front** (the flock follows you) | 20 / 8 / 5 |
| **2** | 5% | Hand-Stamp 5 Steep plots · Run a Kiln through a full night on Night Cells | A Field Gate | 3 | Golden Handshake, Grade II, Field Gate, Remote Assay, Punch List, Keen Beak III, Deep Crop II, Wide Wing I, ★ **Carryall Convoy** (record a route once; a Carryall then shuttles Puck Stacks or Bales along it) | 20 / 12 / 8 |
| **3** | 10% | Hand-Stamp 10 Steep plots · Visit 3 outposts | Two Nests | 4 | Keen Beak IV, Deep Crop III, Tailwind II, Patina and Chrome finishes, Survey Globe "cluster" view, ★ **Refit I**, ★ **Core Samples** appear on Steep plots | 24 / 16 / 10 |
| **4** | 25% | Recover 5 Core Samples · Lead a Work Front through 50 Crater Floor plots | A Grade II upgrade | 5 | Keen Beak V, Tailwind III, Wide Wing II, Grade III, ★ **Refit II**, ★ **Flock Formations** | 24 / 20 / 12 |
| **5** | 50% | Recover 10 Core Samples in total · Feed 50 t to Tile Sinterers within one day/night | A Grade III upgrade | 6 | Homing I (Straggler Priority), ★ **Refit III**, Beacon Run preview | 24 / 24 / 14 |
| **6** | 75% | Hand-Stamp 25 Steep plots · Finish one Beacon Run | — | 8 | Homing II (Punch List Sweep), **Final Walkthrough** (DOT auto-beacons the 12 largest remaining clusters), **Closing Bonus** (Inspector's Stamp ×2 until Fulfilled) | — |
| Fulfilled | 100% | — | — | 20 | Ending, Showcase Moon; Tenure bonus | — |

**Who gets Review and Fulfilled rewards (review M9).** Every contract member — and every Temp — with **≥10 credited plots or ≥30 active minutes** (Effort > 0) since the previous Review (or since joining, for Review 1), whether or not they are online when it fires. Offline members receive Commendations and Tenure at next login. Joining at 99.9% earns nothing until you meet the threshold.

## 14. Inspector's Stamp and crediting

- **Credit:** a plot is credited to whoever removed the most dust from it: a player, or "Flock" for robots. Credit drives Tenure XP and Stamp Premium. Plots finished by Albatross at your Work Front are Flock-credited but marked Escorted (½ XP to you).
- **Inspector's Stamp:** 50 LM base on Polished.
  - Player-credited plots: ×1.5 or ×2 with Stamp Premium; ×1.5 more if the Static Rake removed the last dust (Charge).
  - Robot-credited plots: ×1, or the Stamp Premium multiplier with Golden Handshake.
  - Closing Bonus (Review 6): ×2 for everything.
- ★ Every plot pays its Stamp (the reference paid crew-credited sectors base only [M§2.4]), and nobody is penalised for co-op.
- Moon total at base: 163,842 × 50 = **8.19M LM** (about 6% of contract earnings).

## 15. Collectibles (exploration)

| Collectible | Count | Reward each | Total LM | Placement |
| --- | --- | --- | --- | --- |
| Stray Cargo: **Near Parcel** | 32 | 30 LM + 10 Tenure XP | 960 | 8 within 600 m of each outpost; 6 of Boreal's within 300 m (Induction step 8) |
| Stray Cargo: **Parcel** | 58 | 200 LM + 20 XP | 11,600 | 600–1,500 m from outposts |
| Stray Cargo: **Crate** | 45 | 600 LM + 40 XP | 27,000 | Mid-latitudes; 3 seeded along the Boreal → Dawnside route |
| Stray Cargo: **Pallet** | 15 | 2,500 LM + 80 XP | 37,500 | Far crater floors and Steep plots (Hop Pack routes) |
| **Survey Points** (real craters and rilles) | 24 | 4,000 LM + 2 Commendations + 100 XP + a DOT site memo | 96,000 | Named real features on the baked terrain |
| ★ **Core Samples** (Review 3+) | 40 | 1 Commendation + 50 XP (no LM) | — | Steep plots only (hand tools and Hop Pack); used by Review 4–5 Briefs |
| Full Stray Cargo set | 1 | 10 Commendations + "Lost & Found" livery | — | — |
| All 40 Core Samples | 1 | 5 Commendations + "Bedrock" livery | — | — |

★ All collectibles together pay **173,060 LM**, about 24% of the personal-upgrade total. Exploration accelerates progress without replacing it; in the reference, flags and sites roughly paid for all personal progression [M exec 7]. Near Parcels are deliberately small (review M2): the big rewards are far from Boreal.

## 16. Meta economy (profile)

| Item | Values |
| --- | --- |
| Tenure XP to next level | 100 + 40·level (levels 1→50 total 53,900 XP) |
| Tenure XP sources | 1 per plot credited to you · 1 per 250 kg of **player-cleaned dust** (removed by your own tools or vehicles; robot dust never counts) · 100 × Review number per Review you are eligible for · 100 per Survey Point · 50 per Core Sample · 25 per Docket goal (each contributing member) · 50–500 per achievement · 10/20/40/80 per Near Parcel/Parcel/Crate/Pallet |
| Tenure from one solo contract | ≈12,300 (plots) + 7,500 (dust) + 2,100 (Reviews) + 2,900 (Dockets) + ≈4,200 (achievements) + ≈3,000 (collectibles) ≈ **32,000 XP → Tenure ≈38** (review m5; v1's rates gave ≈49) |
| Commendations per contract | Reviews 2+3+4+5+6+8 = 28, Fulfilled 20 → **48**; plus achievements (1–5 each), full Dockets (1 each, max 3 per player per real day), Survey Points (2 each), Core Samples (1 each), full Stray Cargo set (10), all Core Samples (5) |
| Certifications | Brushwork 0 · Railhand 30 · Driver 60 · Assembly 100 · Aviary 160 · Finisher 250 · Dispatch 400 Comm.; slots: 1, +1 at Tenure 20, +1 at Tenure 40 |
| Benefits Package | Quick Clip 15 · Signing Bonus 20 · Lope Training 25 · Comfort Seat 25 · Pre-Approved Motor Pool 40 · Fleet Voucher 50 · Courier Pass 60 Comm. |
| Locker cosmetics | 5–30 Comm. each; one livery per 5 Tenure levels free |

### 16.1 ★ Shift Docket (review B3)

| Rule | Value |
| --- | --- |
| Scope | **One Docket per shift**, 3 goals, shared by everyone present. Not per player |
| Issue | A new Docket every **1,800 s of shift-active time** (time with A_eff > 0). Never on Clock In, never rerolled by Clock Out/In. At most **8 Dockets per contract per real day** (UTC) |
| Starts | After the Probation Checklist is passed (≈2.0 h solo) |
| Goal reward | **0.5 income-minute** each, LM, to the shift wallet; completing all three adds **1 income-minute** (2.5 in total) |
| Income-minute | Stage base income ÷ 60 from a **fixed table** (below), keyed by Shine. It never reads actual income, so Docket, Review, Stamp and collectible payouts can't feed back into the next Docket |
| Commendation | Completing all three pays 1 Commendation to each member who contributed (progressed a goal, or ≥10 active minutes during that Docket); max 3 Docket Commendations per player per real day |
| Goal types | `stampPlotsNear{target, n}`, `stampSteepByHand{n}`, `deliverToMachines{kg}`, `visitOutpost{id}`, `findStrayCargo{n}`, `resiteRoosts{n}`, `workFrontPlots{n}`, `beaconRun{}`; `n`/`kg` = round(stage factor × base), base and factor per template in `shift-docket.json` |

| Shine band | <0.1% | 0.1–1% | 1–5% | 5–10% | 10–25% | 25–50% | 50–75% | 75–100% |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Stage base income (LM/h) | 40,000 | 400,000 | 1,000,000 | 2,000,000 | 4,000,000 | 6,500,000 | 8,000,000 | 9,500,000 |

Pacing effect: the efficient policy completes 2 goals per Docket = 1 income-minute per 30 active minutes ≈ **+3.3%** of stage base income from ≈2 h. That roughly replaces the removed Review cash (3.475M over a solo contract) and is in §18.

## 17. Earn-rate math per stage (solo, efficient policy)

Income = stage base income at that clock time (lit or dark as at that minute; Docket, Review and collectible income excluded). Rows 0:15–2:00 are re-derived in Appendix B; rows from 3:00 are the v1 prototype's robot columns with v2 player-area and income adjustments (Master Stroke vehicle width from 5.0 h; Refit I/II/III after Reviews 3/4/5; manual Re-site uptime until Auto-Relocate at ≈4.5 h).

| Clock | Income (LM/h) | Player area (m²/s) | Roost robots (m²/s) | Albatross (m²/s) | What the player has |
| --- | --- | --- | --- | --- | --- |
| 0:15 | 2,000 | 0.39 | — | — | Crescent Squeegee + Cell I, working the Landing Apron (5 of 6 Stamped) |
| 0:30 | 2,700 | 0.41 | — | — | Bristle Broom + Cell I, Clip Light; night begins |
| 1:00 | 4,000 | 0.61 | — | — | Assembly Gun, Puck Former + rail (Lane Broom at 1:04) |
| 1:30 | 11,900 | 1.82 | — | — | Trundle (bought 1:29); night |
| 2:00 | 23,800 | 2.20 | 1.15 | — | Static Rake, Broad Strokes I, first Roost (manual Re-site, uptime 0.64) |
| 3:00 | 65,700 | 4.6 | 3.5 | — | Skiff, 3 Roosts |
| 4:00 | 175,000 | 12.9 | 5.2 | — | Bulldust, first Kiln, first Plovers |
| 5:00 | 549,000 | 19.5 | 31.5 | — | 11 Roosts (Plovers), Auto-Relocate, 3 Kilns, Master Stroke |
| 6:00 | 826,000 | 24.3 | 50.4 | 9.9 | 16 Plovers, first Albatross (5.9 h) |
| 8:00 | 1.22M | 33.4 | 63.0 | 19.8 | Behemoth, Tile Sinterers, 2 Albatross |
| 10:00 | 1.52M | 35.4 | 72.5 | 90.1 | **7** Albatross (7 × 11 × 1.3 × 0.9), Keen Beak I |
| 12:00 | 2.48M | 35.5 | 72.5 | 115.8 | 9 Albatross, Grade II machines |
| 16:00 | 3.83M | 44.4 | 112.3 | 252.6 | 13 Albatross, 24 Plovers, Refit I |
| 20:00 | 6.52M | 53.3 | 137.8 | 369.2 | Grade III, Tailwind II, Refit II |
| 24:00 | 7.43M | 53.3 | 155.5 | 573.2 | Keen Beak IV |
| 28:00 | 9.49M | 62.1 | 170.1 | 785.8 | Keen Beak V, Tailwind III, Refit III |
| 31:00 | 10.18M | 62.1 | 173.9 | 971.5 | 23 Albatross, Homing |

The solo contract earns about **141M LM** in total (stage base ≈137M + Refit/Master player income ≈3.5M + Docket ≈4.5M − removed Review cash 3.5M), against **≈143M LM of sinks**: all personal 0.72M, vehicles and upgrades about 1.2M, Behemoth Refits 3.36M, Roosts about 1.3M, 24 Albatross 57.9M, Flight Plan 79.1M, machines with Grades and power about 6M. Money stays meaningful until the end; the reference's wallet stops mattering after the robot [R C1].

## 18. Pacing targets — and the math showing they're hit

### 18.1 Results (efficient policy, contract-active hours, no Benefits; the ≤1 h rows include Near Parcels)

| Milestone | Target | Solo | 2 players | 4 players | 8 players | 16 players |
| --- | --- | --- | --- | --- | --- | --- |
| ★ First Inspector's Stamp | 5–8 min | **5.9 min** ✓ | 4 min | 3 min | 2 min | 2 min |
| First tool upgrade (Crescent Squeegee) | 5–10 min | **5.9 min** ✓ | 4 min | 3 min | 2 min | 2 min |
| First Dust Cell | ~10 min | **8.5 min** ✓ | 6 min | 4 min | 3 min | 3 min |
| Assembly Gun | ~45 min | **42 min** ✓ | 25 min | 16 min | 13 min | 13 min |
| First vehicle (Trundle) | 1–1.5 h | **1.49 h** ✓ | 0.86 h | 0.57 h | 0.50 h | 0.52 h |
| First local robot (Roost) | 1.5–2 h | **2.0 h** ✓ (upper edge) | 1.1 h | 0.72 h | 0.57 h | 0.56 h |
| First production (Bead Kiln) | 2.5–3.5 h | **3.5 h** ✓ (upper edge) | 2.1 h | 1.4 h | 1.2 h | 1.1 h |
| First global robot (Albatross) | 5–6 h | **5.9 h** ✓ | 3.7 h | 2.8 h | 2.3 h | 2.1 h |
| Shine 1% (Review 1) | ~6 h | **6.2 h** ✓ | 3.8 h | 2.7 h | 2.2 h | 1.9 h |
| All personal upgrades | ~10–12 h | **10.4 h** ✓ | 6.2 h | 5.2 h | 4.0 h | 3.4 h |
| Shine 5% / 10% / 25% | — | 10.3 / 13.4 / 18.6 h | 6.2 / 8.1 / 11.5 | 4.6 / 5.9 / 8.6 | 3.5 / 4.5 / 6.5 | 2.8 / 3.6 / 5.1 |
| Shine 50% / 75% | — | 24.0 / 27.9 h | 15.1 / 17.8 | 11.4 / 13.5 | 8.8 / 10.4 | 6.8 / 8.0 |
| **Contract Fulfilled** | solo 30–35 h · 4p ~15 h · 16p 8–10 h | **31.1 h** ✓ | 19.8 h | **15.1 h** ✓ | 11.7 h | **9.0 h** ✓ |
| ★ Player-attributable share of Shine progress, solo (B1) | ≥20% at every stage | ≥**52%** (minimum, at 31 h) ✓ | — | — | — | — |
| ★ Own-tool share of Polished area, solo (watch metric, no target) | — | 62% at 2 h · 24% at 6 h · 15% at 10 h · 9% at 16 h · 4.4% at 31 h | — | — | — | — |
| ★ Solo purchase gap, P50 / max (M7, m10) | ≤45 min / ≤90 min | est. ≈35 min / ≈90 min (sim to confirm) | — | — | — | — |
| ★ 4 players at 50% attendance, Fulfilled (M19) | 17–21 h contract-active | — | — | est. **18.5 h** | — | — |

Player-attributable share = (0.85 × own area + 0.5 × robot area) ÷ (0.85 × own area + robot area): the half of robot output that exists only because someone is active (§9.3). At 31 h: (52.8 + 572.7) ÷ 1,198 = 52%.

### 18.2 Worked math for the early milestones (outpost mix 0.335 kg/m², 1.84 LM/m²)

Trips use the §22 distance model: before the Puck Former, trip = 2 × d ÷ 3.4 m/s + 6 s pour, d = 60 m + √(A ÷ π) where A is the area you have cleaned off the Apron; Apron trips use d = 30 m. The contract starts at sunrise; the first 30 min are lit; Induction steps pay XP only.

1. **First Inspector's Stamp at ≈5.9 min.** Desk Duster on an Apron plot: 61.4 m² of level-2 drift (7.6 kg) at 0.2475 m²/s = 248 s of sweeping, two 4-kg Cell trips of 23.6 s each, plus ≈60 s of Induction prompts → 5.9 min. It pays 50 (Stamp) + 38 (dust) = 88 LM.
2. **Crescent Squeegee (75) at 5.9 min,** straight from the first plot's 88 LM.
3. **First Cell (Squeegee Cell I, 100) at 8.5 min.** An Apron plot with the Squeegee takes 133 s + one 23.6 s trip = 2.6 min and pays 88 LM (≈2,000 LM/h).
4. **Assembly Gun (750) at 42 min.** The Apron is done at ≈17 min (528 LM in all). The Bristle Broom + Cell I on outpost ground cleans 0.728 m²/s, fills 26.3 kg in 108 s, walks 45–50 s → duty ≈0.70 → 0.51 m²/s → 3,300 LM/h lit, 2,700 LM/h dark with the Clip Light. Squeegee 75 + Cell 100 + Bristle 200 + Cell 140 + Clip Light 150 + Holster I 100 + Assembly Gun 750 = 1,515 LM, reached at 0:42 with three Near Parcels (90 LM). ✓
5. **Trundle at 1.49 h.** The Puck Former kit (400) at 0:49 cuts trips to 21 s (duty 0.84, 4,000 LM/h); the Lane Broom (750) at 1:04 gives 1.05 m²/s (≈6,800 LM/h lit). Motor Pool 1,000 (includes the Dump Plate) + Trundle 1,800 = 2,800 at 1:29. ✓
6. **Roost at 2.0 h.** The Trundle on outpost ground: 1.6 × 3.0 × 0.8 ÷ 1.10 = 3.49 m²/s, 200 kg fills in 171 s against a 100 s trip → 2.20 m²/s → 14,300 LM/h lit (11,900 dark). Static Rake 1,100 at 1:34 and Broad Strokes I 350, then Roost 4,700 at ≈2:01. ✓ (upper edge)
7. **Bead Kiln at 3.5 h.** 15,000 + 12,600 power = 27,600 LM after the Skiff (12,000, ≈3.0 h) at ≈66k LM/h. ✓ Auto-Relocate (15,000) waits until ≈4.5 h, when 11+ Roosts make its payback short.
8. **Albatross at 5.9 h.** 200,000 + Nest 30,000 at 0.55–0.83M LM/h, after the 16 Roost Permits are filled with Plovers. Docket income (+3.3% since ≈2 h) brings v1's 6.0 h to 5.9 h. ✓
9. **Shine 1% at 6.2 h.** 1% = 502,655 m². Polished area by 6:00 is ≈0.41 km² (trapezoid of §17 with the 0.85 factor on player area; ≈0.43 km² raw). The 6:00 Polished rate is 0.85 × 24.3 + 50.4 + 9.9 = 81 m²/s, so the remaining ≈0.09 km² takes ≈0.3 h → 6.3 h on the curve; the Docket timing shift (−0.07 h) gives 6.2 h. ✓

### 18.3 Worked math for the full clear (solo)

Trapezoid integration of the §17 rates, Polished rate = 0.85 × player area + Roost + Albatross (v1's table mixed raw and 0.85-factored rates; v2 uses the factor throughout):

| Interval | Avg Polished m²/s | km² |
| --- | --- | --- |
| 0–6 h | (ramp) | 0.41 |
| 6–8 | 96 | 0.69 |
| 8–10 | 152 | 1.09 |
| 10–12 | 206 | 1.48 |
| 12–16 | 311 | 4.47 |
| 16–20 | 477 | 6.88 |
| 20–24 | 663 | 9.55 |
| 24–28 | 891 | 12.84 |
| 28–31 | 1,103 | 11.92 |

- The sum to 31 h is **49.33 km²**. The remaining 0.94 km² at 1,198 m²/s (4.31 km²/h) takes 0.22 h → **31.2 h** on the curve.
- The same integration crosses 1/5/10/25/50/75% at 6.28 / 10.44 / 13.48 / 18.70 / 24.20 / 28.08 h. Net timing shifts from Docket income (+3.3%) and removed Review cash: −0.07 / −0.13 / −0.09 / −0.13 / −0.19 / −0.15 h, and −0.1 h at the end → **6.2 / 10.3 / 13.4 / 18.6 / 24.0 / 27.9 h; Fulfilled 31.1 h** ✓. (Check: the same integration of the v1 rows reproduces v1's 6.3 / 10.5 / 13.6 / 18.9 / 24.4 / 28.3 / 31.5 h.)
- Review Briefs cost ≈20 min of hand play each (R1–R6 ≈2 h of the player at hand-tool rates instead of the Behemoth): ≈0.2 km² of player area, <0.1 h at the end; included.
- At 16 players, robots run ×3.32 and 16 players clean about 440 m²/s themselves (≈770 m²/s with Refit III). Reviews arrive almost back-to-back, and the clear lands at ≈9.0 h.

### 18.4 Unlock cadence

- Solo purchase gaps are ≤38 min through the first 10 h. From 10 h, Refit I/II/III, Grade upgrades, Nests and Albatross interleave with Flight Plan levels; the longest expected gap is ≈1.5 h (saving for Keen Beak V while permits are full).
- Performance Reviews arrive at 6.2 / 10.3 / 13.4 / 18.6 / 24.0 / 27.9 h: a milestone every 3–6 h, each with a qualitative unlock, versus nothing after about 6 h in the reference.
- **Balance target: solo purchase gap P50 ≤45 min, max ≤90 min** (progression items only; cosmetics don't count).
- The **Next Requisition** tracker pings at 25/50/75% funded, so long saves still show progress every session.

## 19. How player count affects pacing

1. **Personal output.** N players clean N × 1/(1 + c·(N−1)) as much area. ★ c = **0.05** until the shift owns a Puck Former (16 players crowd one outpost and one Assay Counter with 4 pour slots: 0.57 at 16), then 0.02 (0.77 at 16) (review m3).
2. **Income mix.** Player-cleaned dust pays full rate; Albatross Bales pay the Bulk Rate unless processed. Larger shifts therefore fund the fleet much faster. A solo player's fleet funds itself slowly, which is where the 30+ h comes from.
3. **On-Shift Bonus.** Robots run ×(1 + 0.6·√(A_eff − 1)) (§9.3), with the anti-farm rules.
4. **Costs per tier (review m2).** For N members who each want a copy:
   - Shared items (board, suit gear, Cells, robots, machines, Flight Plan): × 1.
   - Desk Duster, Crescent Squeegee, Bristle Broom: × 1 (Standard Issue: free to every member once anyone owns one).
   - Lane Broom, Static Rake, Ion Curtain, Assembly Gun, vehicles, vehicle upgrades, Refits: list × (1 + 0.4·(N−1)) (Repeat Requisition).
5. **Permits.** Flock, Roost and Plant Permits come only from Reviews. Big shifts become milestone-paced late (they hit permit caps); solo stays money-paced.
6. **Docket** is shift-level, so it does not multiply with headcount.
7. ★ **Permit-free money sink (review M19): the Brightside Monument.** A cosmetic statue at an outpost with one tier per Review (7 tiers), each costing 30 stage-base income-minutes × (1 + 0.25·(N−1)). It changes nothing in pacing (the sim never buys it) but gives big shifts something to spend on while permit-capped. Plus every member's Refits.
8. ★ **Uneven attendance.** "co-op-uneven" policy: N members each present a fraction f of contract-active hours (independent sessions). Target row: 4 players at f = 0.5 → Fulfilled in 17–21 contract-active hours (est. 18.5 h; each member ≈9–10 h).

Net effect: 1 → 31.1 h, 2 → 19.8 h, 4 → 15.1 h, 8 → 11.7 h, 16 → 9.0 h. Speed-up versus solo is ×1.57 / ×2.06 / ×2.66 / ×3.46.

## 20. Late-game spread versus the reference (the #1 complaint)

| Content still ahead of the player at… | Reference (per research) | Ours (solo) |
| --- | --- | --- |
| 1% of the Moon | Almost nothing ("all upgrades at 0.6%" [R C1]) | Behemoth, Tile Sinterer, Work Front, Golden Handshake, Grades II–III, Field Gate, Remote Assay, Carryall Convoy, Refit I–III, Core Samples, Flock Formations, 14 of 15 Flight Plan levels, 20 Albatross permits, 5 Reviews with Briefs |
| 10% | Only "buy more robots" | 9 Flight Plan levels, Grade III, Refit I–III, Core Samples, Flock Formations, 8 Albatross permits, 3 Reviews, Homing, Final Walkthrough |
| 50% | Same | Homing I/II, Refit III, Keen Beak V or Tailwind III if not yet afforded, the last Albatross permits, Review 6 Brief (Steep plots, Beacon Run) |
| 99% | Hunting sectors with poor tools [R C8] | Punch List, Homing II Sweep, Final Walkthrough beacons, Closing Bonus ×2, Work Front on the last clusters |

## 21. Data-driven format plan (`packages/game-data`)

**Rules:**
- All tables are JSON in `packages/game-data/data/*.json`. Each is validated by a zod schema in `packages/shared/src/config/<name>.schema.ts` (exported as `<Name>Schema` + inferred type).
- `packages/game-data/src/index.ts` loads, validates and freezes them, and exposes typed accessors. The sim, server, client and balance-sim read only through it.
- IDs are dot-namespaced (`tool.lane_broom`).
- `displayName` is an editable label tracked in the [naming catalog](naming-bible.md). Validate missing/duplicate IDs and label consistency; no generic-word, fuzzy token-overlap or same-slot ban.
- Field names carry their unit as a suffix (`priceLm`, `widthM`, `speedMps`, `capacityKg`, `durationS`, `powerKw`, `energyKwh`, `rateM2ps`, `frac` for 0–1 fractions, `mult` for multipliers).
- Every file has `"schemaVersion": 1`.
- ★ **Effects** are `{stat, op: "add" | "mul" | "set", value}` for numbers, or `{op: "flag", featureId}` for qualitative behaviour (review M18). `featureId` must exist in `features.json`; each id names the sim/server rule that implements it.

| File | Key fields (units) | Balance agent may tune | Locked (structure/owner) |
| --- | --- | --- | --- |
| `world.json` | `moonRadiusM`, `gridFrequency` (128), `plotCount` (derived check), `gravityMps2`, `dayLengthS`, `daylightFrac`, `contractStartSunPhase`, `terrainClasses[{id, plotShareFrac, dustLevel}]`, `dustKgPerM2PerLevel`, `openedThresholdFrac`, `polishedThresholdFrac`, `steepSlopeDeg`, `steepSweepMult` (0.6), `outpostMix{...}`, `compoundRings` (1), `landingApron{plotsPerOutpost, coverageFrac, dustLevel}` | `dustKgPerM2PerLevel`, `terrainClasses.dustLevel`, `outpostMix`, `landingApron`, `steepSweepMult` | radius, frequency, day length 3,600 s / 0.5, thresholds 0.001/0.01, plot shares (terrain bake) |
| `economy.json` | `materials[{id, lmPerKg}]`, `bulkRateFrac`, `stampBaseLm`, `relayFeeLm`, `recallFeeLm`, `repeatRequisitionFrac`, `repeatRequisitionMinTier` (4), `standardIssueMaxTier` (3), `startWalletLm`, `settle{payFrac}`, `refundRule` ("paidPrice"), `tricks[{id, lm}]`, `trickCapPerDriverLm`, `trickCapPerShiftLm`, `trickCapWindowS`, `trickDriverOnly` | all numbers | material IDs, refund rule |
| `movement.json` | `walkMps`, `lopeMps`, `sweepWalkMps`, `jumpApexM`, `hopBurstMps`, `hopRechargeS`, `nightPenaltyFrac`, `lampPenaltyReliefFrac` | all | — |
| `tools.json` | `[{id, tier, priceLm, widthM, depthLevels, reachM, strokeS, cellBaseKg, traitId, gateReviewId?}]` | price, width, depth, reach, stroke, cellBaseKg | id, tier count (6 + Assembly Gun), traitId, gate |
| ★ `traits.json` | `[{id, params}]`: Detailing `{radiusM: 0.5}`, Flick `{airborneSweep: true}`, Sure Footing `{steepSweepMult: 1.0}`, Lane Lock `{sweepSpeedMult: 1.15}`, Charge `{steepSweepMult: 1.0, finishStampMult: 1.5}`, Twin Pass `{effectiveWidthMult: 1.15}` | params | trait ids |
| `dust-cells.json` | `levelMult[3]`, `costsLm{toolId: [3]}`, `puckKg`, `stackMaxKg`, `loosePuckCap{perPlayer, perContract, despawnS, despawnValueFrac}` | all numbers | 3 levels |
| `promotions-board.json` | `hubId`, `departments[{id, nodeIds}]`, `nodes[{id, departmentId, kind, levels[{costLm, effects[]}], prereqs[{nodeId, level}], gateReviewId?}]` | `costLm`, effect `value` | node count 23, kinds, level counts (3/2/1), stats, prereq graph, gates |
| `suit-gear.json` | `lines[{id, levels[{costLm, effects}]}]` | costs, values | 5 lines, 14 levels |
| `vehicles.json` | `[{id, tier, priceLm, seats, widthM, cruiseMps, boostMult, depthLevels, payloadKg, puckSlots, upgradeLineIds, gateReviewId?}]`, `motorPoolParts[{id, priceLm, ...}]`, `vehiclesOutPerMotorPool` (1) | all stats and prices | 5 vehicles, seats (Carryall 8), line assignment |
| `vehicle-upgrades.json` | `lines[{id, levels[{costMultOfVehiclePrice, effects}]}]`, ★ `refit{levels[{gateReviewId, widthAddFrac, payloadAddFrac, costMultOfVehiclePrice}], vehicleIds}` | multipliers, effect values | 7 lines, 16 levels; Refit 3 levels and gates |
| `robots.json` | `roost{basePriceLm, priceGrowthMult, railAllowanceLm, resiteDowntimeS, resiteMaxM}`, `units[{id, rateM2ps, binKg, storeKg, rings, uptimeManualFrac, uptimeAutoFrac}]`, `albatross{basePriceLm, priceGrowthMult, baleKg, uptimeFrac, nestPerUnits}`, `nest{priceLm, capacityBales, groupRadiusM, fullFrac}`, `workFront{radiusM, minEffortFrac}`, `states[]` | all numbers | unit IDs, 2 local + 1 global |
| `flight-plan.json` | `lines[{id, levels[{costLm, gateReviewId?, effects}]}]`, `items[{id: "auto_relocate", costLm, rangeM}]` | costs, values | 5 lines, 15 levels, gates |
| `permits.json` | `byReview[{reviewId, roost, flock, plant}]`, `hardCaps{robots, machines}` | counts **within** hard caps | hard caps (48 robots / 14 machines: perf budget owner) |
| `on-shift-bonus.json` | `coefficient` (0.6), `exponent` (0.5), `unattendedMult` (0.5), `effortWindowS` (300), `effortThresholdFrac` (0.4), `inputWindowS` (30), `moveWindowS` (60), `moveMinM` (10), `minTenure` (3), `subnetPrefixV4` (24), `subnetPrefixV6` (56), `subnetCap` (1.0), `maxCounted` (16), `roomCloseNoEffortS` (1,800) | `coefficient` within 0.3–0.8, `exponent` within 0.4–0.7, `unattendedMult` within 0.3–0.7 | windows, anti-farm rules, maxCounted |
| `logistics.json` | `rail{speedMps, spacingM, unitsPerS}`, `puckKg`, `stackMaxKg`, `stackReleaseS`, `baleKg`, `pieces[{id, priceLm, ...}]`, `gate{railInputs: 3, baleChuteFaces: 1}`, `fieldGate{priceLm, railInputs: 2, railshotKg}`, `assayCounter{pourSlots: 4}`, `remoteAssay{priceLm, valueFrac, uplinkS, cooldownS}`, `railshotEveryKg`, `baleAcceptors[]` | prices, `valueFrac`, timings | rail physics constants (perf), puck 1 kg, stack ≤20 kg, Bale 20 kg, provenance rule |
| `production.json` | `machines[{id, priceLm, recipe{in[{materialId, kg}], out[{materialId, kg}]}, grades[{throughputKgph, upgradeCostLm, powerKw}], gateReviewId?}]`, `minPowerFrac` | prices, throughput, power, upgrade costs | 2 machines, 3 grades, recipes |
| `power.json` | `pieces[{id, priceLm, peakKw, radiusM, storageKwh, tracksSun}]`, `fixedPanelModel` ("sinElevation"), `trackerFullAtElevationDeg` (20), `batteryRoundTripFrac` | all numbers | 3 solar sizes + Night Cell |
| `build-pieces.json` | `[{id, tab, priceLm, footprint, snap, finishes[]}]`, `finishes[{id, gateReviewId?}]`, `noBuildRadiusM` (15), `tempBuildTabs[]` | prices | piece list (98), tabs, 6 finishes |
| `performance-reviews.json` | `[{id, shineFrac, brief[{type, amount}], freeItems[ids], commendations, unlocks[ids]}]`, `rewardEligibility{minCreditedPlots: 10, minActiveS: 1800}` | `commendations`, brief amounts, which unlock sits at which Review (with designer sign-off) | the 6 thresholds (1/5/10/25/50/75%), "no cash" rule |
| `plot-bonus.json` | `stampBaseLm`, `stampPremiumMult[2]`, `chargeFinishMult`, `closingBonusMult`, `creditRule` | multipliers | credit rule |
| `collectibles.json` | `strayCargo[{size, count, lm, tenureXp}]`, `surveyPoints[{id, featureName, lm, commendations, tenureXp}]`, `coreSamples{count, commendations, tenureXp, reviewId}` | rewards | counts 32/58/45/15 / 24 / 40, positions (world bake) |
| `meta.json` | `tenure{xpBase, xpPerLevel, maxLevel, ranks[], sources{...}}`, `commendations{sources{...}, docketMaxPerDay}`, `certifications[{id, costComm, effects}]`, `benefits[{id, costComm, effects}]`, `slotsAtTenure[]`, `monument{tiers, incomeMinutesPerTier, headcountFactor}` | XP and Commendation numbers, costs, effect values ≤ caps | IDs, "no random rewards" rule |
| `onboarding.json` | `induction[{id, trigger, rewardLm (0), tenureXp}]`, `probation[...]` | rewards | step order |
| `shift-docket.json` | `issueEveryActiveS` (1,800), `maxPerDay` (8), `startAfter` ("probation"), `goalRewardIncomeMinutes` (0.5), `fullDocketBonusIncomeMinutes` (1.0), `stageBaseIncome[{fromShineFrac, lmPerH}]`, `templates[{id, type, stageMinShine, stageMaxShine, amount{base, factor}}]` | all numbers | goal types, "shift-level, fixed table" rule |
| `achievements.json` | `[{id, displayName, stat, threshold, commendations, tenureXp, hidden}]` | rewards | list and thresholds (naming bible) |
| ★ `moderation.json` | `onBreakAfterS` (600), `tempRemoveOnBreakS` (1,800), `roomCloseNoEffortS` (1,800), `openShiftAdmitRequiresLeadOnlineS` (600), `tempVoteKick{minVotes: 3, minTenure: 5}`, `cleanupOrder{...}`, `serviceCall{durationS: 60, maxPerDay: 3}`, `loanerKit{maxVehiclesOut: 4}` | timers | rules |
| ★ `features.json` | `[{id, description}]` registry for `op: "flag"` (`overflow_former`, `smooth_handoff_rail_snap`, `golden_handshake_credit`, `auto_relocate`, `work_front`, `flock_formations`, `carryall_convoy`, `straggler_priority`, `punch_list_sweep`, `final_walkthrough`, `closing_bonus`, `remote_assay`, `punch_list`, `core_samples`) | — | ids |
| `pacing-targets.json` | `[{id, players, attendanceFrac, policy, metric: "time" \| "gapMax" \| "gapMedian" \| "share", min, max, unit, toleranceFrac}]` (§18 rows, MVP rows in scope-tiers §1) | tolerances only | targets (owner) |

**Tuning rule.** A balance agent may change any "may tune" field, re-run `tools/balance-sim`, and must keep every row of `pacing-targets.json` green. Changing a "locked" field needs a designer note in `docs/design/progression-and-economy.md` and owner approval.

## 22. Balance-sim specification (`tools/balance-sim`)

**Purpose.** A deterministic, headless pacing simulator that reads the real `packages/game-data` tables through `@moon-cleanup/game-data`, so code and design can never disagree. It produces time-to-unlock curves for 1, 2, 4, 8 and 16 players (and uneven attendance), asserts `pacing-targets.json`, and hunts for exploits. Owned by game-designer; run by the `balance-check` skill and in CI on any change to `packages/game-data`. Everything §17/§18 needs is below; nothing else is assumed.

### 22.1 Clock and state

- Event-stepped in **10-s ticks of contract-active time** (time with A_eff > 0). It never simulates strokes: it uses rates.
- Sun: the contract starts at Boreal sunrise; lit when (t mod 3,600) < 1,800.
- State: wallet; owned items (with paid price and count index); Cell, payload and store levels; per-sell-point flows; Shine (Polished area); Review index and Brief progress; Docket clock; cumulative player area A since the current sell point.

### 22.2 Player cleaning

- **Phases.** (a) **Landing Apron** until its 6 plots are Stamped: area 61.4 m² per plot at 0.124 kg/m², 1 pass for every tool, trip d = 30 m, Stamp 50 LM per plot on completion. (b) **Outpost mix** (0.335 kg/m², §1.1 passes) until the player owns a vehicle with cruise ≥6 m/s (the Skiff). (c) **Moon mix** after that.
- **Hand tool area rate** = width × (1 + Broad Strokes + Master Stroke) × 2.2 × (1 + Cadence + Second Wind) × Lane Lock (1.15 if T4) × 0.75 ÷ passes(Depth + Scour + Master Stroke, phase mix) × (1 + Telescoping Pole).
- **Vehicle area rate** = width × (1 + 0.2·Wide Mouth) × (1 + 0.1·Master Stroke) × (1 + 0.25·Refit) × cruise × (1 + 0.08·Gear Ratio) × WideMouthSpeed (0.92 / 0.85 / 0.78) × 0.8 ÷ passes(Depth, phase mix). Payload = base × (1 + 0.4·Cargo Expander) × (1 + 0.25·Refit).
- **Mode** = the owned hand tool or vehicle with the highest net rate after duty and night.
- **Duty** = fill ÷ (fill + trip); fill = capacity ÷ (rate × kg/m²).
  - Hand trip before the Puck Former: 2·d ÷ 3.4 m/s + pour, d = 60 m + √(A ÷ π). After the Puck Former: 15 s + pour − 2 s per Puck Magnet level. With Overflow Former: 4 s. Pour = 6 s × (1 − Quick Pour) × (0.5 if Smooth Handoff).
  - Vehicle trip: 100 s × (1 − Fast Tip) × (1 − 0.06·Afterburner) × (1 − 0.03·Throttle Lock) × (0.8 if Smooth Handoff) × (0.95 if Second Wind).
- **Night factor** (player only): 1 − max(0, 0.30 − relief), relief = 0.05 × Crown Lamp level on foot or max(that, Running Lamps 0.10/0.20) in a vehicle; 1.0 with the Lowlight Visor.
- **Shift factor:** N × A_att × 1/(1 + c·(N − 1)); c = 0.05 until a Puck Former is owned, then 0.02; A_att = attendance fraction (1 for all policies except co-op-uneven).
- **Review Briefs:** in each Review interval the player spends 20 min in the best hand tool on Steep (sweep ×0.6 unless Sure Footing/Charge) before the threshold.

### 22.3 Robots

**Baseline override:** use fixed activity multiplier 1.0; ordinary material-value sale rules; no Review/Brief gates for
core purchases. Ignore conflicting Effort/On-Shift/Bulk Rate formulas below in reference baseline. Implement and validate
the revised balance policy before treating any old completion-time estimate as acceptance evidence.


- **Roost** output = Σ unit rate × uptime × (1 + 0.15·Keen Beak). Uptime = 0.64 (manual Re-site) or 0.70 (Auto-Relocate) + 0.08·Wide Wing + 0.02·Deep Crop, max 0.95. Each Re-site costs rail at 2 LM/m × 100 m average.
- **Albatross** output = count × 11 × (1 + 0.3·Keen Beak) × (1 + 0.2·Tailwind) × (0.90 + 0.02·Deep Crop, max 0.98).
- Both × **On-Shift Bonus** with A_eff = N × A_att (every simulated player is fully active, Effort 1). Unattended hours are not simulated (targets are contract-active hours).
- Above 97% Shine, Albatross × straggler factor 0.6 / 0.9 / 1.0 by Homing level.
- Robots use Moon-mix density (0.424 kg/m²); their rates are net (depth folded in).

### 22.4 Selling, throughput and income

- Flows (kg/h) by provenance: player (`full`), Roost (`full`, as Puck Stacks), Albatross (`bale`).
- **Throughput:** each sell point has capacity rails × 144 t/h (stacks/Bales) or 7.2 t/h (loose pucks); Bale Chutes are unlimited; Assay Counter 4 pour slots. Flow above capacity queues and is reported; the efficient policy adds one rail run (2 LM/m × 200 m) whenever a sell point passes 80%.
- **Routing:** Kilns take Bale dust first, then other dust; Tile Sinterers take Beads + dust up to capacity; the rest sells raw (full rate or Bulk Rate by provenance).
- **Income** = Σ sales × payout multiplier + Stamps + Settle + Docket + collectibles (per policy). Stamps: player area × 0.85 counts as Polished (credited to the player) and robot area × 1.0 (Flock), with Stamp Premium, Golden Handshake and Closing Bonus rules.
- **Machines:** throughput by Grade × power supply fraction; power bought with the machine at 1,050 LM/kW of load.
- **Costs bundled:** Nest per 3 Albatross; power per machine Grade; rail allowances; Puck Former kit 400; Motor Pool 1,000 with the first vehicle; Assembly Gun before the first build piece.
- **Shine:** Polished area += (0.85 × player area + robot area) × dt. Reviews fire when the threshold and Brief are both met; they apply free issue, permits and unlocks (no cash).
- **Docket:** from Probation passed, every 1,800 s; efficient completes 2 goals (+1 income-minute from the §16.1 table), explorer 3 (+2.5).
- **Collectibles:** efficient collects the 6 Boreal Near Parcels at 15/25/32/40/48/55 min (60 s each, 30 LM); explorer adds every collectible on a route; others none. Induction pays XP only.

### 22.5 Purchases

1. **Scripted opening** (mirrors the Induction and Probation checklists): Squeegee → Squeegee Cell I → Bristle → Bristle Cell I → Clip Light → Holster I → Assembly Gun → Puck Former kit → Lane Broom → Motor Pool + Trundle → Static Rake → Broad Strokes I → Roost ×3 → Skiff → Bead Kiln → Bulldust.
2. **Greedy** afterwards. For every candidate the shift may buy now (unlocked, under permit, prerequisites bundled into its cost):
   - Δincome = income(with item) − income(now), from this model at the current tick (items that only change Shine use Δincome = ΔPolished m²/s × 0.69 LM/m²).
   - score = max(0, cost − wallet) ÷ income + cost ÷ Δincome (hours).
   - Pick the lowest score; tie-break by lower cost, then by data-file order. Buy when affordable; recompute every tick.
3. **Non-rate items** (Δincome = 0): Hop Pack, Ballast Soles, Loft, Strong Arm, Holster above L1, old-tool Cells, Monument, cosmetics. Bought when wallet ≥ 6× cost (≥ 3× after 4 h); Monument and cosmetics never. **Crown Lamp, Lowlight Visor and Running Lamps are income items** (they change the night factor) and go through the greedy score (review m10).
4. Homing, Final Walkthrough helpers: bought on unlock when wallet ≥ cost.
5. Personal purchases scale by §19.4 for the player count.

Other policies: **casual** (skill 0.7 on all rates, buys in list order, Rake before Trundle), **explorer** (collectibles + all Docket goals), **benefits** (all Benefits), **co-op-uneven** (N members, attendance f each), **mvp** (scope-tiers §1 content only: no Puck Former, rails or Assembly Gun; Motor Pool pre-built; Roost gated by the Pilot Review).

**Monte Carlo.** `--runs 200 --seed n` jitters skill (0.7–1.1), crowding and uptimes ±10%, and reports P10 / P50 / P90 for every milestone.

### 22.6 Outputs

- `tools/balance-sim/out/report.md`: milestone table per player count (like §18.1), cadence gaps (P50/max), share metrics, throughput report, income and area curves, a spend-by-category table, pass/fail per pacing target, and the **diff against `golden/v2-targets.csv`**.
- `out/curves.csv`: per-tick time, players, wallet, income, player area, Roost area, Albatross area, Shine.
- `out/purchases.csv`.

### 22.7 Exploit hunts (each is a failing test if it triggers)

- Reclaim/Place refund loops yielding LM, including on escalating-price and free items (refund = paid price).
- Settle used as a cleaning tool: Place/Reclaim cycles must clear ≤ the builder's own tool rate and pay ≤ Bulk Rate.
- Relay or Recall fee abuse.
- Bulk Rate arbitrage: any path that turns `bale` dust into full-rate raw sales.
- Remote Assay value above 90%.
- Repeat Requisition chains via leave/rejoin.
- On-Shift Bonus: N idle-tapping alts must add < ×1.1; N alts on one subnet add 0 above ×1.0; a second tab of the same account adds 0; driving over Polished ground gives Effort 0.
- Docket: Clock Out/In must not reroll; more players must not raise the reward; reward must not depend on recent income.
- Trick payouts above the per-driver or per-shift cap; passengers earning.
- Loose pucks above the caps.
- Review/Fulfilled rewards to members below the participation threshold.

**CLI.** `pnpm --filter balance-sim start -- --players 1,2,4,8,16 --policy efficient --runs 1` (default). `--assert` exits non-zero on any red target.

**Acceptance (review B5).** The first implementation (1) implements this spec, (2) serialises §17/§18.1 into `golden/v2-targets.csv`, (3) publishes its own results and the diff, and (4) the designer reconciles §17/§18 to the sim in the same PR, or explains each row that differs by more than 5%. Tuning starts only after that. Every later tuning PR attaches the regenerated report.

## 23. Tuning notes and risks

- **Edges:** first Roost (2.0 h), first production (3.5 h) and first Albatross (5.9 h) sit at the upper edge of their windows. Levers: Kiln price −20%, Trundle 1,500, or first Albatross 180,000.
- **Solo 31.1 h** sits in the lower half of 30–35 h. If Monte Carlo P10 falls below 30 h, cut the Docket goal reward to 0.35 income-minutes first.
- **Purchase gaps:** if the sim shows a solo gap >90 min, split the two largest Flight Plan levels (Keen Beak V, Tailwind III) into two half-steps each.
- **The On-Shift Bonus is the main co-op lever and the solo agency lever.** If 16-player playtests feel robot-dominated, lower `coefficient` and raise Flock Permits per Review instead (bounded by the hard cap). If solo players feel punished, raise `unattendedMult` toward 0.7 (this shrinks the player-attributable share; keep ≥20%).
- **The subnet cap** will cost some households their robot bonus. Watch support reports; the fallback is a cap of 1.5 per subnet with Tenure ≥10 for the second account.
- **The Bulk Rate must be explained early.** DOT tip on the first Bale sale: "Unprocessed Bales pay Bulk Rate. Kilns pay better." Clear UI: Nest panel shows "Raw 1.25 LM/kg · as Beads 16 LM/kg".
- **Re-site chores** are now one click plus a DOT prompt, and Auto-Relocate is a 15,000 LM Start item; playtests should still measure how often players re-site.
- **Server load:** at most 24 Albatross, each clearing a plot every 2–28 s, plus 24 Roosts. That is ≤15 plot updates/s worst case, well inside the 20 Hz sim budget. Loose pucks are capped at 200 per contract.

## Appendix A. Constants that live in prose until data lands (review M18)

| Constant | Value | Goes to |
| --- | --- | --- |
| Steep sweep-walk multiplier | 0.6 (1.0 with Sure Footing or Charge) | `world.json`, `traits.json` |
| Vehicle slope behaviour | Vehicles can't enter Steep (>25°); no other climb stat (Gear Ratio is speed only) | `vehicles.json` |
| Running Lamps night relief | 0.10 / 0.20 | `vehicle-upgrades.json` |
| Spot Check range | 300 m (Finisher Certification: 600 m) | `meta.json` / UI config |
| Work Front radius, minimum Effort | 800 m, 0.5 | `robots.json` |
| Re-site range, downtime | 600 m, 60 s | `robots.json` |
| Settle pay fraction | 0.25 (Bulk Rate) | `economy.json` |
| Pour slots per Assay Counter | 4 | `logistics.json` |
| Docket goal types and amount formulas | §16.1 | `shift-docket.json` |
| AFK and moderation timers | On Break 600 s; Temp removal 1,800 s On Break; room close 1,800 s without Effort; Open Shift admits Temps only if a Holder or Supervisor was online in the last 600 s | `moderation.json` |
| Clean-up Order | Holder/Supervisor flags a plot; the nearest Albatross takes it next. Before any Albatross exists: a **Brightside Service Call** clears the flagged plot in 60 s, unpaid (no LM, no Stamp), max 3 per contract per real day | `moderation.json` |
| Loaner Kit | Temps get, free and non-upgradable, the best tool tier any member owns and (from the Trundle) the shift's best vehicle tier below the Behemoth; returned on leave; max 4 loaner vehicles out | `moderation.json`, `economy.json` |
| Contract start | Boreal sunrise | `world.json` |

## Appendix B. Early-game derivation (re-verified by hand, 2026-11-12)

| Item | Outpost-mix value |
| --- | --- |
| Desk Duster on the Apron | 0.2475 m²/s; 7.6 kg per plot; 4-kg Cell → 2 trips × 23.6 s; 248 s sweeping → first Stamp 5.9 min incl. 60 s of prompts |
| Squeegee Cell I fill (outpost mix) | 14 kg ÷ (0.4125 m²/s × 0.335) = 101 s (8 kg base: 58 s — v1 said 46 s using Moon density) |
| Bristle + Cell I | 0.728 m²/s; 108 s fill; trip 45–50 s; duty ≈0.70; 0.51 m²/s; 3,300 LM/h lit / 2,700 dark |
| Bristle + Cell I + Puck Former | trip 21 s; duty 0.84; 0.61 m²/s; 4,000 LM/h |
| Lane Broom (locked) + Puck Former | 1.395 m²/s; 30 kg fill 64 s; duty 0.75; 1.05 m²/s; 6,800 LM/h lit |
| Trundle | 3.49 m²/s; 200 kg fill 171 s; trip 100 s; 2.20 m²/s; 14,300 LM/h lit / 11,900 dark |
| Purchase times | Stamp 5.9 · Squeegee 5.9 · Cell 8.5 · Bristle 17 · Bristle Cell 19 · Clip Light 22 · Holster 24 · Assembly Gun 42 · Puck Former 49 · Lane Broom 64 · Trundle 89 · Static Rake 94 · Broad Strokes I 99 · Roost 121 min |

**v1 → v2 errata (review m1):** vehicle max-out multiple 6.30× (Behemoth 756,000, not 762,000); the 10:00 row is **7** Albatross (90.1 = 7 × 11 × 1.3 × 0.9); the v1 night-averaged Desk Duster income was 900 × (0.5 + 0.5 × 0.7) = **765** LM/h, not 735; the Whisk-tier 8-kg fill is ≈58 s in the outpost mix, not 46 s; the Trundle step double-counted the Dump Plate (2,800, not 3,000); §18.3 mixed raw and 0.85-factored rates.
