// Golden bytes of a FRAME that carries the dust sections (strokes, robot intents, dust plot deltas). Layouts: header of
// codec/dust-wire.ts and codec/frame-writer.ts. The bytes were produced by the encoder, then checked against hand
// arithmetic and the independent LSB-first BigInt packer in codec/frame-vectors.test.ts. Changing a byte is a
// PROTOCOL_VERSION change: `vector-version.test.ts` pins a hash of every golden vector per PROTOCOL_VERSION, so a
// silent wire change fails CI until the version is bumped and the new hash is recorded.
//
// Shared with terrain-dust-engineer (stroke chain, robot intent and plot delta records).

/** PROTOCOL_VERSION these vectors belong to (asserted equal to the shared constant in the test). */
export const FRAME_SECTION_VECTORS_VERSION = 1;

export const FRAME_DUST_SECTIONS_VECTOR = {
  /**
   * serverTick 1000, ackInputSeq 0x1234, inputBufferDepth 2, not a keyframe, Self = all-zero on foot (21 B), then
   *   strokes (0x1b = 27 B): count 1; chain anchor 10, start (1, -2) mm, end (3, -4) mm, widthCm 20, depth16 80,
   *     toolCode 1, actorSlot 2, tick 998 (offset 2 from refTick 1000), inputSeq 0x1234, continuations (5, -5), (-6, 7)
   *   robot intents (0x14 = 20 B): robotId 0x0102, plotId 0x2a3b, startTick 0x0a0b0c0d, widthCm 30, depth16 60,
   *     speedCmPerS 150, laneMask 0x00ff00ff_55aa55aa
   *   dust plots (0x08 = 8 B): (plot 7, state 1, remainingFrac 200), (plot 163841, state 3, remainingFrac 255)
   */
  serverTick: 1000,
  ackInputSeq: 0x1234,
  inputBufferDepth: 2,
  /** flags byte: hasStrokes (bit 3) | hasRobotIntents (bit 4) | hasDustPlots (bit 5). */
  flags: 0x38,
  bytes: [
    0x20, 0xe8, 0x03, 0x00, 0x00, 0x34, 0x12, 0x02, 0x38, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1b, 0x00, 0x01, 0x0a, 0x00, 0x04, 0x00, 0xf8,
    0xff, 0x0f, 0x00, 0xf0, 0xff, 0x53, 0x00, 0x15, 0x08, 0x02, 0x34, 0x12, 0x02, 0x42, 0x01, 0xd8, 0xff, 0x82, 0xfe,
    0x3f, 0x00, 0x14, 0x00, 0x02, 0x01, 0x3b, 0x2a, 0x34, 0x30, 0x2c, 0x28, 0x78, 0xc0, 0x63, 0x89, 0x6a, 0x95, 0x6a,
    0xd5, 0x3f, 0xc0, 0x3f, 0x00, 0x08, 0x00, 0x07, 0x00, 0x84, 0x0c, 0x01, 0x80, 0xfe, 0x0f,
  ],
} as const;
