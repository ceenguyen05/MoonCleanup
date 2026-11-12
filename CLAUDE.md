# CLAUDE.md — Moon Cleanup

Browser real-time co-op (1–16 players) moon-cleaning game. Start with a comically tiny Desk Duster, clean a whole
2 km-radius moon (163,842 hex **plots**) with better tools, vehicles, robots and rail automation, solo or with friends.
Employer: **Brightside Facilities Co.**; dispatcher AI: **DOT**; currency: **Lumens (LM)**.
Owner: Cee (does ALL git). Builder: a Claude Fable lead + specialist subagents.

## Where things are decided (read the one you need, not all)
- Status right now → `docs/STATUS.md` (single source of truth; resume here)
- How the team works → `docs/handoff/AGENT_ORCHESTRATION.md` · git hand-off → `docs/handoff/WORKFLOW.md`
- Stack & versions → `docs/architecture/tech-stack.md` · ADRs → `docs/adr/`
- **Who owns which path** + contracts → `docs/architecture/module-boundaries.md`
- Game design → `docs/design/GDD.md`, `progression-and-economy.md`, `scope-tiers.md`
- Feel, motion, UI → `docs/design/game-feel-and-controls.md`, `animation-spec.md`, `ui-screens-and-flows.md`
- **Names** → `docs/design/naming-bible.md` (the only source of player-facing names)
- Visual bar → `docs/design/visual-target.md`, `art-direction.md` · budgets → `docs/architecture/performance-budgets.md`
- Netcode / data / security / envs → `docs/architecture/netcode.md`, `data-model.md`, `security.md`, `environments.md`
- World & dust (hardest system) → `docs/architecture/world-and-dust-simulation.md`; rendering → `rendering-pipeline.md`
- Roadmap & tasks → `docs/ROADMAP.md`, `docs/milestones/` · Questions for Cee → `docs/OPEN_QUESTIONS.md`

## Mechanics parity, original identity (non-negotiable)
- Systems, unlock order, progression structure and pacing deliberately mirror the genre reference (research in
  `docs/research/`). Every player-facing **name, model, texture, sound, UI layout, line of text and number table is ours**.
- Never use names from the "DO NOT USE" lists in `docs/research/moon-sweepers-mechanics.md` §8 and
  `docs/research/roblox-references.md` §9. Never download, trace or commit reference-game assets; link only.
- Look: "bright, readable stylized realism" — our own designs and palette, real lunar lighting cues.

## Visual quality bar (short)
Looking like a cheap browser game = failed task. PBR + HDR + AgX, single hard sun with filtered cascaded shadows, AO,
subtle bloom, starfield + Earth, convincing night (Crown Lamp / Lowlight Visor), regolith with visible grime that thins
as you clean, crisp sweep trails with raised berms, footprints/tracks, low-g ballistic dust. Locked 60 FPS Tier A
(RTX 4060 Laptop-class), 30+ FPS Tier B (iGPU), WebGL2 fallback works. UI crisp at DPR 1/1.5/2/3. Every visible change
gets native-resolution screenshots checked against `visual-target.md` IDs.

## Architecture in brief
- pnpm workspaces + Turborepo; TypeScript 6; Node 26 LTS; Vite 8. Packages `@moon-cleanup/*`:
  `shared` (contracts) · `protocol` (codecs, client session) · `sim` (pure-TS room simulation) · `world` (plot grid,
  terrain sampling, dust ledger) · `game-data` (balance tables) · `db` (Drizzle/Postgres) · `config` (tooling).
- `apps/client`: three.js **r187 WebGPURenderer + TSL** (auto WebGL2), React 19 + Motion DOM UI.
- `apps/server`: Colyseus 0.18 on uWebSockets; Schema for entities (encode-once), custom bytes for dust/strokes;
  **server is authoritative**, runs the shared kinematic sim (no physics engine), 20 Hz sim / 10 Hz snapshots on the
  free tier; checkpoints to Aiven PostgreSQL ≤ every 30 s and on SIGTERM.
- Hosting ($0): Vercel Hobby (static client) · Render Free (prod tracks `release`, staging tracks `main`) · Aiven PG Free.

## Coding standards
- Strict TS (`noUncheckedIndexedAccess`), ESM only, no `any` without a comment, no default exports in packages.
- `packages/sim|world|protocol|shared`: no DOM, no Node APIs, no three.js, no Colyseus; deterministic where possible.
- Import other packages only through their `index.ts`; respect the dependency direction in module-boundaries §1.
- three.js: only WebGPURenderer/TSL/node post (`RenderPipeline`); banned: `WebGLRenderer`, `EffectComposer`,
  GLSL `ShaderMaterial`, `renderAsync`. Keep draw calls within budget (BatchedMesh/instancing).
- Balance numbers live in `packages/game-data` (validated by zod schemas in `packages/shared/src/config`), never in code.
- Hot paths: no per-frame/per-tick allocations; reuse buffers.
- Comments explain *why*. Public functions get TSDoc.

## Commands
`pnpm dev` · `pnpm build` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm test:e2e` · `pnpm verify` (all gates)
Wave brief file `docs/handoff/waves/<M#-W#>.md` is written by `/plan-wave` before any launch.
Slash commands: `/plan-wave` `/launch-wave` `/integrate` `/review <taskID>` `/verify` `/visual-check` `/perf-check`
`/balance-check` `/bot-test` `/status` `/update-docs` `/release-checklist` `/commit-plan`.

## Testing rules
- Every package change ships unit tests (Vitest) next to the code. Sim/world/protocol need deterministic tests
  (fixed seeds, golden vectors). Netcode changes run under the network conditioner (latency/jitter/loss).
- Multiplayer changes must pass `/bot-test` (16 bots). Visual changes must pass `/visual-check`.
- CI gates are designed to pass on an empty repo; once code exists, red CI blocks the wave.

## Staged sessions (usage limits)
Work in **stages** sized to one 5-hour usage window (≤ 3 implementation agents + reviewers). Checkpoint after every
task (STATUS.md log line, incremental agent reports); resume cut-off agents with `SendMessage`; `/commit-plan` after
every wave. Full protocol: `docs/handoff/AGENT_ORCHESTRATION.md` §14.

## When decisions change
Write a new ADR (never edit an accepted one; supersede it), update `tech-stack.md`/the affected doc, log it in
`docs/STATUS.md`, and if it's Cee's call add it to `docs/OPEN_QUESTIONS.md` with a recommended default.

## NEVER
- Run git that changes state: commit, add/stage, branch, checkout/switch, stash, reset, rebase, merge, tag, init,
  remote, push/pull, worktree — or use `isolation: worktree`, `EnterWorktree`, `/batch`, agent teams. **Cee handles all git.**
- Commit or write secrets anywhere (only `.env.example` placeholders).
- Edit files owned by another agent in the same wave, or shared root files during a wave.
- Change shared contracts (`packages/shared`) outside the contracts process (only `contracts-architect` edits it).
- Bypass server authority (clients send inputs/intents, never outcomes).
- Add a dependency without an ADR, or install during a parallel wave. Only exception: M0-W0-T02
  (`devops-engineer`) performs the FIRST install; after that, installs happen only between waves by `devops-engineer`.
- Run git to test a git hook (never `git commit` as a test; use piped hook JSON).
- Reuse reference-game names, art, audio, text or assets.
- Mark a task done without reviewer sign-off (and Cee's commit).
- Ship blurry UI (no CSS-scaled canvases for text, no raster icons upscaled, respect devicePixelRatio).
