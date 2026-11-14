# Perf capture: bench / tier C / medium / webgpu

Created 2026-11-13T05:29:29.026Z. Milestone M0/sweep-med-webgpu-0.67. **PROVISIONAL hardware.**

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
| FPS | 21.2 (21.2 to 21.2, spread 0%) |
| Frame p50 / p95 / p99 (ms) | 47.50 (47.50 to 47.50, spread 0%) / 73.10 (73.10 to 73.10, spread 0%) / 100.40 (100.40 to 100.40, spread 0%) |
| CPU total p50 / p95 (ms) | 42.60 (42.60 to 42.60, spread 0%) / 55.00 (55.00 to 55.00, spread 0%) |
| GPU render p50 / p95 (ms) | 41.37 (41.37 to 41.37, spread 0%) / 43.74 (43.74 to 43.74, spread 0%) |
| Draw calls | 495 (495 to 495, spread 0%) |
| Triangles | 1004909 (1004909 to 1004909, spread 0%) |
| GPU memory ledger (bytes) | 131339690 (131339690 to 131339690, spread 0%) |
| JS heap (bytes) | 177429617 (177429617 to 177429617, spread 0%) |
| Pipelines after warm-up | n/a |
| Device losses | 0 (0 to 0, spread 0%) |

### CPU per step, p95 of windows (ms)

| Step | p95 |
| --- | --- |
| render | 55.00 (55.00 to 55.00, spread 0%) |

## Budget comparison (reports only; performance-reviewer decides)

| Budget | Source | Value | Limit | Margin | Status | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Frame interval (p95) | section 1 | 73.1 ms | 33.3 ms | -39.8 | FAIL | provisional hardware |
| Main-thread CPU per frame (p95) | section 2 | 55 ms | 15 ms | -40 | FAIL | provisional hardware |
| Render submit CPU (p95) | section 2 | 55 ms | 4.5 ms | -50.5 | FAIL | provisional hardware |
| Net ingest CPU (p95) | section 2 | 0 ms | 0.8 ms | 0.8 | PASS | provisional hardware |
| UI flush CPU (p95) | section 2 | 0 ms | 0.6 ms | 0.6 | PASS | provisional hardware |
| GPU frame time (p95) | section 3 | 43.74 ms | 28 ms | -15.74 | FAIL | provisional hardware |
| Draw calls per frame | section 4 | 495 calls | 350 calls | -145 | FAIL | provisional hardware |
| Triangles per frame | section 4 | 1005000 tris | 1000000 tris | -4909 | FAIL | provisional hardware |
| Pipelines created after warm-up | section 4 | n/a count | 0 count | n/a | UNVERIFIED | provisional hardware |
| GPU memory (engine ledger) | section 4 | 125.3 MB | 1024 MB | 898.7 | PASS | provisional hardware |
| JS heap used | section 4 | 169.2 MB | 300 MB | 130.8 | PASS | provisional hardware |
| Frame rate (median of runs) | section 1 | 21.25 FPS | 30 FPS | -8.75 | FAIL | provisional hardware |
