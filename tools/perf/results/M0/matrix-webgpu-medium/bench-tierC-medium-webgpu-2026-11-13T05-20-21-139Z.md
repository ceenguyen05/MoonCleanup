# Perf capture: bench / tier C / medium / webgpu

Created 2026-11-13T05:20:21.139Z. Milestone M0/matrix-webgpu-medium. **PROVISIONAL hardware.**

## Machine

- CPU: Intel(R) Core(TM) i7-8650U CPU @ 1.90GHz (8 threads), RAM 15.9 GB
- GPU: ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)
- Browser: Chrome 157.0.8103.79; adapter flag: default
- OS: Windows_NT 10.0.26200 (x64); Node v26.13.1

## Method

Seed perf-1; camera path "orbit-v0"; 8 s warm-up discarded, 15 s capture; 2 run(s). Values are median over runs (min to max across runs). Frame statistics cover every frame of each run. CPU and GPU lines are medians of the HUD's 240-frame windows (labeled p50/p95 of those windows).
GPU timing source: **timestamp-query** (measured; per-pass split unavailable in three r187, one render total).

## Results

| Metric | Value |
| --- | --- |
| FPS | 17.0 (17.0 to 17.1, spread 1%) |
| Frame p50 / p95 / p99 (ms) | 58.85 (58.70 to 59.00, spread 1%) / 69.25 (69.10 to 69.40, spread 0%) / 71.35 (70.70 to 72.00, spread 2%) |
| CPU total p50 / p95 (ms) | 55.75 (55.60 to 55.90, spread 1%) / 60.25 (59.70 to 60.80, spread 2%) |
| GPU render p50 / p95 (ms) | n/a / n/a |
| Draw calls | 483 (482 to 483, spread 0%) |
| Triangles | 1009027 (1008781 to 1009273, spread 0%) |
| GPU memory ledger (bytes) | 177383910 (177383910 to 177383910, spread 0%) |
| JS heap (bytes) | 179966160 (178873996 to 181058324, spread 1%) |
| Pipelines after warm-up | n/a |
| Device losses | 0 (0 to 0, spread 0%) |

### CPU per step, p95 of windows (ms)

| Step | p95 |
| --- | --- |
| render | 60.25 (59.70 to 60.80, spread 2%) |

## Budget comparison (reports only; performance-reviewer decides)

| Budget | Source | Value | Limit | Margin | Status | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Frame interval (p95) | section 1 | 69.25 ms | 33.3 ms | -35.95 | FAIL | provisional hardware |
| Main-thread CPU per frame (p95) | section 2 | 60.25 ms | 15 ms | -45.25 | FAIL | provisional hardware |
| Render submit CPU (p95) | section 2 | 60.25 ms | 4.5 ms | -55.75 | FAIL | provisional hardware |
| Net ingest CPU (p95) | section 2 | 0 ms | 0.8 ms | 0.8 | PASS | provisional hardware |
| UI flush CPU (p95) | section 2 | 0 ms | 0.6 ms | 0.6 | PASS | provisional hardware |
| GPU frame time (p95) | section 3 | n/a ms | 28 ms | n/a | UNVERIFIED | provisional hardware |
| Draw calls per frame | section 4 | 482.5 calls | 350 calls | -132.5 | FAIL | provisional hardware |
| Triangles per frame | section 4 | 1009000 tris | 1000000 tris | -9027 | FAIL | provisional hardware |
| Pipelines created after warm-up | section 4 | n/a count | 0 count | n/a | UNVERIFIED | provisional hardware |
| GPU memory (engine ledger) | section 4 | 169.2 MB | 1024 MB | 854.8 | PASS | provisional hardware |
| JS heap used | section 4 | 171.6 MB | 300 MB | 128.4 | PASS | provisional hardware |
| Frame rate (median of runs) | section 1 | 17.02 FPS | 30 FPS | -12.98 | FAIL | provisional hardware |
