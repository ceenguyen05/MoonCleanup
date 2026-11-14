# Perf capture: bench / tier C / medium / webgl2

Created 2026-11-13T05:24:01.879Z. Milestone M0/matrix-webgl2-medium. **PROVISIONAL hardware.**

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
| FPS | 19.1 (19.1 to 19.1, spread 0%) |
| Frame p50 / p95 / p99 (ms) | 49.15 (47.70 to 50.60, spread 6%) / 76.55 (72.50 to 80.60, spread 11%) / 147.90 (124.30 to 171.50, spread 32%) |
| CPU total p50 / p95 (ms) | 49.95 (49.80 to 50.10, spread 1%) / 67.25 (60.80 to 73.70, spread 19%) |
| GPU render p50 / p95 (ms) | n/a / n/a |
| Draw calls | 350 (349 to 350, spread 0%) |
| Triangles | 1010343 (1009333 to 1011353, spread 0%) |
| GPU memory ledger (bytes) | 177439238 (177438926 to 177439550, spread 0%) |
| JS heap (bytes) | 143578348 (142931533 to 144225162, spread 1%) |
| Pipelines after warm-up | n/a |
| Device losses | 0 (0 to 0, spread 0%) |

### CPU per step, p95 of windows (ms)

| Step | p95 |
| --- | --- |
| render | 67.25 (60.80 to 73.70, spread 19%) |
| ui | 0.05 (0.00 to 0.10, spread 200%) |

## Budget comparison (reports only; performance-reviewer decides)

| Budget | Source | Value | Limit | Margin | Status | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Frame interval (p95) | section 1 | 76.55 ms | 33.3 ms | -43.25 | FAIL | provisional hardware |
| Main-thread CPU per frame (p95) | section 2 | 67.25 ms | 15 ms | -52.25 | FAIL | provisional hardware |
| Render submit CPU (p95) | section 2 | 67.25 ms | 4.5 ms | -62.75 | FAIL | provisional hardware |
| Net ingest CPU (p95) | section 2 | 0 ms | 0.8 ms | 0.8 | PASS | provisional hardware |
| UI flush CPU (p95) | section 2 | 0.05 ms | 0.6 ms | 0.55 | PASS | provisional hardware |
| GPU frame time (p95) | section 3 | n/a ms | 28 ms | n/a | UNVERIFIED | CPU only: no GPU timer query on this backend |
| Draw calls per frame | section 4 | 349.5 calls | 350 calls | 0.5 | PASS | provisional hardware |
| Triangles per frame | section 4 | 1010000 tris | 1000000 tris | -10340 | FAIL | provisional hardware |
| Pipelines created after warm-up | section 4 | n/a count | 0 count | n/a | UNVERIFIED | provisional hardware |
| GPU memory (engine ledger) | section 4 | 169.2 MB | 1024 MB | 854.8 | PASS | provisional hardware |
| JS heap used | section 4 | 136.9 MB | 300 MB | 163.1 | PASS | provisional hardware |
| Frame rate (median of runs) | section 1 | 19.09 FPS | 30 FPS | -10.91 | FAIL | provisional hardware |
