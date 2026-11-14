# Perf capture: bench / tier C / medium / webgl2

Created 2026-11-13T05:34:19.753Z. Milestone M0/sweep-med-webgl2-0.60. **PROVISIONAL hardware.**

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
| FPS | 25.5 (25.5 to 25.5, spread 0%) |
| Frame p50 / p95 / p99 (ms) | 38.60 (38.60 to 38.60, spread 0%) / 55.40 (55.40 to 55.40, spread 0%) / 100.00 (100.00 to 100.00, spread 0%) |
| CPU total p50 / p95 (ms) | 36.30 (36.30 to 36.30, spread 0%) / 51.80 (51.80 to 51.80, spread 0%) |
| GPU render p50 / p95 (ms) | n/a / n/a |
| Draw calls | 382 (382 to 382, spread 0%) |
| Triangles | 1005833 (1005833 to 1005833, spread 0%) |
| GPU memory ledger (bytes) | 168428766 (168428766 to 168428766, spread 0%) |
| JS heap (bytes) | 191600059 (191600059 to 191600059, spread 0%) |
| Pipelines after warm-up | n/a |
| Device losses | 0 (0 to 0, spread 0%) |

### CPU per step, p95 of windows (ms)

| Step | p95 |
| --- | --- |
| render | 51.80 (51.80 to 51.80, spread 0%) |
| ui | 0.10 (0.10 to 0.10, spread 0%) |

## Budget comparison (reports only; performance-reviewer decides)

| Budget | Source | Value | Limit | Margin | Status | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Frame interval (p95) | section 1 | 55.4 ms | 33.3 ms | -22.1 | FAIL | provisional hardware |
| Main-thread CPU per frame (p95) | section 2 | 51.8 ms | 15 ms | -36.8 | FAIL | provisional hardware |
| Render submit CPU (p95) | section 2 | 51.8 ms | 4.5 ms | -47.3 | FAIL | provisional hardware |
| Net ingest CPU (p95) | section 2 | 0 ms | 0.8 ms | 0.8 | PASS | provisional hardware |
| UI flush CPU (p95) | section 2 | 0.1 ms | 0.6 ms | 0.5 | PASS | provisional hardware |
| GPU frame time (p95) | section 3 | n/a ms | 28 ms | n/a | UNVERIFIED | CPU only: no GPU timer query on this backend |
| Draw calls per frame | section 4 | 382 calls | 350 calls | -32 | FAIL | provisional hardware |
| Triangles per frame | section 4 | 1006000 tris | 1000000 tris | -5833 | FAIL | provisional hardware |
| Pipelines created after warm-up | section 4 | n/a count | 0 count | n/a | UNVERIFIED | provisional hardware |
| GPU memory (engine ledger) | section 4 | 160.6 MB | 1024 MB | 863.4 | PASS | provisional hardware |
| JS heap used | section 4 | 182.7 MB | 300 MB | 117.3 | PASS | provisional hardware |
| Frame rate (median of runs) | section 1 | 25.52 FPS | 30 FPS | -4.483 | FAIL | provisional hardware |
