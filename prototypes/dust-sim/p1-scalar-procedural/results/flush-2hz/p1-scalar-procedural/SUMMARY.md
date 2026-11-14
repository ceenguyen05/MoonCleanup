# Dust contest results: p1-scalar-procedural

Measured run.

| Scenario | Metric | Value | Bar | Status |
| --- | --- | --- | --- | --- |
| S4 | s4.eventLoopLagP99Ms | n/a | <= 20 | NOT_RUN (adapter has no probe) |
| S4 | s4.bytesPerSecPerClient.max | 65.09 B/s | <= 1200 | PASS |
| S4 | s4.hashMatchPct | 100 % | >= 100 | PASS |
| S4 | s4.tickMs.p50 | 0.02 ms | - | INFO |
| S4 | s4.tickMs.p99 | 0.1 ms | - | INFO |
| S4 | s4.bytesPerSecPerClient.p50 | 64.97 B/s | - | INFO |
| S4 | s4.serverCpuMs | 59.30530000001272 ms | - | INFO |
| S4 | s4.rejectedStrokes | 1 strokes | - | INFO |
| S4 | s4.strokes | 192000 strokes | - | INFO |
| S7 | s7.blockingBytes | 101 B | <= 150000 | PASS |
| S7 | s7.playableMs | 11.409799999999905 ms | <= 3000 | PASS |
| S7 | s7.streamedBytes | 0 B | - | INFO |
| S7 | s7.tileRebuildMs | 0 ms | - | INFO |
| S7 | s7.frames | 600 frames | - | INFO |
