# Perf capture: bench / tier C / low / webgl2

Created 2026-11-13T05:32:08.745Z. Milestone M0/sweep-low-webgl2-0.67. **PROVISIONAL hardware.**

## Machine

- CPU: Intel(R) Core(TM) i7-8650U CPU @ 1.90GHz (8 threads), RAM 15.9 GB
- GPU: ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)
- Browser: Chrome 157.0.8103.79; adapter flag: default
- OS: Windows_NT 10.0.26200 (x64); Node v26.13.1

## Method

Seed perf-1; camera path "orbit-v0"; 8 s warm-up discarded, 15 s capture; 1 run(s). Values are median over runs (min to max across runs). Frame statistics cover every frame of each run. CPU and GPU lines are medians of the HUD's 240-frame windows (labeled p50/p95 of those windows).
GPU timing source: **none** (CPU only: GPU numbers are absent, not estimated).

## Results

| Metric | Value |
| --- | --- |
| FPS | 24.9 (24.9 to 24.9, spread 0%) |
| Frame p50 / p95 / p99 (ms) | 35.80 (35.80 to 35.80, spread 0%) / 71.80 (71.80 to 71.80, spread 0%) / 151.70 (151.70 to 151.70, spread 0%) |
| CPU total p50 / p95 (ms) | 37.00 (37.00 to 37.00, spread 0%) / 56.80 (56.80 to 56.80, spread 0%) |
| GPU render p50 / p95 (ms) | n/a / n/a |
| Draw calls | 382 (382 to 382, spread 0%) |
| Triangles | 758385 (758385 to 758385, spread 0%) |
| GPU memory ledger (bytes) | 141208320 (141208320 to 141208320, spread 0%) |
| JS heap (bytes) | 141487569 (141487569 to 141487569, spread 0%) |
| Pipelines after warm-up | n/a |
| Device losses | 0 (0 to 0, spread 0%) |

### CPU per step, p95 of windows (ms)

| Step | p95 |
| --- | --- |
| render | 56.80 (56.80 to 56.80, spread 0%) |

## Budget comparison (reports only; performance-reviewer decides)

| Budget | Source | Value | Limit | Margin | Status | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Frame interval (p95) | section 1 | 71.8 ms | 33.3 ms | -38.5 | FAIL | provisional hardware |
| Main-thread CPU per frame (p95) | section 2 | 56.8 ms | 15 ms | -41.8 | FAIL | provisional hardware |
| Render submit CPU (p95) | section 2 | 56.8 ms | 4.5 ms | -52.3 | FAIL | provisional hardware |
| Net ingest CPU (p95) | section 2 | 0 ms | 0.8 ms | 0.8 | PASS | provisional hardware |
| UI flush CPU (p95) | section 2 | 0 ms | 0.6 ms | 0.6 | PASS | provisional hardware |
| GPU frame time (p95) | section 3 | n/a ms | 28 ms | n/a | UNVERIFIED | CPU only: no GPU timer query on this backend |
| Draw calls per frame | section 4 | 382 calls | 350 calls | -32 | FAIL | provisional hardware |
| Triangles per frame | section 4 | 758400 tris | 1000000 tris | 241600 | PASS | provisional hardware |
| Pipelines created after warm-up | section 4 | n/a count | 0 count | n/a | UNVERIFIED | provisional hardware |
| GPU memory (engine ledger) | section 4 | 134.7 MB | 1024 MB | 889.3 | PASS | provisional hardware |
| JS heap used | section 4 | 134.9 MB | 300 MB | 165.1 | PASS | provisional hardware |
| Frame rate (median of runs) | section 1 | 24.86 FPS | 30 FPS | -5.14 | FAIL | provisional hardware |
