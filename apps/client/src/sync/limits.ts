// Constants of the solo checkpoint sync (ADR-0031, data-model.md section 3.7c). Everything numeric lives here or in
// @moon-cleanup/shared; the sync code carries no magic numbers.

import {
  CHECKPOINT_MAX_PARTS,
  CHECKPOINT_PART_MAX_BYTES,
  DUST_CHUNK_PAYLOAD_MAX_BYTES,
  SAVE_HEADER_MAX_BYTES,
  SOLO_UPLOAD_INTERVAL_S,
  SOLO_UPLOAD_MIN_INTERVAL_S,
} from "@moon-cleanup/shared";

/** One upload request carries at most this many package bytes (the server has no multi-part route yet). */
export const UPLOAD_PACKAGE_MAX_BYTES = CHECKPOINT_PART_MAX_BYTES;
/** Largest dust chunk payload accepted from a package, uncompressed (shared/save v1.1; v1.0 packages are smaller). */
export const CHUNK_RAW_MAX_BYTES = DUST_CHUNK_PAYLOAD_MAX_BYTES;
/** Largest uncompressed header envelope. */
export const HEADER_RAW_MAX_BYTES = SAVE_HEADER_MAX_BYTES;
/** Total inflated chunk bytes of one package set the client will produce or accept (matches the server's budget). */
export const INFLATE_CAP_BYTES = 32 * 1024 * 1024;
/** A download has at most this many pages (the `page` query maximum is `CHECKPOINT_MAX_PARTS - 1`). */
export const DOWNLOAD_MAX_PAGES = CHECKPOINT_MAX_PARTS;
/** A mixed-generation download (an upload committed between page requests) is restarted this often. */
export const DOWNLOAD_MAX_RESTARTS = 2;

/** Upload cadence: at most every 120 s while dirty; the server enforces 20 s per Contract. */
export const UPLOAD_INTERVAL_MS = SOLO_UPLOAD_INTERVAL_S * 1000;
export const UPLOAD_MIN_INTERVAL_MS = SOLO_UPLOAD_MIN_INTERVAL_S * 1000;

/** Retry backoff after a failed attempt: 30 s, doubling, capped at 5 minutes (netcode.md section 19.3). */
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 300_000;
/** +/- fraction of random jitter on every backoff delay. */
export const BACKOFF_JITTER = 0.2;

/** Request timeouts: a cold Render instance can take long to answer the first request. */
export const UPLOAD_TIMEOUT_MS = 90_000;
export const READ_TIMEOUT_MS = 45_000;

/** Slicing of CPU work (CRC, patching) on the main thread: yield after this many ms. */
export const SLICE_BUDGET_MS = 2;
