# Dust contest results: stub

DRY RUN (stub or CPU only): plumbing check, not a contest score.

| Scenario | Metric | Value | Bar | Status |
| --- | --- | --- | --- | --- |
| S1 | s1.dustGpuMs.p95.tierB | n/a | <= 1 | NOT_RUN (GPU timestamps not provided by this adapter or run (CPU/headless)) |
| S1 | s1.edgeWidthPx.2m | n/a | <= 2 | NOT_RUN |
| S1 | s1.edgeWidthPx.10m | n/a | - | NOT_RUN |
| S1 | s1.edgeWidthPx.50m | n/a | - | NOT_RUN |
| S1 | s1.cpuMs.p95 | 0 ms | - | INFO |
| S1 | s1.frames | 600 frames | - | INFO |
| S1 | s1.strokes | 299 strokes | - | INFO |
| S2 | s2.maxFrameOverTarget | 0 x target frame | <= 2 | PASS (tile-work CPU ms over 16.7 ms) |
| S2 | s2.replayMs.p95 | 0 ms | - | INFO |
| S2 | s2.tileRebuildMs.max | 0 ms | - | INFO |
| S2 | s2.tileUploadsPerSec | 22.95 tiles/s | - | INFO |
| S2 | s2.strokes | 299 strokes | - | INFO |
| S2 | s2.plotsCrossed | 30 plots | - | INFO (525 m out and back at 20 m/s) |
| S3 | s3.tileUploadsPerFrame | 0.26666666666666666 tiles | - | INFO |
| S3 | s3.orbitIdentificationPct | n/a | >= 80 | NOT_RUN (needs 10 testers; ground truth + blind pairs from the A/B generator (B08-orbit-globe)) |
| S4 | s4.eventLoopLagP99Ms | n/a | <= 20 | NOT_RUN (adapter has no probe) |
| S4 | s4.bytesPerSecPerClient.max | 3840 B/s | <= 1200 | FAIL |
| S4 | s4.hashMatchPct | 100 % | >= 100 | PASS |
| S4 | s4.tickMs.p50 | 0.07 ms | - | INFO |
| S4 | s4.tickMs.p99 | 0.31 ms | - | INFO |
| S4 | s4.bytesPerSecPerClient.p50 | 3840 B/s | - | INFO |
| S4 | s4.serverCpuMs | n/a | - | NOT_RUN |
| S4 | s4.rejectedStrokes | 0 strokes | - | INFO |
| S4 | s4.strokes | 6400 strokes | - | INFO |
| S5 | s5.serverCpuPctOfBudget | n/a | <= 10 | NOT_RUN (adapter has no probe) |
| S5 | s5.rssMb | n/a | <= 300 | NOT_RUN (adapter has no probe) |
| S5 | s5.intents | 400 intents | - | INFO |
| S5 | s5.intentBytesPerSec | 400 B/s | - | INFO |
| S5 | s5.tickMs.p99 | 0.2 ms | - | INFO |
| S6 | s6.lostSeconds | 0 s | <= 30 | PASS |
| S6 | s6.restoredHashConsistent | 1 bool | == 1 | PASS |
| S6 | s6.restoreMs | 0 ms | - | INFO |
| S6 | s6.postRestoreHashMatchPct | 100 % | - | INFO |
| S7 | s7.blockingBytes | 22704 B | <= 150000 | PASS |
| S7 | s7.playableMs | 0 ms | <= 3000 | PASS |
| S7 | s7.streamedBytes | 0 B | - | INFO |
| S7 | s7.tileRebuildMs | 0 ms | - | INFO |
| S7 | s7.frames | 300 frames | - | INFO |
| S8 | s8.bookmarks | 9 shots | - | INFO (parity pairs needed per backend) |
| S8 | s8.captured | n/a | - | NOT_RUN (GPU capture not run (headless dry run)) |
