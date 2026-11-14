// @contract save/checkpoint-vectors v1
// @consumers apps/client/src/sim-host and apps/client/src/net (package build and parse tests), apps/server/src/api and
//   apps/server/src/persistence (verify tests), tools/bots (fixtures)
//
// Golden vectors of the MCCK checkpoint package (./checkpoint-package). A codec must decode `bytesHex` to the
// described package and encode it back to exactly `bytesHex`. Changing a vector is a package version change
// (CHECKPOINT_PACKAGE_VERSION).

export interface CheckpointPackageGoldenVector {
  readonly name: string;
  readonly contractId: string;
  readonly generation: number;
  readonly baseGeneration: number;
  /** Opaque gzip header envelope bytes, lower-case hex (a fixture; not a real envelope). */
  readonly headerHex: string;
  readonly chunks: readonly {
    readonly chunkId: number;
    readonly ver: 0 | 1;
    readonly rawSize: number;
    readonly crc32: number;
    /** Deflate bytes, lower-case hex. */
    readonly bytesHex: string;
  }[];
  /** The complete package including the CRC32 trailer, lower-case hex. */
  readonly bytesHex: string;
}

export const CHECKPOINT_PACKAGE_GOLDEN_VECTORS: readonly CheckpointPackageGoldenVector[] = [
  {
    name: "generation 3 on base 2 with the pole chunk",
    contractId: "01931b5e-7c3a-7d2e-8f41-0123456789ab",
    generation: 3,
    baseGeneration: 2,
    headerHex: "1f8b0800",
    chunks: [
      {
        chunkId: 640,
        ver: 0,
        rawSize: 8,
        crc32: 708_883_784,
        bytesHex: "789c63646860626060e0030003280092",
      },
    ],
    bytesHex:
      "4d43434b" + // magic MCCK
      "0100" + // version 1
      "01931b5e7c3a7d2e8f410123456789ab" + // contractId
      "0300000000000000" + // generation 3
      "0200000000000000" + // baseGeneration 2
      "04000000" + // headerLen 4
      "1f8b0800" + // header
      "0100" + // chunkCount 1
      "8002" + // chunkId 640
      "00" + // ver 0
      "08000000" + // rawSize 8
      "48b5402a" + // crc32 0x2a40b548
      "10000000" + // len 16
      "789c63646860626060e0030003280092" + // deflate bytes
      "f6be27ca", // CRC32 0xca27bef6
  },
  {
    name: "download continuation page: no header, no chunks",
    contractId: "01931b5e-7c3a-7d2e-8f41-0123456789ab",
    generation: 3,
    baseGeneration: 2,
    headerHex: "",
    chunks: [],
    bytesHex:
      "4d43434b" + // magic MCCK
      "0100" + // version 1
      "01931b5e7c3a7d2e8f410123456789ab" + // contractId
      "0300000000000000" + // generation 3
      "0200000000000000" + // baseGeneration 2
      "00000000" + // headerLen 0
      "0000" + // chunkCount 0
      "af719672", // CRC32 0x729671af
  },
];
