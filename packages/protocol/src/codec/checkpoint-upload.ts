// Checkpoint upload body framing (contract api/rest v0.4.0, ADR-0031 amendment 1). Byte-level only: no JSON, no UTF-8,
// no Node or DOM API (this package has `types: []`); callers encode the metadata JSON with TextEncoder / Buffer.
//
// Body of `POST /v1/contracts/:id/solo-checkpoints` (content-type application/octet-stream):
//   0      2     metaLen u16 LE          1..CHECKPOINT_META_MAX_BYTES
//   2      m     metadata JSON (UTF-8)   SoloCheckpointBeginRequest
//   2 + m  p     MCCK package            1..CHECKPOINT_PART_MAX_BYTES (its own magic, lengths and trailer CRC32)
//
// Consumers: apps/client/src/net (build), apps/server/src/api/checkpoints (split), tools/bots.
// Splitters never throw and never copy: both views alias `body`. Reasons map to HTTP 400 BAD_REQUEST, except `too_large`
// (413 PAYLOAD_TOO_LARGE).

import {
  CHECKPOINT_META_MAX_BYTES,
  CHECKPOINT_PART_MAX_BYTES,
  CHECKPOINT_UPLOAD_BODY_MAX_BYTES,
  CHECKPOINT_UPLOAD_PREFIX_BYTES,
} from "@moon-cleanup/shared";

export type CheckpointUploadSplit =
  | { readonly ok: true; readonly meta: Uint8Array; readonly pkg: Uint8Array }
  | { readonly ok: false; readonly reason: "too_large" | "truncated" | "bad_meta_length" | "empty_package" };

/** Size of a framed body for the given part lengths. */
export function checkpointUploadBodyBytes(metaBytes: number, pkgBytes: number): number {
  return CHECKPOINT_UPLOAD_PREFIX_BYTES + metaBytes + pkgBytes;
}

/**
 * Writes the framed body into `out` (offset 0) and returns the bytes written. Throws RangeError on a length outside the
 * contract or when `out` is too small (a programming error on the sending side).
 */
export function writeCheckpointUploadBody(meta: Uint8Array, pkg: Uint8Array, out: Uint8Array): number {
  if (meta.byteLength < 1 || meta.byteLength > CHECKPOINT_META_MAX_BYTES) throw new RangeError("metadata length");
  if (pkg.byteLength < 1 || pkg.byteLength > CHECKPOINT_PART_MAX_BYTES) throw new RangeError("package length");
  const total = checkpointUploadBodyBytes(meta.byteLength, pkg.byteLength);
  if (out.byteLength < total) throw new RangeError("output too small");
  out[0] = meta.byteLength & 0xff;
  out[1] = meta.byteLength >>> 8;
  out.set(meta, CHECKPOINT_UPLOAD_PREFIX_BYTES);
  out.set(pkg, CHECKPOINT_UPLOAD_PREFIX_BYTES + meta.byteLength);
  return total;
}

/** Allocating convenience over `writeCheckpointUploadBody`. */
export function encodeCheckpointUploadBody(meta: Uint8Array, pkg: Uint8Array): Uint8Array {
  const out = new Uint8Array(checkpointUploadBodyBytes(meta.byteLength, pkg.byteLength));
  writeCheckpointUploadBody(meta, pkg, out);
  return out;
}

/** Splits a received body into metadata and package views (see the file header for the reasons). */
export function splitCheckpointUploadBody(body: Uint8Array): CheckpointUploadSplit {
  if (body.byteLength > CHECKPOINT_UPLOAD_BODY_MAX_BYTES) return { ok: false, reason: "too_large" };
  if (body.byteLength < CHECKPOINT_UPLOAD_PREFIX_BYTES) return { ok: false, reason: "truncated" };
  const metaLen = (body[0] ?? 0) | ((body[1] ?? 0) << 8);
  if (metaLen < 1 || metaLen > CHECKPOINT_META_MAX_BYTES) return { ok: false, reason: "bad_meta_length" };
  const pkgStart = CHECKPOINT_UPLOAD_PREFIX_BYTES + metaLen;
  if (body.byteLength < pkgStart) return { ok: false, reason: "truncated" };
  const pkgLen = body.byteLength - pkgStart;
  if (pkgLen === 0) return { ok: false, reason: "empty_package" };
  if (pkgLen > CHECKPOINT_PART_MAX_BYTES) return { ok: false, reason: "too_large" };
  return {
    ok: true,
    meta: body.subarray(CHECKPOINT_UPLOAD_PREFIX_BYTES, pkgStart),
    pkg: body.subarray(pkgStart),
  };
}
