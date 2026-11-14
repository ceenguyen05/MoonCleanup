// @contract save/vectors v1
// @consumers apps/server/src/persistence (envelope codec tests), packages/sim (section round-trip and v0 -> v1
//   upgrade tests), apps/client/src/sim-host (local checkpoint tests), tools/bots (fixtures)
//
// Golden vectors of the header envelope (./format). A codec must decode `bytesHex` to `header` + `bodiesHex` and
// encode them back to exactly `bytesHex`. Changing a vector is a save-format change (SAVE_FORMAT_VERSION). One
// fixture per historical version stays here (data-model.md section 6): v0 is kept as raw bytes plus its decoded
// header for the v0 -> v1 loader step.

import type { SaveHeader, SaveHeaderV0 } from "./format";

export interface SaveHeaderGoldenVector {
  readonly name: string;
  readonly header: SaveHeader;
  /** Section bodies in table order, lower-case hex. */
  readonly bodiesHex: readonly string[];
  /** The complete uncompressed envelope including the CRC32 trailer, lower-case hex. */
  readonly bytesHex: string;
}

export interface SaveHeaderV0GoldenVector {
  readonly name: string;
  readonly header: SaveHeaderV0;
  readonly bodiesHex: readonly string[];
  readonly bytesHex: string;
}

export const SAVE_HEADER_GOLDEN_VECTORS: readonly SaveHeaderGoldenVector[] = [
  {
    name: "v1 standard grid, solo generation 3, META with 3 bytes, empty PUCKS",
    header: {
      saveFormatVersion: 1,
      gridM: 128,
      radiusM: 2000,
      plotCount: 163_842,
      bakeHash: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
      dustModelVersion: 1,
      simTick: 72_000,
      generation: 3,
      parentGeneration: 2,
      originKind: "solo",
      originId: "00112233445566778899aabbccddeeff",
      sections: [
        { id: 1, version: 1, length: 3 },
        { id: 8, version: 2, length: 0 },
      ],
    },
    bodiesHex: ["010203", ""],
    bytesHex:
      "4d435356" + // magic MCSV
      "0100" + // saveFormatVersion 1
      "8000" + // gridM 128
      "d007" + // radiusM 2000
      "02800200" + // plotCount 163842
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" + // bakeHash
      "0100" + // dustModelVersion 1
      "4019010000000000" + // simTick 72000
      "0300000000000000" + // generation 3
      "0200000000000000" + // parentGeneration 2
      "01" + // originKind solo
      "00" + // reserved
      "00112233445566778899aabbccddeeff" + // originId
      "0200" + // sectionCount 2
      "0100" +
      "0100" +
      "03000000" + // META v1, 3 bytes
      "0800" +
      "0200" +
      "00000000" + // PUCKS v2, 0 bytes
      "010203" + // META body
      "177355b9", // CRC32 0xb9557317
  },
  {
    name: "v1 first room checkpoint, generation 1, no sections",
    header: {
      saveFormatVersion: 1,
      gridM: 128,
      radiusM: 2000,
      plotCount: 163_842,
      bakeHash: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
      dustModelVersion: 1,
      simTick: 0,
      generation: 1,
      parentGeneration: 0,
      originKind: "room",
      originId: "00000000000000000000000000000000",
      sections: [],
    },
    bodiesHex: [],
    bytesHex:
      "4d435356" + // magic MCSV
      "0100" + // saveFormatVersion 1
      "8000" + // gridM 128
      "d007" + // radiusM 2000
      "02800200" + // plotCount 163842
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" + // bakeHash
      "0100" + // dustModelVersion 1
      "0000000000000000" + // simTick 0
      "0100000000000000" + // generation 1
      "0000000000000000" + // parentGeneration 0
      "00" + // originKind room
      "00" + // reserved
      "00000000000000000000000000000000" + // originId
      "0000" + // sectionCount 0
      "b091d61a", // CRC32 0x1ad691b0
  },
];

/** The v0 fixture (58-byte fixed header). Upgrading it with SAVE_V0_TO_V1_DEFAULTS and save_seq 3 gives generation 3. */
export const SAVE_HEADER_V0_GOLDEN_VECTORS: readonly SaveHeaderV0GoldenVector[] = [
  {
    name: "v0 standard grid, META with 3 bytes, empty PUCKS",
    header: {
      saveFormatVersion: 0,
      gridM: 128,
      radiusM: 2000,
      plotCount: 163_842,
      bakeHash: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
      dustModelVersion: 1,
      simTick: 72_000,
      sections: [
        { id: 1, version: 1, length: 3 },
        { id: 8, version: 2, length: 0 },
      ],
    },
    bodiesHex: ["010203", ""],
    bytesHex:
      "4d435356" + // magic MCSV
      "0000" + // saveFormatVersion 0
      "8000" + // gridM 128
      "d007" + // radiusM 2000
      "02800200" + // plotCount 163842
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" + // bakeHash
      "0100" + // dustModelVersion 1
      "4019010000000000" + // simTick 72000
      "0200" + // sectionCount 2
      "0100" +
      "0100" +
      "03000000" + // META v1, 3 bytes
      "0800" +
      "0200" +
      "00000000" + // PUCKS v2, 0 bytes
      "010203" + // META body
      "c59d04f4", // CRC32 0xf4049dc5
  },
];
