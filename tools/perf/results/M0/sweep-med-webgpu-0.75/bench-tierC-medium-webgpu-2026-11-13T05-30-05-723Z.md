# Perf capture: bench / tier C / medium / webgpu

Created 2026-11-13T05:30:05.723Z. Milestone M0/sweep-med-webgpu-0.75. **PROVISIONAL hardware.**

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
| FPS | 19.6 (19.6 to 19.6, spread 0%) |
| Frame p50 / p95 / p99 (ms) | 49.80 (49.80 to 49.80, spread 0%) / 69.20 (69.20 to 69.20, spread 0%) / 72.00 (72.00 to 72.00, spread 0%) |
| CPU total p50 / p95 (ms) | 47.50 (47.50 to 47.50, spread 0%) / 53.00 (53.00 to 53.00, spread 0%) |
| GPU render p50 / p95 (ms) | 46.46 (46.46 to 46.46, spread 0%) / 46.82 (46.82 to 46.82, spread 0%) |
| Draw calls | 493 (493 to 493, spread 0%) |
| Triangles | 1002585 (1002585 to 1002585, spread 0%) |
| GPU memory ledger (bytes) | 150360954 (150360954 to 150360954, spread 0%) |
| JS heap (bytes) | 178871109 (178871109 to 178871109, spread 0%) |
| Pipelines after warm-up | n/a |
| Device losses | 0 (0 to 0, spread 0%) |

### CPU per step, p95 of windows (ms)

| Step | p95 |
| --- | --- |
| render | 53.00 (53.00 to 53.00, spread 0%) |

## Budget comparison (reports only; performance-reviewer decides)

| Budget | Source | Value | Limit | Margin | Status | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Frame interval (p95) | section 1 | 69.2 ms | 33.3 ms | -35.9 | FAIL | provisional hardware |
| Main-thread CPU per frame (p95) | section 2 | 53 ms | 15 ms | -38 | FAIL | provisional hardware |
| Render submit CPU (p95) | section 2 | 53 ms | 4.5 ms | -48.5 | FAIL | provisional hardware |
| Net ingest CPU (p95) | section 2 | 0 ms | 0.8 ms | 0.8 | PASS | provisional hardware |
| UI flush CPU (p95) | section 2 | 0 ms | 0.6 ms | 0.6 | PASS | provisional hardware |
| GPU frame time (p95) | section 3 | 46.82 ms | 28 ms | -18.82 | FAIL | provisional hardware |
| Draw calls per frame | section 4 | 493 calls | 350 calls | -143 | FAIL | provisional hardware |
| Triangles per frame | section 4 | 1003000 tris | 1000000 tris | -2585 | FAIL | provisional hardware |
| Pipelines created after warm-up | section 4 | n/a count | 0 count | n/a | UNVERIFIED | provisional hardware |
| GPU memory (engine ledger) | section 4 | 143.4 MB | 1024 MB | 880.6 | PASS | provisional hardware |
| JS heap used | section 4 | 170.6 MB | 300 MB | 129.4 | PASS | provisional hardware |
| Frame rate (median of runs) | section 1 | 19.63 FPS | 30 FPS | -10.37 | FAIL | provisional hardware |
