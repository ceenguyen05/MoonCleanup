# ADR-0023: Protocol encoding - Schema for entities, hand-rolled bit-packed codec for bulk data

- **Status:** Accepted (2026-11-12)
- **Deciders:** lead/orchestrator, netcode-engineer
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 4 (Protocol encoding row), section 3

## Context

Bandwidth is the existential $0 limit (5 GB/month on Render) and server CPU is 0.1 core. Entity state (players, vehicles, robots) is moderately sized and benefits from framework delta tracking. The dust field, strokes and compact snapshots are large, structured and need chunked deltas: a Schema collection costs about 6 bytes per changed cell and a ~1 MB join snapshot at 163,842 cells, and StateView is documented as not optimized for large datasets. Estimated sizes: stroke ~16 B, plot update ~4 B, compact snapshot ~40 KiB plus k bytes.

## Options considered

1. **Hybrid: Colyseus Schema (encode-once, no StateView) for entity state; hand-rolled bit-packed `DataView` codec in `packages/protocol` over `broadcastBytes`/`sendBytes` for dust, strokes and compact snapshots.** Pro: best bytes where it matters; framework help elsewhere. Con: custom codec bugs.
2. **Everything through Schema.** Pro: one mechanism. Con: dust field is too large and costly.
3. **JSON or MessagePack for everything.** Pro: easy to debug. Con: 5-10x the bytes; naive JSON exhausts 5 GB in ~11 player-hours.
4. **Protobuf/FlatBuffers/Cap'n Proto.** Pro: schema tooling. Con: extra codegen/runtime; less control over bit packing and quantization.
5. **Per-message permessage-deflate.** Pro: free compression. Con: `ws` warns of memory fragmentation; CPU on 0.1 core.

## Decision

Option 1. The **protocol catalog** (message type enum, payload shapes, channel schema/bytes, direction, rate, `PROTOCOL_VERSION`) is a contract in `shared/protocol/`. In `packages/protocol` (environment-agnostic, owner netcode-engineer):
- a **field-table driven** bit-packing codec with quantized floats and delta-vs-last-sent snapshots; chunked dust deltas with dirty lists (about 128-plot chunks); fixed-size stroke records;
- a **development-only JSON mirror mode** for debugging and golden test vectors;
- exhaustive **round-trip and fuzz tests**; maximum message size enforced; bounds-checked decoding;
- snapshots **compressed once** and cached; **permessage-deflate disabled**;
- gameplay messages are MsgPack via Colyseus with zod validation at the edge (ADR-0024);
- breaking changes bump `PROTOCOL_VERSION`, with a migration note; clients with a mismatched version are told to reload.

## Consequences

**Positive**
- Roughly 4-6 bytes per moving entity and 1 bit per idle entity (est.); the join snapshot is tens of KB instead of ~1 MB; the codec is transport-agnostic.

**Negative / risks**
- Bit-level bugs and agent unfamiliarity with custom codecs; mitigated by the single field table and fuzzing.
- Two encodings (Schema and bytes) must stay consistent on versioning.
- Debuggability suffers without the JSON mirror.

## Revisit trigger

- Codec defects or maintenance cost exceed the bandwidth benefit (observed bytes within 30% of a Schema/MsgPack alternative).
- A bandwidth-uncapped host is adopted and byte efficiency stops being critical.

## Evidence

- [netcode-case-raw-websocket.md](../research/tech/netcode-case-raw-websocket.md) (protocol, delta baselines, risk W5)
- [netcode-case-colyseus.md](../research/tech/netcode-case-colyseus.md) (Schema cost, raw bytes channel, section 5)
- [terrain-and-dust-techniques.md](../research/tech/terrain-and-dust-techniques.md) (section 7 sync sizing)
