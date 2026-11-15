# M1-W3-T03 Detailing cleanup (contracts-architect)

**Status:** done.

**Consumer check:** `rg DETAILING_DIAMETER_MM` across the repo (excluding node_modules): only `packages/shared` imported it (dust.ts, dust.test.ts, bundle.schema.test.ts) plus agent-report prose. No consumer in packages/, apps/, tools/ or prototypes/.

**Changes (packages/shared/src only):**
- `world/dust.ts`: constant removed, replaced by a pointer comment to `DETAILING_DIAMETER_PARAM` / `traits.json`. Header bumped to `@contract world/dust v1.2` with a removal and migration note (no wire, hash or save change; `PROTOCOL_VERSION` and `SAVE_FORMAT_VERSION` unchanged).
- `world/dust.test.ts`: import and the `toBe(500)` assertion removed; test title no longer mentions the Detailing disc.
- `config/bundle.schema.test.ts`: import removed; the Detailing diameter assertion now expects the literal `0.5`.
- `config/movement.schema.ts` and `config/tool-feel.schema.ts`: `@consumers` comments now say sim reads `SimConfig.feel` / `SimConfig.toolFeel` (comment only, versions v1.3 / v1 unchanged).

**Evidence (Node 26.13.1 fnm prefix):** tsc `--noEmit` clean for shared, game-data and sim. vitest: shared 462/462, game-data 59/59, sim 23/23 (golden replay unchanged). Prettier clean on edited files.

**Affected consumers:** none need changes.

**Next (not mine, outside packages/shared):** `packages/game-data/src/game-data.test.ts` line 87 comment still says "held as MOVEMENT_FEEL / TOOL_FEEL"; the game-data owner can reword it to `config.feel` / `config.toolFeel`.
