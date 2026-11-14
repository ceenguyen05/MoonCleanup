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
| S2 | s2.maxFrameOverTarget | 0.06765600000000176 x target frame | <= 2 | PASS (tile-work CPU ms over 16.7 ms) |
| S2 | s2.replayMs.p95 | 0.02 ms | - | INFO |
| S2 | s2.tileRebuildMs.max | 1.1199000000001433 ms | - | INFO |
| S2 | s2.tileUploadsPerSec | 23.541666666666668 tiles/s | - | INFO |
| S2 | s2.strokes | 2399 strokes | - | INFO |
| S2 | s2.plotsCrossed | 30 plots | - | INFO (525 m out and back at 20 m/s) |
| S3 | s3.tileUploadsPerFrame | 0 tiles | - | INFO |
| S3 | s3.orbitIdentificationPct | n/a | >= 80 | NOT_RUN (needs 10 testers on B08-orbit-globe blind pairs; ground truth is the reference strip of sceneSetupStrokes) |
| S4 | s4.eventLoopLagP99Ms | 0.13829999999961728 ms | <= 20 | PASS |
| S4 | s4.bytesPerSecPerClient.max | 761.99 B/s | <= 1200 | PASS |
| S4 | s4.hashMatchPct | 100 % | >= 100 | PASS |
| S4 | s4.tickMs.p50 | 0.37 ms | - | INFO |
| S4 | s4.tickMs.p99 | 1.12 ms | - | INFO |
| S4 | s4.bytesPerSecPerClient.p50 | 761.48 B/s | - | INFO |
| S4 | s4.serverCpuMs | 592.047000000247 ms | - | INFO |
| S4 | s4.rejectedStrokes | 1 strokes | - | INFO |
| S4 | s4.strokes | 192000 strokes | - | INFO |
| S5 | s5.serverCpuPctOfBudget | 2.097312000000167 % of 0.1 CPU | <= 10 | PASS |
| S5 | s5.rssMb | 163.7890625 MB | <= 300 | PASS |
| S5 | s5.intents | 1466 intents | - | INFO |
| S5 | s5.intentBytesPerSec | 7.944444444444445 B/s | - | INFO |
| S5 | s5.tickMs.p99 | 0.47 ms | - | INFO |
| S6 | s6.lostSeconds | 0 s | <= 30 | PASS |
| S6 | s6.restoredHashConsistent | 1 bool | == 1 | PASS |
| S6 | s6.restoreMs | 3.9813999999987573 ms | - | INFO |
| S6 | s6.postRestoreHashMatchPct | 100 % | - | INFO |
| S7 | s7.blockingBytes | 26739 B | <= 150000 | PASS |
| S7 | s7.playableMs | 35.05160000000069 ms | <= 3000 | PASS |
| S7 | s7.streamedBytes | 465 B | - | INFO |
| S7 | s7.tileRebuildMs | 24.608799999999974 ms | - | INFO |
| S7 | s7.frames | 600 frames | - | INFO |
| S8 | s8.bookmarks | 9 shots | - | INFO (parity pairs needed per backend) |
| S8 | s8.captured | n/a | - | NOT_RUN (GPU capture not run (headless dry run)) |
