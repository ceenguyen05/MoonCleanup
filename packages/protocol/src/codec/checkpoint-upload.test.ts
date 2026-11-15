import {
  CHECKPOINT_META_MAX_BYTES,
  CHECKPOINT_PART_MAX_BYTES,
  CHECKPOINT_UPLOAD_BODY_MAX_BYTES,
} from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import {
  checkpointUploadBodyBytes,
  encodeCheckpointUploadBody,
  splitCheckpointUploadBody,
  writeCheckpointUploadBody,
} from "./checkpoint-upload";

// Golden vector: metadata `{"a":1}` (7 ASCII bytes) and a 4-byte stand-in package. Layout pinned by the contract.
const GOLDEN_META = Uint8Array.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x31, 0x7d]);
const GOLDEN_PKG = Uint8Array.from([0x4d, 0x43, 0x43, 0x4b]);
const GOLDEN_BODY = [0x07, 0x00, 0x7b, 0x22, 0x61, 0x22, 0x3a, 0x31, 0x7d, 0x4d, 0x43, 0x43, 0x4b];
// 300-byte metadata: length prefix 0x012c little-endian proves byte order.
const META_300 = new Uint8Array(300).fill(0x20);

describe("checkpoint upload body framing", () => {
  it("matches the golden vector both ways", () => {
    expect([...encodeCheckpointUploadBody(GOLDEN_META, GOLDEN_PKG)]).toEqual(GOLDEN_BODY);
    const split = splitCheckpointUploadBody(Uint8Array.from(GOLDEN_BODY));
    expect(split.ok).toBe(true);
    if (split.ok) {
      expect([...split.meta]).toEqual([...GOLDEN_META]);
      expect([...split.pkg]).toEqual([...GOLDEN_PKG]);
    }
    expect(checkpointUploadBodyBytes(7, 4)).toBe(GOLDEN_BODY.length);
  });

  it("writes the length as u16 little-endian and aliases the input when splitting", () => {
    const body = encodeCheckpointUploadBody(META_300, GOLDEN_PKG);
    expect([body[0], body[1]]).toEqual([0x2c, 0x01]);
    const split = splitCheckpointUploadBody(body);
    expect(split.ok && split.meta.buffer === body.buffer && split.pkg.byteOffset === 302).toBe(true);
  });

  it("round-trips at the limits", () => {
    const meta = new Uint8Array(CHECKPOINT_META_MAX_BYTES).fill(1);
    const pkg = new Uint8Array(CHECKPOINT_PART_MAX_BYTES).fill(2);
    const body = encodeCheckpointUploadBody(meta, pkg);
    expect(body.byteLength).toBe(CHECKPOINT_UPLOAD_BODY_MAX_BYTES);
    const split = splitCheckpointUploadBody(body);
    expect(split.ok && split.meta.byteLength === meta.byteLength && split.pkg.byteLength === pkg.byteLength).toBe(true);
  });

  it("refuses malformed bodies with a reason and never throws", () => {
    const reason = (bytes: Uint8Array): string => {
      const r = splitCheckpointUploadBody(bytes);
      return r.ok ? "ok" : r.reason;
    };
    expect(reason(new Uint8Array(0))).toBe("truncated");
    expect(reason(Uint8Array.from([7]))).toBe("truncated");
    expect(reason(Uint8Array.from([0, 0, 1, 2]))).toBe("bad_meta_length");
    expect(reason(Uint8Array.from([0x01, 0x10, 1, 2]))).toBe("bad_meta_length"); // 4097
    expect(reason(Uint8Array.from([5, 0, 1, 2]))).toBe("truncated");
    expect(reason(Uint8Array.from([2, 0, 1, 2]))).toBe("empty_package");
    expect(reason(new Uint8Array(CHECKPOINT_UPLOAD_BODY_MAX_BYTES + 1))).toBe("too_large");
    const bigPkg = new Uint8Array(2 + 1 + CHECKPOINT_PART_MAX_BYTES + 1);
    bigPkg[0] = 1;
    expect(reason(bigPkg)).toBe("too_large");
  });

  it("throws RangeError for out-of-contract sender input", () => {
    const out = new Uint8Array(64);
    expect(() => writeCheckpointUploadBody(new Uint8Array(0), GOLDEN_PKG, out)).toThrow(RangeError);
    expect(() => writeCheckpointUploadBody(GOLDEN_META, new Uint8Array(0), out)).toThrow(RangeError);
    expect(() => writeCheckpointUploadBody(GOLDEN_META, GOLDEN_PKG, new Uint8Array(5))).toThrow(RangeError);
  });
});
