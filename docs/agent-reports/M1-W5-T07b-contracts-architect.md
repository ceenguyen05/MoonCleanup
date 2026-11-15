# M1-W5-T07b - Checkpoint upload/download wire shape sign-off (contracts-architect)

Task / status: DONE (contract + docs + tests), consumers not yet migrated / 2026-11-14 / contracts-architect / Sonnet 5.5
Note: the checkpoint DTOs live in `packages/shared/src/api/rest.ts` (not `packages/protocol`). I made the additive contract change there (contracts-architect's own path) and put the byte framing codec in `packages/protocol`. No file under `apps/` was edited.

## Decisions
1. **Header `x-mc-checkpoint-meta` is REJECTED.** uWebSockets.js caps the TOTAL request header size at 4096 bytes (`UWS_HTTP_MAX_HEADERS_SIZE`, default 4096, confirmed in the installed `index.d.ts`). Worst-case valid metadata (32 achievement ids x 64 chars) is 3032 JSON bytes = 4043 base64url chars; typical is 1186. The Bearer JWT and browser headers add about 1.5 KB. Oversize requests are dropped with no usable error. The 4096-char header cap in `service.ts` therefore cannot work.
   **Carrier = body prefix:** `u16 LE metaLen | metadata JSON (UTF-8, 1..4096 bytes) | MCCK package (1..1 MiB)`. Content-type `application/octet-stream`. Max body 1,052,674 bytes. `meta.totalBytes` = PACKAGE length only. No custom request header, so no CORS allow-header change.
2. **Required metadata fields / validation:** unchanged `SoloCheckpointBeginRequestSchema` (all fields required except `overwrite`, default false); `contractId` equals the path id, `partCount === 1`, `totalBytes === pkg.byteLength`, `packageCrc32` equals the package trailer CRC.
3. **Rejection codes** (all JSON `ApiErrorBody`; never echo content): framing failure `truncated | bad_meta_length | empty_package` -> 400 `BAD_REQUEST`; `too_large` or body over limit -> 413 `PAYLOAD_TOO_LARGE`; meta not JSON or zod failure -> 400 `BAD_REQUEST`; everything after that as in the T07 trust model (401, 404, 409 `SAVE_CONFLICT` / `CONTRACT_BUSY` / `SAVE_VERSION_UNSUPPORTED`, 422 `CHECKPOINT_REJECTED` + `reason`, 429/503 + `retry-after`). No new error code, no new reject reason.

## Contract changes (api/rest v0.3.0 -> v0.4.0, additive)
- `HttpRequest.rawBody?: Uint8Array`, `HttpResponse.binary?: Uint8Array`, `HttpRouteDef.rawBodyMaxBytes?: number`; `API_ROUTES.checkpointUpload.rawBodyMaxBytes = CHECKPOINT_UPLOAD_BODY_MAX_BYTES` (already spread into the route def by `routes.ts`, so the adapter learns the opt-in from the route itself).
- Constants: `API_BINARY_CONTENT_TYPE`, `CHECKPOINT_META_MAX_BYTES` (4096), `CHECKPOINT_UPLOAD_PREFIX_BYTES` (2), `CHECKPOINT_UPLOAD_BODY_MAX_BYTES`, `API_EXPOSED_RESPONSE_HEADERS` (`x-save-pages`, `retry-after`).
- `@moon-cleanup/protocol`: `splitCheckpointUploadBody`, `encodeCheckpointUploadBody`, `writeCheckpointUploadBody`, `checkpointUploadBodyBytes` (byte-only, no JSON/UTF-8, aliasing views, never throws on receive).
- Docs: ADR-0031 Amendment 1; `data-model.md` section 3.7c step 2.

## Brief for the netcode worker (`apps/server/src/net/**`)
Implement for BOTH transports (uWS in `http-routes.ts`, Node in `node-http.ts`), sharing logic in `executeRoute`:
1. **Raw request body.** If `route.rawBodyMaxBytes` is set: do NOT JSON-parse; give the handler `request.rawBody` (empty `Uint8Array` when no body) and `body: undefined`. Limit = `route.rawBodyMaxBytes` instead of `MAX_HTTP_BODY_BYTES` (keep 16 KB for every other route). Declared `content-length` over the limit -> 413 `PAYLOAD_TOO_LARGE` JSON before reading (Node: `connection: close`); streamed overflow -> same 413. Chunked (no content-length) bodies are counted while streaming. uWS: `onData` must still be attached synchronously; copy each chunk (uWS reuses it).
2. **Cheap pre-checks before buffering 1 MB:** require `authorization` starting with `Bearer ` else 401 `UNAUTHORIZED` without reading; require `content-type: application/octet-stream` (ignore charset params) else 400 `BAD_REQUEST`; cap raw-body reads in flight at 4 process-wide and 1 per client IP, else 503 `RETRY_LATER` + `retry-after: 5`. Read timeout 30 s then abort/close. Buffer once (no streaming to handler); handler must not retain the buffer.
3. **Binary response.** If `response.binary` is set write it verbatim (uWS `res.end(ArrayBuffer view)` inside `cork`; Node `res.end(Buffer)`); `content-length` = byte length, never converted to string, no JSON stringify. Default `content-type` header must be REPLACED by the handler's (`responseHeaderPairs` currently emits both `BASE_HEADERS` content-type and the handler's: dedupe, handler wins). Keep `cache-control: no-store` and `x-content-type-options: nosniff`. Whole body in memory (at most 1 MiB), no chunked streaming. Error responses stay JSON.
4. **CORS.** On every non-public CORS response add `access-control-expose-headers: x-save-pages, retry-after` (use `API_EXPOSED_RESPONSE_HEADERS.join(", ")`); `CORS_ALLOWED_HEADERS` stays `Authorization, Content-Type`; `CORS_ALLOWED_METHODS` stays `GET, POST, PATCH, DELETE` (add `PUT` only with the unbuilt parts route). Update `cors.test.ts`.
5. **Tests:** exact-limit body accepted, limit + 1 -> 413 (declared and chunked), bytes with 0x00/0xff/CRLF round-trip identically on both transports, JSON route still 16 KB, binary response bytes + headers identical on uWS and Node, one `content-type` header, expose-headers present, missing Bearer -> 401 without body read, concurrency cap -> 503.

## Brief for backend-data-engineer (apps/server/src/api/checkpoints, after the net worker or in parallel against the seam)
Replace header reading with `splitCheckpointUploadBody(request.rawBody)` (import from `@moon-cleanup/protocol`; confirm apps/server may depend on it), `TextDecoder`/`Buffer` to parse the JSON, `meta.totalBytes === pkg.byteLength`, run the existing package checks on `pkg`; delete `CHECKPOINT_META_HEADER` / `CHECKPOINT_META_MAX_CHARS`; map split reasons per Decisions 3; tests move metadata from header to body. Local `BinaryRequest`/`BinaryResponse` types can be dropped for the shared `HttpRequest.rawBody` / `HttpResponse.binary`.
Client (`apps/client/src/net`, later): build body with `encodeCheckpointUploadBody(new TextEncoder().encode(JSON.stringify(meta)), pkg)`, `fetch` POST, `Content-Type: application/octet-stream`, `Authorization: Bearer`; read `x-save-pages` on download.

## Evidence (Node 26.13.1, Windows, this file state; no pnpm verify)
- packages/protocol: tsc clean, eslint clean, vitest 10 files / 116 passed (new `codec/checkpoint-upload.test.ts`: golden vector both ways, u16 LE order, limit round trip, 7 refusal reasons, RangeError cases). Under the tool shell's default Node 22 four allocation tests fail (`total_allocated_bytes` missing); passes on Node 26.
- packages/shared: tsc, eslint clean, vitest 32 files / 465 passed (new block in `api/rest-v2.test.ts`: worst-case metadata schema-valid and 3032 bytes, base64url > 4000 (why the header failed), derived limit 1,052,674, only `checkpointUpload` is raw, type tests). prettier clean on both. `apps/server` `tsc --noEmit` still clean against the new types (no consumer change needed to compile).
- NOT RUN: over-the-wire upload/download (adapter not built), uWS header-limit behaviour at runtime (decision rests on the documented default in the installed `index.d.ts`), real browser fetch.

## Affected consumers
- `apps/server/src/net/**` (netcode worker): items 1-5 above.
- `apps/server/src/api/checkpoints/**` (backend-data-engineer): switch carrier; tests.
- `apps/client/src/net` (future save-sync card): framing + download paging.
- `tools/bots`: only if a bot uploads checkpoints.
- No `PROTOCOL_VERSION` or `SAVE_FORMAT_VERSION` change (REST only).

Files: `packages/shared/src/api/rest.ts`, `packages/shared/src/api/rest-v2.test.ts`, `packages/protocol/src/codec/checkpoint-upload.ts`, `packages/protocol/src/codec/checkpoint-upload.test.ts`, `packages/protocol/src/index.ts`, `docs/adr/0031-local-first-solo.md`, `docs/architecture/data-model.md`, this report.

Commit suggestion: feat(shared,protocol): checkpoint upload body framing and binary REST seam (api/rest v0.4.0)
