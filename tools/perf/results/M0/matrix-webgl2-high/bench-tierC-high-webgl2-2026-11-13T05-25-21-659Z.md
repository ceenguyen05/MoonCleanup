# Perf capture: bench / tier C / high / webgl2

Created 2026-11-13T05:25:21.659Z. Milestone M0/matrix-webgl2-high. **PROVISIONAL hardware.**

## Machine

- CPU: Intel(R) Core(TM) i7-8650U CPU @ 1.90GHz (8 threads), RAM 15.9 GB
- GPU: ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)
- Browser: Chrome 157.0.8103.79; adapter flag: default
- OS: Windows_NT 10.0.26200 (x64); Node v26.13.1

## Method

Seed perf-1; camera path "orbit-v0"; 8 s warm-up discarded, 15 s capture; 2 run(s). Values are median over runs (min to max across runs). Frame statistics cover every frame of each run. CPU and GPU lines are medians of the HUD's 240-frame windows (labeled p50/p95 of those windows).
GPU timing source: **none** (CPU only: GPU numbers are absent, not estimated).

## Results

| Metric | Value |
| --- | --- |
| FPS | 6.5 (6.4 to 6.5, spread 2%) |
| Frame p50 / p95 / p99 (ms) | 141.05 (140.50 to 141.60, spread 1%) / 308.10 (307.00 to 309.20, spread 1%) / 646.65 (501.10 to 792.20, spread 45%) |
| CPU total p50 / p95 (ms) | 143.60 (141.70 to 145.50, spread 3%) / 295.90 (294.90 to 296.90, spread 1%) |
| GPU render p50 / p95 (ms) | n/a / n/a |
| Draw calls | 361 (361 to 361, spread 0%) |
| Triangles | 1281423 (1281423 to 1281423, spread 0%) |
| GPU memory ledger (bytes) | 281450190 (281450190 to 281450190, spread 0%) |
| JS heap (bytes) | 155352692 (154512101 to 156193282, spread 1%) |
| Pipelines after warm-up | n/a |
| Device losses | 0 (0 to 0, spread 0%) |

### CPU per step, p95 of windows (ms)

| Step | p95 |
| --- | --- |
| render | 295.90 (294.90 to 296.90, spread 1%) |

## Budget comparison (reports only; performance-reviewer decides)

| Budget | Source | Value | Limit | Margin | Status | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Frame interval (p95) | section 1 | 308.1 ms | 33.3 ms | -274.8 | FAIL | provisional hardware |
| Main-thread CPU per frame (p95) | section 2 | 295.9 ms | 15 ms | -280.9 | FAIL | provisional hardware |
| Render submit CPU (p95) | section 2 | 295.9 ms | 4.5 ms | -291.4 | FAIL | provisional hardware |
| Net ingest CPU (p95) | section 2 | 0 ms | 0.8 ms | 0.8 | PASS | provisional hardware |
| UI flush CPU (p95) | section 2 | 0 ms | 0.6 ms | 0.6 | PASS | provisional hardware |
| GPU frame time (p95) | section 3 | n/a ms | 28 ms | n/a | UNVERIFIED | CPU only: no GPU timer query on this backend |
| Draw calls per frame | section 4 | 361 calls | 350 calls | -11 | FAIL | provisional hardware |
| Triangles per frame | section 4 | 1281000 tris | 1000000 tris | -281400 | FAIL | provisional hardware |
| Pipelines created after warm-up | section 4 | n/a count | 0 count | n/a | UNVERIFIED | provisional hardware |
| GPU memory (engine ledger) | section 4 | 268.4 MB | 1024 MB | 755.6 | PASS | provisional hardware |
| JS heap used | section 4 | 148.2 MB | 300 MB | 151.8 | PASS | provisional hardware |
| Frame rate (median of runs) | section 1 | 6.491 FPS | 30 FPS | -23.51 | FAIL | provisional hardware |
