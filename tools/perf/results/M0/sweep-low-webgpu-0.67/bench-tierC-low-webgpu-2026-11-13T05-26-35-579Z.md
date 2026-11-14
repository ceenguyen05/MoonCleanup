# Perf capture: bench / tier C / low / webgpu

Created 2026-11-13T05:26:35.579Z. Milestone M0/sweep-low-webgpu-0.67. **PROVISIONAL hardware.**

## Machine

- CPU: Intel(R) Core(TM) i7-8650U CPU @ 1.90GHz (8 threads), RAM 15.9 GB
- GPU: ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)
- Browser: Chrome 157.0.8103.79; adapter flag: default
- OS: Windows_NT 10.0.26200 (x64); Node v26.13.1

## Method

Seed perf-1; camera path "orbit-v0"; 8 s warm-up discarded, 15 s capture; 1 run(s). Values are median over runs (min to max across runs). Frame statistics cover every frame of each run. CPU and GPU lines are medians of the HUD's 240-frame windows (labeled p50/p95 of those windows).
GPU timing source: **timestamp-query** (measured; per-pass split unavailable in three r187, one render total).

## Results

| Metric | Value |
| --- | --- |
| FPS | 22.2 (22.2 to 22.2, spread 0%) |
| Frame p50 / p95 / p99 (ms) | 46.70 (46.70 to 46.70, spread 0%) / 66.00 (66.00 to 66.00, spread 0%) / 99.10 (99.10 to 99.10, spread 0%) |
| CPU total p50 / p95 (ms) | 40.70 (40.70 to 40.70, spread 0%) / 49.60 (49.60 to 49.60, spread 0%) |
| GPU render p50 / p95 (ms) | 40.90 (40.90 to 40.90, spread 0%) / 41.85 (41.85 to 41.85, spread 0%) |
| Draw calls | 429 (429 to 429, spread 0%) |
| Triangles | 759533 (759533 to 759533, spread 0%) |
| GPU memory ledger (bytes) | 141162271 (141162271 to 141162271, spread 0%) |
| JS heap (bytes) | 143772553 (143772553 to 143772553, spread 0%) |
| Pipelines after warm-up | n/a |
| Device losses | 0 (0 to 0, spread 0%) |

### CPU per step, p95 of windows (ms)

| Step | p95 |
| --- | --- |
| render | 49.50 (49.50 to 49.50, spread 0%) |
| ui | 0.10 (0.10 to 0.10, spread 0%) |

## Budget comparison (reports only; performance-reviewer decides)

| Budget | Source | Value | Limit | Margin | Status | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Frame interval (p95) | section 1 | 66 ms | 33.3 ms | -32.7 | FAIL | provisional hardware |
| Main-thread CPU per frame (p95) | section 2 | 49.6 ms | 15 ms | -34.6 | FAIL | provisional hardware |
| Render submit CPU (p95) | section 2 | 49.5 ms | 4.5 ms | -45 | FAIL | provisional hardware |
| Net ingest CPU (p95) | section 2 | 0 ms | 0.8 ms | 0.8 | PASS | provisional hardware |
| UI flush CPU (p95) | section 2 | 0.1 ms | 0.6 ms | 0.5 | PASS | provisional hardware |
| GPU frame time (p95) | section 3 | 41.85 ms | 28 ms | -13.85 | FAIL | provisional hardware |
| Draw calls per frame | section 4 | 429 calls | 350 calls | -79 | FAIL | provisional hardware |
| Triangles per frame | section 4 | 759500 tris | 1000000 tris | 240500 | PASS | provisional hardware |
| Pipelines created after warm-up | section 4 | n/a count | 0 count | n/a | UNVERIFIED | provisional hardware |
| GPU memory (engine ledger) | section 4 | 134.6 MB | 1024 MB | 889.4 | PASS | provisional hardware |
| JS heap used | section 4 | 137.1 MB | 300 MB | 162.9 | PASS | provisional hardware |
| Frame rate (median of runs) | section 1 | 22.17 FPS | 30 FPS | -7.832 | FAIL | provisional hardware |
