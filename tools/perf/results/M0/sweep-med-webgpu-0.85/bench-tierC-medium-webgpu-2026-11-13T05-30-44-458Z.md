# Perf capture: bench / tier C / medium / webgpu

Created 2026-11-13T05:30:44.458Z. Milestone M0/sweep-med-webgpu-0.85. **PROVISIONAL hardware.**

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
| FPS | 14.8 (14.8 to 14.8, spread 0%) |
| Frame p50 / p95 / p99 (ms) | 66.10 (66.10 to 66.10, spread 0%) / 89.20 (89.20 to 89.20, spread 0%) / 99.00 (99.00 to 99.00, spread 0%) |
| CPU total p50 / p95 (ms) | 63.30 (63.30 to 63.30, spread 0%) / 72.50 (72.50 to 72.50, spread 0%) |
| GPU render p50 / p95 (ms) | 61.49 (61.49 to 61.49, spread 0%) / 65.38 (65.38 to 65.38, spread 0%) |
| Draw calls | 494 (494 to 494, spread 0%) |
| Triangles | 1006973 (1006973 to 1006973, spread 0%) |
| GPU memory ledger (bytes) | 177388534 (177388534 to 177388534, spread 0%) |
| JS heap (bytes) | 140923270 (140923270 to 140923270, spread 0%) |
| Pipelines after warm-up | n/a |
| Device losses | 0 (0 to 0, spread 0%) |

### CPU per step, p95 of windows (ms)

| Step | p95 |
| --- | --- |
| render | 72.50 (72.50 to 72.50, spread 0%) |
| ui | 0.10 (0.10 to 0.10, spread 0%) |

## Budget comparison (reports only; performance-reviewer decides)

| Budget | Source | Value | Limit | Margin | Status | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Frame interval (p95) | section 1 | 89.2 ms | 33.3 ms | -55.9 | FAIL | provisional hardware |
| Main-thread CPU per frame (p95) | section 2 | 72.5 ms | 15 ms | -57.5 | FAIL | provisional hardware |
| Render submit CPU (p95) | section 2 | 72.5 ms | 4.5 ms | -68 | FAIL | provisional hardware |
| Net ingest CPU (p95) | section 2 | 0 ms | 0.8 ms | 0.8 | PASS | provisional hardware |
| UI flush CPU (p95) | section 2 | 0.1 ms | 0.6 ms | 0.5 | PASS | provisional hardware |
| GPU frame time (p95) | section 3 | 65.38 ms | 28 ms | -37.38 | FAIL | provisional hardware |
| Draw calls per frame | section 4 | 494 calls | 350 calls | -144 | FAIL | provisional hardware |
| Triangles per frame | section 4 | 1007000 tris | 1000000 tris | -6973 | FAIL | provisional hardware |
| Pipelines created after warm-up | section 4 | n/a count | 0 count | n/a | UNVERIFIED | provisional hardware |
| GPU memory (engine ledger) | section 4 | 169.2 MB | 1024 MB | 854.8 | PASS | provisional hardware |
| JS heap used | section 4 | 134.4 MB | 300 MB | 165.6 | PASS | provisional hardware |
| Frame rate (median of runs) | section 1 | 14.82 FPS | 30 FPS | -15.18 | FAIL | provisional hardware |
