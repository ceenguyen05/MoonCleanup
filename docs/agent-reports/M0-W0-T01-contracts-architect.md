# M0-W0-T01 — Contracts v0 in packages/shared (contracts-architect)
Status: complete (ready for lead review)
Date: 2026-11-12

## What changed
- All 13 module-boundaries §2 folders filled with versioned contracts (`@contract <path> v0` + `@consumers` header on
  every file), one sub-barrel each, root barrel `src/index.ts`. `.gitkeep` removed from all filled folders.
- New this session: `events`, `client`, `api`, `save`, placeholders `sim`, `world`, `ui`, `audio`, `config`, root
  barrel, header/barrel tests. Earlier: `ids`, `units`, `protocol`, `render`.

## Exports (root `@moon-cleanup/shared`)
- ids: `Brand`, `PlayerId`, `ContractId`, `PlotId`, `EntityId` (types).
- units: `Metres`, `Seconds`, `Milliseconds`, `Kilograms`, `Lumens`, `Hertz`, `Tick` (types).
- protocol: `PROTOCOL_VERSION` (0), `Channel`, `CHANNELS`, `Direction`, `DIRECTIONS`, `MessageStatus`,
  `BYTES_ID_RANGES`, `MESSAGE_CATALOG` (+ `MessageName`, `BytesMessageName`, `ControlMessageName`, defs), `CloseCode`,
  `CLOSE_CODE_RANGE`, `BuildIdSchema`, `ProtocolVersionSchema`, `JoinOptionsSchema`, `ProtocolMismatchInfoSchema`,
  `HelloPayloadSchema`, `PingPayloadSchema`, `PongPayloadSchema`, `PAYLOAD_SCHEMAS`, PING/PONG sizes and rates,
  `CLOSE_REASON_MAX_BYTES`, `BUILD_ID_MAX_LENGTH`, `GoldenVector`, `PING_GOLDEN_VECTORS`, `PONG_GOLDEN_VECTORS`.
- render: `RENDER_BACKENDS`, `HARDWARE_TIERS`, `QUALITY_PRESET_IDS`, `QUALITY_PRESETS`, `QualitySettingsSchema` and
  its part schemas/types.
- events: `EventBus<M>`, `EventBusListener`, `Unsubscribe`, `EventMap`, `EventName`, `EVENT_NAMES`
  (`net.status`, `render.backendSelected`, `quality.changed`), `NET_CONNECTION_STATES`
  (asleep, waking, connecting, connected, lost), `NetStatusEvent`, `RenderBackendSelectedEvent`,
  `QualityChangedEvent`, `QUALITY_CHANGE_SOURCES`.
- client: `ClientModule<S>`, `ModuleContext<S>`, `FrameInfo`, `ViewportSize`, `CLIENT_MODULE_IDS` (fixed order),
  `ServiceTypes`, `ServiceKey`, `SERVICE_KEYS` (renderer, sceneRoots, eventBus, uiStore, input, netSession, sim,
  assetLoader, quality), `ServiceRegistry<S>`, `ServiceBrand`, `OpaqueService`, `RendererService`, `QualityService`,
  opaque `SceneRootsService`, `InputService`, `NetSessionService`, `SimService`, `AssetLoaderService`.
- ui: `UiState`, `UiSessionState`, `UiAction` (`session.set`), `UiStore` (getState/subscribe/dispatch),
  `INITIAL_UI_STATE`, `UI_FLUSH_MAX_HZ` (15).
- api: `HttpRouteDef`, `HttpRequest`, `HttpResponse`, `HTTP_METHODS`, `HealthResponseSchema`, `ReadyResponseSchema`,
  `EnvNameSchema`/`ENV_NAMES`, `StorageStateSchema`/`STORAGE_STATES`, `ApiErrorBodySchema`, `API_ERROR_CODES`.
- save: `SAVE_FORMAT_VERSION` (0), `SAVE_MAGIC`, `SAVE_HEADER_LAYOUT`, `SAVE_HEADER_FIXED_BYTES` (58),
  `SAVE_SECTION_ENTRY_BYTES`, `SAVE_TRAILER_BYTES`, `BAKE_HASH_BYTES`, `SAVE_SECTION_ID` (META..PUCKS = 1..8),
  `SaveHeaderSchema`, `SaveSectionEntrySchema`, `SAVE_SLOTS`, codecs, size limits, `DUST_CHUNK_VERSIONS`,
  `SAVE_HEADER_GOLDEN_VECTORS`.
- placeholders: sim `RoomSim`, `SimInputCommand`, `RoomSimSnapshot`, `RoomSimEvent`, `ActorSlot`,
  `MAX_PLAYERS_PER_ROOM`; world `PlotGrid`, `PlotState` (2-bit codes), `STANDARD_GRID_M`, `STANDARD_PLOT_COUNT`,
  `STANDARD_MOON_RADIUS_M`, `CHUNK_EDGE_PLOTS`, `POLE_CHUNK_ID`, `CHUNK_COUNT`; audio `AudioCueId`,
  `AudioCueParams`, `AUDIO_CUE_IDS` (empty); config `GAME_DATA_SCHEMA_VERSION`, `GameDataIdSchema`,
  `FeatureIdSchema`, `EffectSchema`, `GAME_DATA_TABLES` (23 baseline files; no optional §24 tables, no gate fields).

## Contract decisions to note
- Save envelope: added `sectionCount` u16 at offset 56 (data-model §6 implies but does not size it); section ids
  META..PUCKS = 1..8, 0 reserved; bodies contiguous after the table; CRC32 IEEE trailer. Pinned by a golden vector.
- `STORAGE_STATES` ok/warn/full/emergency map to data-model §4 thresholds 700/800/900 MB (only `full` is named there).
- Opaque services use `object & ServiceBrand<Name>` so concrete client classes assign without casts; the client
  narrows via `interface ClientServices extends ServiceTypes { ... }`.

## Consumers to update
- None break (first version). M0 consumers: client/render (events, quality, client), client/net + server/net
  (protocol, api `HttpRouteDef`, `net.status`), server/api (Health/Ready), client/ui (ui store, `net.status`),
  client/app (registry, module order). M1-W0-T03 extends events/ui/audio/config; M1 adds sim/world/api DTOs.

## Tests run
- `pnpm exec tsc -p packages/shared/tsconfig.json`: exit 0.
- `pnpm exec vitest run --root packages/shared`: 13 files, 124 tests pass.
- `pnpm exec eslint packages/shared/src`: exit 0; `prettier --check packages/shared/src`: clean.

## Open issues & risks
- `package.json` scripts are still placeholders (T03 owns them).
- Header test uses Vite `import.meta.glob` (typed locally in the test) to avoid Node APIs.

## Dependencies requested
- none

## Config schemas (config contract v0 -> v1, additive; GAME_DATA_SCHEMA_VERSION stays 1)
Date: 2026-11-12. Source: progression-and-economy.md §21, reference mode (no on-shift-bonus/flight-plan/
performance-reviews/meta/shift-docket; no gate, `bulkRateFrac`, `uptimeAutoFrac`, `workFront`, `byReview`, `refit`,
`closingBonusMult`, `coreSamples`, `tenureXp`, `commendations`, `roomCloseNoEffortS`, `minTenure` fields; strict objects
reject them).

Each file is `{ "schemaVersion": 1, ... }`; array tables wrap the list in the named key.

| Table file (`packages/game-data/data/`) | Schema / type | Array key, id prefix |
| --- | --- | --- |
| world.json | `WorldSchema` / `WorldTable` | terrainClasses `terrain.` |
| economy.json | `EconomySchema` / `EconomyTable` | materials `material.`, tricks `trick.` |
| movement.json | `MovementSchema` / `MovementTable` | — |
| tools.json | `ToolsSchema` / `ToolsTable` | `tools` `tool.` (tier 0 = Assembly Gun, traitId null) |
| traits.json | `TraitsSchema` / `TraitsTable` | `traits` `trait.` |
| dust-cells.json | `DustCellsSchema` / `DustCellsTable` | costsLm keyed by tool id |
| promotions-board.json | `PromotionsBoardSchema` / `PromotionsBoardTable` | nodes `node.`, departments `department.` |
| suit-gear.json | `SuitGearSchema` / `SuitGearTable` | lines `gear.` |
| vehicles.json | `VehiclesSchema` / `VehiclesTable` | `vehicles` `vehicle.`, motorPoolParts `piece.` |
| vehicle-upgrades.json | `VehicleUpgradesSchema` / `VehicleUpgradesTable` | lines `vehicle_upgrade.` |
| robots.json | `RobotsSchema` / `RobotsTable` | units `robot.`; states = all 9 `ROBOT_STATE_IDS` |
| caps.json | `CapsSchema` / `CapsTable` | hard caps <= 48 robots / 14 machines |
| logistics.json | `LogisticsSchema` / `LogisticsTable` | pieces `piece.` |
| production.json | `ProductionSchema` / `ProductionTable` | machines `piece.`, exactly 1 grade |
| power.json | `PowerSchema` / `PowerTable` | pieces `piece.` |
| build-pieces.json | `BuildPiecesSchema` / `BuildPiecesTable` | pieces `piece.`, finishes `finish.` |
| plot-bonus.json | `PlotBonusSchema` / `PlotBonusTable` | — |
| collectibles.json | `CollectiblesSchema` / `CollectiblesTable` | surveyPoints `survey.` |
| onboarding.json | `OnboardingSchema` / `OnboardingTable` | induction/probation `onboarding.` |
| achievements.json | `AchievementsSchema` / `AchievementsTable` | `achievements` `achievement.` |
| moderation.json | `ModerationSchema` / `ModerationTable` | — |
| features.json | `FeaturesSchema` / `FeaturesTable` | `features` (snake id; `BASELINE_FEATURE_IDS`) |
| pacing-targets.json | `PacingTargetsSchema` / `PacingTargetsTable` | `targets` `pacing.`; players 1..MAX_PLAYERS_PER_ROOM (6) |

- Whole set: `GAME_DATA_TABLE_SCHEMAS` (table -> schema, = `GAME_DATA_TABLES`) and `GameDataBundleSchema` /
  `GameDataBundle` (cross-table refs: traits, cell costs per cleaning tool, upgrade lines, recipe materials, flag
  features, every `piece.*` in vehicles/logistics/production/power exists in build-pieces at the same price, Bale
  acceptors, probation `suggestsId`, equal stampBaseLm/puckKg/stackMaxKg/baleKg across tables).
- common v1 additions: `GAME_DATA_ID_PREFIXES`, `prefixedId`, `uniqueIdArray`, `uniqueStringArray`, `TokenSchema`,
  `StatIdSchema`, number schemas (`FracSchema`, `MultSchema`, `LmAmountSchema` = whole LM, ...), `ParamsSchema`
  (open `{...}` fields), `CostLevelSchema`. Effect schemas are now strict (extra keys rejected).
- Consumers: packages/game-data (author tables, parse with `GameDataBundleSchema`); sim/balance-sim read typed tables.
  Nothing else breaks.
- Evidence: `tsc -p packages/shared` exit 0; vitest 14 files / 227 tests pass; eslint + prettier clean.

## Contract v1.1 (additive; 2026-11-12) and v1.2 (required fields; 2026-11-12)

**v1.2 (follow-up wave, done).** packages/game-data now supplies every v1.1 field, so these are now required:
`robots.albatross.rateM2ps`, `economy.trickComboMult`, `logistics.assayCounter.pourS`,
`logistics.fieldGate.baleChuteFaces`, `movement.carryUnits` and pacing-targets `targets[].milestone`.
`units[].upgradePriceLm` and the vehicle `flatbed` (Carryall) stay optional. The logistics Field Gate Bale-acceptor
rule now always applies, because `baleChuteFaces` is always present.
- Headers bumped to v1.2: common, robots, economy, movement, logistics, pacing-targets and bundle. vehicles,
  traits and promotions-board stay at v1.1.
- `GAME_DATA_SCHEMA_VERSION` stays 1. This breaks data shape only and the single data source already complies.
  `PROTOCOL_VERSION` and `SAVE_FORMAT_VERSION` do not change.
- Tests: the old "v1-shaped data still parses" test becomes "data without the still-optional fields parses". A new
  test checks that each now-required field is rejected when missing. The type tests now expect these fields to be
  non-optional.
- Consumers: game-data needs no change to compile or pass. Optional cleanup: `src/game-data.test.ts:183`
  `data.logistics.assayCounter.pourS ?? 6` can drop the `?? 6` fallback, which is now dead code (eslint does not flag
  it). sim and balance-sim can read these fields without undefined checks.
- Evidence (Node 26.13.1 via fnm default):
  - shared: `tsc -p packages/shared/tsconfig.json` exit 0; vitest 14 files / 239 tests pass; eslint and
    prettier --check on packages/shared are clean.
  - game-data: `tsc -p packages/game-data` exit 0; `pnpm --filter @moon-cleanup/game-data test` 41 pass; eslint
    clean.
- Files: `packages/shared/src/config/{common,robots,economy,movement,logistics,pacing-targets,bundle}.schema.ts` and
  `bundle.schema.test.ts`.

The original v1.1 notes follow.

Source: `docs/agent-reports/M1-game-data-tables.md` contract requests 1-7, plus the `/readyz` proposal in
`M0-W1-T02-T03-backend.md`. Headers go from `v1` to `v1.1` (`api/rest` goes from `v0` to `v0.1`). The header test
now accepts `v<major>.<minor>`. `GAME_DATA_SCHEMA_VERSION` stays 1. `PROTOCOL_VERSION` and `SAVE_FORMAT_VERSION` do
not change. Existing data and server code compile and parse unchanged.

| # | Change (file) |
|---|---|
| 1 | robots: optional `units[].upgradePriceLm` and `albatross.rateM2ps`. |
| 2 | economy: optional `trickComboMult`. logistics: optional `assayCounter.pourS` and `fieldGate.baleChuteFaces`. vehicles: optional `flatbed{pucks,stacks,bales}` (`FlatbedSchema`). movement: optional `carryUnits`. |
| 3 | promotions-board: a `prereqs` entry is `{nodeId, level}` or `{anyOf:[{nodeId,level}, ...≥2]}`. Every entry is required; an `anyOf` entry is met by any one alternative. Each alternative is checked for existence and level, and counts as a cycle edge. New exports: `NodeLevelPrereqSchema`, `NodeAnyOfPrereqSchema`, `NodePrereq`. `NodePrereqSchema` is now the union. |
| 4 | common: effect semantics are documented. The highest owned level replaces the lower ones, so a `flag` must be repeated on each higher level. A stat is `((set ?? base) + Σadd) × Πmul`. At most one active `set` per stat. New export: `NUMERIC_EFFECT_OPS`. |
| 5 | bundle rules: each cleaning tool `tool.<x>` needs a node `node.dust_cell_<x>` whose level costs equal `costsLm`, and each such node needs a tool. `piece.roost`, `piece.nest` and `piece.field_gate` must exist at `roost.basePriceLm`, `nest.priceLm` and `fieldGate.priceLm`. `trait.charge` must exist, with `params.finishStampMult` equal to `chargeFinishMult`. New constants: `DUST_CELL_NODE_ID_PREFIX`, `ROOST_PIECE_ID`, `NEST_PIECE_ID`, `FIELD_GATE_PIECE_ID`, `CHARGE_TRAIT_ID`, `CHARGE_FINISH_STAMP_PARAM`. |
| 6 | logistics: the Receiving Gate accepts Bales when `gate.baleChuteFaces > 0` and is never listed in `baleAcceptors`. If `fieldGate.baleChuteFaces` is set, `piece.field_gate` must be in `baleAcceptors` exactly when that value is above 0. |
| 7 | pacing-targets: optional `milestone` token per row (§18.1 milestone; rows can share one). |
| R | api/rest: `ReadyResponseSchema` gains optional `schema` (string or null) and `dbState` (`DB_STATES` = up, powered-off, not-configured, error). New exports: `DbStateSchema`, `DbState`. |

**Consumers to migrate (next wave; nothing breaks today):**
- packages/game-data: move every `PENDING_CONTRACT_FIELDS` value into its JSON file, then delete `src/pending-fields.ts`.
  - Plover `upgradePriceLm: 10000`; `albatross.rateM2ps: 11`
  - `economy.trickComboMult: 1.5`
  - Carryall `flatbed: {pucks: 40, stacks: 8, bales: 2}`
  - `assayCounter.pourS: 6`; `fieldGate.baleChuteFaces: 1` (`piece.field_gate` is already in `baleAcceptors`)
  - `movement.carryUnits: 1`

  Also in game-data:
  - Replace Overflow Former's `dust_cell_desk_duster` level-3 prereq with `{anyOf: [all 6 node.dust_cell_* at level 3]}`.
  - Add a `milestone` to every pacing row.
  - Optionally drop the three "duplicated constants" tests, which the bundle schema now covers.
- apps/server `api/health.ts`: may drop its local `DbState` and the `ReadyBody` intersection in favour of the shared `DbState` / `ReadyResponse`. This is optional because the types are identical.
- sim / balance-sim (when written): read prereqs with the `anyOf` union and apply the effect semantics in item 4.
- Follow-up wave: once game-data has migrated, make `albatross.rateM2ps`, `trickComboMult`, `pourS`, `fieldGate.baleChuteFaces`, `carryUnits` and `milestone` required.

**Evidence (Node 26.13.1 via fnm default):**
- packages/shared: `tsc -p packages/shared/tsconfig.json` exit 0; `vitest run --root packages/shared` 14 files / 238 tests pass; `eslint .` exit 0; `prettier --check src` clean.
- Consumer check: `tsc -p packages/game-data` exit 0; game-data vitest 1 file / 39 pass. The real data already satisfies the new bundle rules.
- apps/server: api vitest 7 pass. `tsc -p apps/server` fails only with the pre-existing packages/db TS5097 `.ts`-extension errors, which are not from this change.

**Files:**
- `packages/shared/src/config/{common,robots,economy,movement,vehicles,logistics,traits,promotions-board,pacing-targets,bundle}.schema.ts`
- `config/{bundle,common}.schema.test.ts`
- `api/rest.ts`, `api/rest.test.ts`
- `index.test.ts` (header regex)

**api/rest v0.1.1 (2026-11-12):** `ENV_NAMES` drops `staging` (ADR-0029, main-only single production service); header regex now accepts `v<major>.<minor>.<patch>`; rest.test rejects `env: "staging"`; environments.md `ENV_NAME` row updated.

**api/rest v0.1.2 (2026-11-13, additive):** `API_ERROR_CODES` gains `AT_CAPACITY` (503 admission refusal); consumer apps/server/src/net/admission.ts (+ admission.test.ts) migrates from `ROOM_FULL` + `at_capacity:*`; `ROOM_FULL` stays valid.
