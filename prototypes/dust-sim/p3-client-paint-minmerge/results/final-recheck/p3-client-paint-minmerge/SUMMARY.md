# Dust contest results: p3-client-paint-minmerge

Measured run.

| Scenario | Metric | Value | Bar | Status |
| --- | --- | --- | --- | --- |
| S4 | s4.eventLoopLagP99Ms | n/a | <= 20 | NOT_RUN (adapter has no probe) |
| S4 | s4.bytesPerSecPerClient.max | 1030.92 B/s | <= 1200 | PASS |
| S4 | s4.hashMatchPct | 100 % | >= 100 | PASS |
| S4 | s4.tickMs.p50 | 0.14 ms | - | INFO |
| S4 | s4.tickMs.p99 | 0.47 ms | - | INFO |
| S4 | s4.bytesPerSecPerClient.p50 | 1002.26 B/s | - | INFO |
| S4 | s4.serverCpuMs | 314.0249999999269 ms | - | INFO |
| S4 | s4.rejectedStrokes | 1 strokes | - | INFO |
| S4 | s4.strokes | 192000 strokes | - | INFO |
| S6 | s6.lostSeconds | 0 s | <= 30 | PASS |
| S6 | s6.restoredHashConsistent | 1 bool | == 1 | PASS |
| S6 | s6.restoreMs | 6.658100000000104 ms | - | INFO |
| S6 | s6.postRestoreHashMatchPct | 100 % | - | INFO |
| S7 | s7.blockingBytes | 5139 B | <= 150000 | PASS |
| S7 | s7.playableMs | 5.085599999999886 ms | <= 3000 | PASS |
| S7 | s7.streamedBytes | 631 B | - | INFO |
| S7 | s7.tileRebuildMs | 1.0721999999996115 ms | - | INFO |
| S7 | s7.frames | 600 frames | - | INFO |
