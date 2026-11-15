# Dust contest results: p2-stroke-atlas-ledger

Measured run.

| Scenario | Metric | Value | Bar | Status |
| --- | --- | --- | --- | --- |
| S1 | s1.dustGpuMs.p95.tierB | n/a | <= 1 | NOT_RUN (GPU timestamps not provided by this adapter or run (CPU/headless)) |
| S1 | s1.edgeWidthPx.2m | n/a | <= 2 | NOT_RUN |
| S1 | s1.edgeWidthPx.10m | n/a | - | NOT_RUN |
| S1 | s1.edgeWidthPx.50m | n/a | - | NOT_RUN |
| S1 | s1.cpuMs.p95 | 0.01 ms | - | INFO |
| S1 | s1.frames | 10800 frames | - | INFO |
| S1 | s1.strokes | 3599 strokes | - | INFO |
| S2 | s2.maxFrameOverTarget | 0.07694400000000313 x target frame | <= 2 | PASS (tile-work CPU ms over 16.7 ms) |
| S2 | s2.replayMs.p95 | 0.02 ms | - | INFO |
| S2 | s2.tileRebuildMs.max | 1.272399999999834 ms | - | INFO |
| S2 | s2.tileUploadsPerSec | 23.541666666666668 tiles/s | - | INFO |
| S2 | s2.strokes | 2399 strokes | - | INFO |
| S2 | s2.plotsCrossed | 30 plots | - | INFO (525 m out and back at 20 m/s) |
| S4 | s4.eventLoopLagP99Ms | n/a | <= 20 | NOT_RUN (adapter has no probe) |
| S4 | s4.bytesPerSecPerClient.max | 761.99 B/s | <= 1200 | PASS |
| S4 | s4.hashMatchPct | 100 % | >= 100 | PASS |
| S4 | s4.tickMs.p50 | 0.39 ms | - | INFO |
| S4 | s4.tickMs.p99 | 1.25 ms | - | INFO |
| S4 | s4.bytesPerSecPerClient.p50 | 761.48 B/s | - | INFO |
| S4 | s4.serverCpuMs | 621.4540000007744 ms | - | INFO |
| S4 | s4.rejectedStrokes | 1 strokes | - | INFO |
| S4 | s4.strokes | 192000 strokes | - | INFO |
| S6 | s6.lostSeconds | 0 s | <= 30 | PASS |
| S6 | s6.restoredHashConsistent | 1 bool | == 1 | PASS |
| S6 | s6.restoreMs | 10.906600000000253 ms | - | INFO |
| S6 | s6.postRestoreHashMatchPct | 100 % | - | INFO |
| S7 | s7.blockingBytes | 26739 B | <= 150000 | PASS |
| S7 | s7.playableMs | 38.51470000000063 ms | <= 3000 | PASS |
| S7 | s7.streamedBytes | 465 B | - | INFO |
| S7 | s7.tileRebuildMs | 26.574100000000726 ms | - | INFO |
| S7 | s7.frames | 600 frames | - | INFO |
