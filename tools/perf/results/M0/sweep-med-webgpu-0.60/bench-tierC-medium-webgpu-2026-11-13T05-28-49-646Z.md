# Perf capture: bench / tier C / medium / webgpu

Created 2026-11-13T05:28:49.646Z. Milestone M0/sweep-med-webgpu-0.60. **PROVISIONAL hardware.**

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
| FPS | 22.5 (22.5 to 22.5, spread 0%) |
| Frame p50 / p95 / p99 (ms) | 47.50 (47.50 to 47.50, spread 0%) / 58.00 (58.00 to 58.00, spread 0%) / 74.00 (74.00 to 74.00, spread 0%) |
| CPU total p50 / p95 (ms) | 41.10 (41.10 to 41.10, spread 0%) / 46.50 (46.50 to 46.50, spread 0%) |
| GPU render p50 / p95 (ms) | n/a / n/a |
| Draw calls | 493 (493 to 493, spread 0%) |
| Triangles | 1002585 (1002585 to 1002585, spread 0%) |
| GPU memory ledger (bytes) | 168368374 (168368374 to 168368374, spread 0%) |
| JS heap (bytes) | 142929775 (142929775 to 142929775, spread 0%) |
| Pipelines after warm-up | n/a |
| Device losses | 0 (0 to 0, spread 0%) |

### CPU per step, p95 of windows (ms)

| Step | p95 |
| --- | --- |
| render | 46.50 (46.50 to 46.50, spread 0%) |

## Budget comparison (reports only; performance-reviewer decides)

| Budget | Source | Value | Limit | Margin | Status | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Frame interval (p95) | section 1 | 58 ms | 33.3 ms | -24.7 | FAIL | provisional hardware |
| Main-thread CPU per frame (p95) | section 2 | 46.5 ms | 15 ms | -31.5 | FAIL | provisional hardware |
| Render submit CPU (p95) | section 2 | 46.5 ms | 4.5 ms | -42 | FAIL | provisional hardware |
| Net ingest CPU (p95) | section 2 | 0 ms | 0.8 ms | 0.8 | PASS | provisional hardware |
| UI flush CPU (p95) | section 2 | 0 ms | 0.6 ms | 0.6 | PASS | provisional hardware |
| GPU frame time (p95) | section 3 | n/a ms | 28 ms | n/a | UNVERIFIED | provisional hardware |
| Draw calls per frame | section 4 | 493 calls | 350 calls | -143 | FAIL | provisional hardware |
| Triangles per frame | section 4 | 1003000 tris | 1000000 tris | -2585 | FAIL | provisional hardware |
| Pipelines created after warm-up | section 4 | n/a count | 0 count | n/a | UNVERIFIED | provisional hardware |
| GPU memory (engine ledger) | section 4 | 160.6 MB | 1024 MB | 863.4 | PASS | provisional hardware |
| JS heap used | section 4 | 136.3 MB | 300 MB | 163.7 | PASS | provisional hardware |
| Frame rate (median of runs) | section 1 | 22.49 FPS | 30 FPS | -7.513 | FAIL | provisional hardware |
