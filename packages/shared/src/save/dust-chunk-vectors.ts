// @contract save/dust-chunk-vectors v1
// @consumers packages/world (chunk payload codec tests), apps/server/src/persistence and apps/client/src/sim-host
//   (row round-trip tests), tools/bots (fixtures)
//
// Golden vectors of the dust chunk payload (./dust-chunk). A codec must encode the described payload to exactly
// `length` bytes with CRC32 `crc32`, and to `bytesHex` where present. Changing a vector is a payload version change
// (DUST_CHUNK_PAYLOAD_VERSION).

import type { DustChunkGoldenVector } from "./dust-chunk";

export const DUST_CHUNK_GOLDEN_VECTORS: readonly DustChunkGoldenVector[] = [
  {
    name: "pole chunk, no touched plots, north Polished and south Empty",
    chunkId: 640,
    bakeCheck: 0,
    states: [2, 3],
    plots: [],
    length: 8,
    crc32: 708_883_784,
    bytesHex:
      "0100" + // payloadVersion 1
      "8002" + // chunkId 640
      "00" + // bakeCheck
      "0000" + // touchedCount 0
      "0e", // states: north 2 | south 3 << 2
  },
  {
    name: "chunk 41, one Opened plot with a contribution and 2 strokes, one touched Grimy plot",
    chunkId: 41,
    bakeCheck: 0,
    // local 0 Opened, local 2 Polished, local 255 Empty, the rest Grimy; local 1 is Grimy but touched (has a ledger).
    states: Array.from({ length: 256 }, (_, k) => (k === 0 ? 1 : k === 2 ? 2 : k === 255 ? 3 : 0)),
    plots: [
      {
        localIndex: 0,
        remainingFrac: 200,
        ledger: {
          version: 12,
          remainingUnits: 38_000,
          initialUnits: 38_320,
          ownedTexels: 479,
          mgPerUnit: 2480,
          hash: 2_618_210_469,
          contributions: [{ actorSlot: 0, units: 320 }],
        },
        texelsPattern: "corners",
        strokeCount: 2,
        strokeLogHex: "aabbccdd",
      },
      {
        localIndex: 1,
        remainingFrac: 255,
        ledger: {
          version: 1,
          remainingUnits: 38_310,
          initialUnits: 38_320,
          ownedTexels: 479,
          mgPerUnit: 2480,
          hash: 2_214_824_389,
          contributions: [],
        },
        texelsPattern: "ramp",
        strokeCount: 0,
        strokeLogHex: "",
      },
    ],
    length: 2184,
    crc32: 772_353_984,
  },
];
