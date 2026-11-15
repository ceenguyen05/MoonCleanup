# Dust contest results: p3-client-paint-minmerge

Measured run.

| Scenario | Metric | Value | Bar | Status |
| --- | --- | --- | --- | --- |
| S1 | s1.dustGpuMs.p95.tierB | n/a | <= 1 | NOT_RUN (GPU timestamps not provided by this adapter or run (CPU/headless)) |
| S1 | s1.edgeWidthPx.2m | n/a | <= 2 | NOT_RUN |
| S1 | s1.edgeWidthPx.10m | n/a | - | NOT_RUN |
| S1 | s1.edgeWidthPx.50m | n/a | - | NOT_RUN |
| S1 | s1.cpuMs.p95 | 0 ms | - | INFO |
| S1 | s1.frames | 10800 frames | - | INFO |
| S1 | s1.strokes | 3599 strokes | - | INFO |
| S2 | s2.maxFrameOverTarget | 0.35291999999992185 x target frame | <= 2 | PASS (tile-work CPU ms over 16.7 ms) |
| S2 | s2.replayMs.p95 | 0.03 ms | - | INFO |
| S2 | s2.tileRebuildMs.max | 0.6672000000000935 ms | - | INFO |
| S2 | s2.tileUploadsPerSec | 20.783333333333335 tiles/s | - | INFO |
| S2 | s2.strokes | 2399 strokes | - | INFO |
| S2 | s2.plotsCrossed | 30 plots | - | INFO (525 m out and back at 20 m/s) |
| S3 | s3.tileUploadsPerFrame | 0.0011111111111111111 tiles | - | INFO |
| S3 | s3.orbitIdentificationPct | n/a | >= 80 | NOT_RUN (needs 10 testers on B08-orbit-globe blind pairs; ground truth is the reference strip of sceneSetupStrokes) |
| S4 | s4.eventLoopLagP99Ms | n/a | <= 20 | NOT_RUN (adapter has no probe) |
| S4 | s4.bytesPerSecPerClient.max | 1030.92 B/s | <= 1200 | PASS |
| S4 | s4.hashMatchPct | 100 % | >= 100 | PASS |
| S4 | s4.tickMs.p50 | 0.11 ms | - | INFO |
| S4 | s4.tickMs.p99 | 0.29 ms | - | INFO |
| S4 | s4.bytesPerSecPerClient.p50 | 1002.26 B/s | - | INFO |
| S4 | s4.serverCpuMs | 229.73710000005394 ms | - | INFO |
| S4 | s4.rejectedStrokes | 1 strokes | - | INFO |
| S4 | s4.strokes | 192000 strokes | - | INFO |
| S5 | s5.serverCpuPctOfBudget | 0.46993433333339457 % of 0.1 CPU | <= 10 | PASS |
| S5 | s5.rssMb | 155.546875 MB | <= 300 | PASS |
| S5 | s5.intents | 1466 intents | - | INFO |
| S5 | s5.intentBytesPerSec | 6.918333333333333 B/s | - | INFO |
| S5 | s5.tickMs.p99 | 0.13 ms | - | INFO |
| S6 | s6.lostSeconds | 0 s | <= 30 | PASS |
| S6 | s6.restoredHashConsistent | 1 bool | == 1 | PASS |
| S6 | s6.restoreMs | 3.6469999999999345 ms | - | INFO |
| S6 | s6.postRestoreHashMatchPct | 100 % | - | INFO |
| S7 | s7.blockingBytes | 5139 B | <= 150000 | PASS |
| S7 | s7.playableMs | 5.051300000000083 ms | <= 3000 | PASS |
| S7 | s7.streamedBytes | 631 B | - | INFO |
| S7 | s7.tileRebuildMs | 1.7219000000004598 ms | - | INFO |
| S7 | s7.frames | 600 frames | - | INFO |
| S8 | s8.bookmarks | 9 shots | - | INFO (parity pairs needed per backend) |
| S8 | s8.captured | n/a | - | NOT_RUN (GPU capture not run (headless dry run)) |
