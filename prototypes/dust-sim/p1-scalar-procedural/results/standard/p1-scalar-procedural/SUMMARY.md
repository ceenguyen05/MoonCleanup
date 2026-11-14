# Dust contest results: p1-scalar-procedural

Measured run.

| Scenario | Metric | Value | Bar | Status |
| --- | --- | --- | --- | --- |
| S1 | s1.dustGpuMs.p95.tierB | n/a | <= 1 | NOT_RUN (GPU timestamps not provided by this adapter or run (CPU/headless)) |
| S1 | s1.edgeWidthPx.2m | n/a | <= 2 | NOT_RUN |
| S1 | s1.edgeWidthPx.10m | n/a | - | NOT_RUN |
| S1 | s1.edgeWidthPx.50m | n/a | - | NOT_RUN |
| S1 | s1.cpuMs.p95 | 0.05 ms | - | INFO |
| S1 | s1.frames | 10800 frames | - | INFO |
| S1 | s1.strokes | 3599 strokes | - | INFO |
| S2 | s2.maxFrameOverTarget | 0.22179599999990385 x target frame | <= 2 | PASS (tile-work CPU ms over 16.7 ms) |
| S2 | s2.replayMs.p95 | 0.24 ms | - | INFO |
| S2 | s2.tileRebuildMs.max | 0 ms | - | INFO |
| S2 | s2.tileUploadsPerSec | 22.633333333333333 tiles/s | - | INFO |
| S2 | s2.strokes | 2399 strokes | - | INFO |
| S2 | s2.plotsCrossed | 30 plots | - | INFO (525 m out and back at 20 m/s) |
| S3 | s3.tileUploadsPerFrame | 0.08916666666666667 tiles | - | INFO |
| S3 | s3.orbitIdentificationPct | n/a | >= 80 | NOT_RUN (needs 10 testers on B08-orbit-globe blind pairs; ground truth is the reference strip of sceneSetupStrokes) |
| S4 | s4.eventLoopLagP99Ms | n/a | <= 20 | NOT_RUN (adapter has no probe) |
| S4 | s4.bytesPerSecPerClient.max | 72.33 B/s | <= 1200 | PASS |
| S4 | s4.hashMatchPct | 100 % | >= 100 | PASS |
| S4 | s4.tickMs.p50 | 0.03 ms | - | INFO |
| S4 | s4.tickMs.p99 | 0.1 ms | - | INFO |
| S4 | s4.bytesPerSecPerClient.p50 | 72.21 B/s | - | INFO |
| S4 | s4.serverCpuMs | 72.96509999989803 ms | - | INFO |
| S4 | s4.rejectedStrokes | 1 strokes | - | INFO |
| S4 | s4.strokes | 192000 strokes | - | INFO |
| S5 | s5.serverCpuPctOfBudget | 0.1760411666665853 % of 0.1 CPU | <= 10 | PASS |
| S5 | s5.rssMb | 151.25 MB | <= 300 | PASS |
| S5 | s5.intents | 1466 intents | - | INFO |
| S5 | s5.intentBytesPerSec | 17.10333333333333 B/s | - | INFO |
| S5 | s5.tickMs.p99 | 0.04 ms | - | INFO |
| S6 | s6.lostSeconds | 0 s | <= 30 | PASS |
| S6 | s6.restoredHashConsistent | 1 bool | == 1 | PASS |
| S6 | s6.restoreMs | 4.536800000000312 ms | - | INFO |
| S6 | s6.postRestoreHashMatchPct | 100 % | - | INFO |
| S7 | s7.blockingBytes | 101 B | <= 150000 | PASS |
| S7 | s7.playableMs | 3.2739000000001397 ms | <= 3000 | PASS |
| S7 | s7.streamedBytes | 0 B | - | INFO |
| S7 | s7.tileRebuildMs | 0 ms | - | INFO |
| S7 | s7.frames | 600 frames | - | INFO |
| S8 | s8.bookmarks | 9 shots | - | INFO (parity pairs needed per backend) |
| S8 | s8.captured | n/a | - | NOT_RUN (GPU capture not run (headless dry run)) |
