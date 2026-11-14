# M0-adr-0031-local-first — contracts-architect

Task / status: ADR-0031 + doc amendments + contract proposal / in-review / 2026-11-13 / contracts-architect / Opus 5.5
Done: ADR written, related docs amended, contract changes proposed below. **`packages/shared` NOT edited.** These changes go into **M1-W0-T06** (or get folded into M1-W0-T01–T03).
Next: the lead reviews the ADR. M1-W0-T06 implements the sketches below. Lead-owned follow-ups are listed at the end.
Files: `docs/adr/0031-local-first-solo.md` (new); `docs/adr/README.md` (index row); `docs/adr/0025-*.md`, `0015-*.md` (status line notes "amended for Solo"); `docs/architecture/netcode.md` (header note, N1/N2, §15 capacity, new §19); `data-model.md` (§3.7 columns, new §3.7c, §3.11 kinds, §6 header + ownership, §7 row); `system-overview.md` (topology, routes, §2.2, §3 note, new §4.1); `module-boundaries.md` (§2 rows, §3 sim-host + adjusted owners, §4/§5); `milestones/M1-mvp.md` (note, E13–E15, rows W0-T06/W3-T08/W5-T07/W5-T08/W6-T07/W8-T07, cards). The wave files list no M1 tasks, so they are unchanged.
Evidence: docs only. No code. Nothing was run.
Blockers: none.
Commit suggestion: `docs(adr): ADR-0031 local-first solo; amend netcode/data-model/system-overview/module-boundaries/M1`

## Proposed contract changes (M1-W0-T06)

### 1. `client/room-host.ts` (new, v1). It uses no DOM, Worker or Colyseus types.

```ts
// @contract client/room-host v1  @consumers apps/client/src/{sim-host (LocalRoomHost), net (RemoteRoomHost), gameplay, terrain, ui, debug, app}
export const ROOM_HOST_KINDS = ["local", "remote"] as const;
export type RoomHostKind = (typeof ROOM_HOST_KINDS)[number];
export const ROOM_HOST_STATES = ["booting", "loading", "running", "paused", "suspended", "closed", "failed"] as const;
export type RoomHostState = (typeof ROOM_HOST_STATES)[number];
export const ROOM_HOST_CLOSE_REASONS = ["clock_out", "open_to_friends", "return_to_solo", "conflict_resolved", "error"] as const;

/** One frame in the packages/protocol FRAME layout; the buffer is pooled and valid until release(). */
export interface RoomHostFrame { readonly tick: Tick; readonly ackInputSeq: number; readonly bytes: ArrayBuffer; readonly byteLength: number; release(): void; }
/** Low-rate shared state (wallet, upgrades, roster, beacons), plain readonly data, delivered only on change. */
export interface ShiftStateView { readonly tick: Tick; readonly shiftType: ShiftType; readonly walletLumens: Lumens; /* … mirrors netcode §4.4 ShiftState */ }

interface RoomHostBase {
  readonly kind: RoomHostKind; readonly contractId: ContractId; readonly simTickHz: number; readonly state: RoomHostState;
  sendInput(cmd: SimInputCommand): void;        // copies into a pooled buffer; never allocates
  sendIntent(intent: ControlIntent): void;      // purchases/builds; rare
  onFrame(l: (f: RoomHostFrame) => void): Unsubscribe;
  onShiftState(l: (s: ShiftStateView) => void): Unsubscribe;
  onEvent(l: (e: RoomSimEvent) => void): Unsubscribe;
  onStateChange(l: (s: RoomHostState) => void): Unsubscribe;
  close(reason: RoomHostCloseReason): Promise<void>;
}
export interface LocalRoomHost extends RoomHostBase {
  readonly kind: "local";
  readonly generation: number;                  // newest local save generation
  checkpoint(reason: "timer" | "hidden" | "pause" | "clock_out" | "handoff"): Promise<LocalCheckpointMeta>;
  pause(): void; resume(): void;
}
export interface RemoteRoomHost extends RoomHostBase { readonly kind: "remote"; readonly roomId: string; readonly rttMs: number; }
export type RoomHost = LocalRoomHost | RemoteRoomHost;
export interface LocalCheckpointMeta { readonly contractId: ContractId; readonly generation: number; readonly parentGeneration: number; readonly simTick: Tick; readonly savedAtMs: number; readonly bytes: number; }
```
Service registry key: `roomHost`. Worker message envelopes stay private to `apps/client/src/sim-host` because they have a single owner.

### 2. `save/format.ts` (part of the v1 bump, so no extra version bump)
The fixed header grows from 58 to 92 bytes: `48 simTick u64 · 56 generation u64 · 64 parentGeneration u64 · 72 originKind u8 (0 room, 1 solo) · 73 reserved u8 = 0 · 74 originId 16 B · 90 sectionCount u16`. `SAVE_HEADER_FIXED_BYTES = 92`. Add `SAVE_ORIGIN_KINDS = ["room","solo"]`. Extend `SaveHeaderSchema` with `generation: z.int().min(1)`, `parentGeneration: z.int().min(0)`, `originKind`, `originId` (32 hex chars). Add the refinement `generation > parentGeneration`. Update the golden vectors. Migration v0→v1: `generation = save_seq`, `parentGeneration = save_seq − 1`, `originKind = room`, `originId` = 16 zero bytes. No v0 save has ever been persisted.

### 3. `save/checkpoint-package.ts` (new): the `MCCK` package used for upload and download
Little-endian layout: `magic "MCCK" · version u16 · contractId 16 B · generation u64 · baseGeneration u64 · headerLen u32 · header (gzip envelope) · chunkCount u16 · per chunk { chunkId u16 (0–640), ver u8, rawSize u32, crc32 u32, len u32, deflate bytes } · trailer CRC32`. Constants: `CHECKPOINT_PART_MAX_BYTES = 1 MiB`, `CHECKPOINT_SESSION_MAX_BYTES = 4 MiB`. Golden vectors required.

### 4. `api/rest.ts` (additive, v0.2.0)
```ts
export const SoloCheckpointSummarySchema = z.object({ generation: z.int().min(0), parentGeneration: z.int().min(0), originKind: z.enum(["room","solo"]),
  savedAt: z.iso.datetime(), simTick: z.int().min(0), playtimeS: z.int().min(0), shinePolished: z.int().min(0), walletLumens: z.number().min(0),
  saveFormatVersion: U16, gameDataVersion: z.string().max(32), deviceLabel: z.string().max(40).optional() });
export const ProfileDeltaSchema = z.object({ playtimeS: z.int().min(0), tenurePoints: z.int().min(0), commendations: z.int().min(0),
  achievementIds: z.array(z.string().max(64)).max(32) });
export const SoloCheckpointBeginRequestSchema = z.object({ contractId: ContractIdSchema, generation: z.int().min(1), parentGeneration: z.int().min(0),
  baseGeneration: z.int().min(0), saveFormatVersion: U16, gameDataVersion: z.string().max(32), bakeHash: z.string().regex(/^[0-9a-f]{64}$/),
  totalBytes: z.int().min(1).max(4 * 1024 * 1024), partCount: z.int().min(1).max(4), packageCrc32: U32,
  summary: SoloCheckpointSummarySchema, profileDelta: ProfileDeltaSchema, deviceId: z.uuid(), overwrite: z.boolean().default(false) });
// Single request (<= 1 MiB): POST /v1/contracts/:id/solo-checkpoints (multipart: JSON meta + octet-stream MCCK).
// Larger: the same POST with partCount > 1 returns { uploadId, partMaxBytes }; then PUT …/:uploadId/parts/:n and POST …/:uploadId/commit.
export const SoloCheckpointBeginResponseSchema = z.object({ uploadId: z.uuid(), partMaxBytes: z.int(), expiresInS: z.int() });
export const SoloCheckpointAcceptedSchema = z.object({ acceptedGeneration: z.int().min(1), savedAt: z.iso.datetime(),
  flags: z.array(z.enum(["solo_implausible","profile_delta_capped"])) });
export const SAVE_CONFLICT_BODY = z.object({ error: z.literal("SAVE_CONFLICT"), server: SoloCheckpointSummarySchema });
export const CHECKPOINT_REJECT_REASONS = ["bad_crc","bad_envelope","format_too_new","game_data_unknown","bake_mismatch","size_limit",
  "chunk_id_out_of_range","generation_not_increasing","contract_not_solo","not_holder"] as const;
export const SaveHeadResponseSchema = SoloCheckpointSummarySchema;   // GET /v1/contracts/:id/save/head
// GET /v1/contracts/:id/save?page=n -> octet-stream MCCK pages (<= 1 MiB each), header `x-save-pages`.
// CreateContractRequest gains `clientContractId?: uuid` (UUIDv7) and `seed?: bigint-as-string` for contracts first created locally.
```
Add to `API_ERROR_CODES`: `SAVE_CONFLICT` (409), `CHECKPOINT_REJECTED` (422, `reason` in the body), `SAVE_VERSION_UNSUPPORTED` (409), `PAYLOAD_TOO_LARGE` (413). Add constants `SOLO_UPLOAD_MIN_INTERVAL_S = 20`, `SOLO_UPLOADS_PER_HOUR_MAX = 60`, `SOLO_UPLOAD_INTERVAL_S = 120`, `SOLO_LOCAL_CHECKPOINT_INTERVAL_S = 10`.

### 5. `ui/store.ts` and `events/catalog.ts` (additive)
```ts
export const SAVE_SYNC_STATES = ["local_only","synced","pending","uploading","offline","conflict","error"] as const;
export interface SaveSyncSlice { state: SaveSyncState; lastSyncedAtMs: number | null; pendingSinceMs: number | null;
  conflict: { local: SoloCheckpointSummary; server: SoloCheckpointSummary } | null; backupAvailable: boolean; }
// action: resolveSaveConflict(choice: "keep_local" | "use_server"); restoreBackup()
// events: save.checkpointed {generation}, save.synced {generation}, save.conflict {local, server}, save.restored {generation, source}
```

### Conflict prompt rule (normative text for T06 doc comments)
The server accepts an upload only if its newest generation equals `baseGeneration` (fast-forward). A copy that strictly descends from the other wins silently. On divergence the client sets `saveSync.conflict` and shows "Which copy?" with no default choice. *Keep this device* re-uploads with `overwrite: true`, `baseGeneration` set to the server generation and `generation` = max + 1. *Use the server copy* downloads it. In both cases the losing copy goes to the local backup slot for 7 days.

## Consumers that must change
- `apps/client/src/sim-host` (new, gameplay-systems-engineer): implements `LocalRoomHost`.
- `apps/client/src/net` (netcode-engineer): implements `RemoteRoomHost` and save sync.
- `gameplay`, `terrain`, `ui`, `debug`: consume `RoomHost`.
- `app` (integrator): registers `roomHost`.
- `apps/server/src/api` + `persistence`, `packages/db` (backend-data-engineer): new routes, verification, migration.
- `packages/sim`: envelope codec v1.
- `packages/world`: chunk codec.
- `tools/bots`: fixtures v1.

## Lead-owned follow-ups (not edited by me)
- OPEN_QUESTIONS Q16 is resolved by ADR-0031.
- `environments.md` `VITE_OFFLINE_SOLO` is obsolete: remove it or turn it into `?simhost=main`.
- `scope-tiers.md` §130, `M2-v1-parity.md` §633 and `M4-post-launch.md` still describe Offline Solo as post-launch.
- `system-overview.md` §5.1 hub `onlineRequired` value.
- `performance-budgets.md` needs Solo worker rows (worker tick p95 ≤ 2 ms, host ≤ 0.3 ms/frame).
- `M1-mvp.md` §4 stage table and §7 DAG nodes for the new rows.
- Open decision: Solo tick rate 20 vs 30, to be decided after the E13 measurement.
