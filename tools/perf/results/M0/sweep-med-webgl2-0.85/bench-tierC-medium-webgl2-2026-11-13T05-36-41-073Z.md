# Perf capture: bench / tier C / medium / webgl2

Created 2026-11-13T05:36:41.073Z. Milestone M0/sweep-med-webgl2-0.85. **PROVISIONAL hardware.**

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
| FPS | 17.0 (17.0 to 17.0, spread 0%) |
| Frame p50 / p95 / p99 (ms) | 58.90 (58.90 to 58.90, spread 0%) / 76.90 (76.90 to 76.90, spread 0%) / 133.00 (133.00 to 133.00, spread 0%) |
| CPU total p50 / p95 (ms) | 56.10 (56.10 to 56.10, spread 0%) / 83.00 (83.00 to 83.00, spread 0%) |
| GPU render p50 / p95 (ms) | n/a / n/a |
| Draw calls | 381 (381 to 381, spread 0%) |
| Triangles | 1005833 (1005833 to 1005833, spread 0%) |
| GPU memory ledger (bytes) | 177448926 (177448926 to 177448926, spread 0%) |
| JS heap (bytes) | 139140132 (139140132 to 139140132, spread 0%) |
| Pipelines after warm-up | n/a |
| Device losses | 0 (0 to 0, spread 0%) |

### CPU per step, p95 of windows (ms)

| Step | p95 |
| --- | --- |
| render | 83.00 (83.00 to 83.00, spread 0%) |

## Budget comparison (reports only; performance-reviewer decides)

| Budget | Source | Value | Limit | Margin | Status | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Frame interval (p95) | section 1 | 76.9 ms | 33.3 ms | -43.6 | FAIL | provisional hardware |
| Main-thread CPU per frame (p95) | section 2 | 83 ms | 15 ms | -68 | FAIL | provisional hardware |
| Render submit CPU (p95) | section 2 | 83 ms | 4.5 ms | -78.5 | FAIL | provisional hardware |
| Net ingest CPU (p95) | section 2 | 0 ms | 0.8 ms | 0.8 | PASS | provisional hardware |
| UI flush CPU (p95) | section 2 | 0 ms | 0.6 ms | 0.6 | PASS | provisional hardware |
| GPU frame time (p95) | section 3 | n/a ms | 28 ms | n/a | UNVERIFIED | CPU only: no GPU timer query on this backend |
| Draw calls per frame | section 4 | 381 calls | 350 calls | -31 | FAIL | provisional hardware |
| Triangles per frame | section 4 | 1006000 tris | 1000000 tris | -5833 | FAIL | provisional hardware |
| Pipelines created after warm-up | section 4 | n/a count | 0 count | n/a | UNVERIFIED | provisional hardware |
| GPU memory (engine ledger) | section 4 | 169.2 MB | 1024 MB | 854.8 | PASS | provisional hardware |
| JS heap used | section 4 | 132.7 MB | 300 MB | 167.3 | PASS | provisional hardware |
| Frame rate (median of runs) | section 1 | 16.95 FPS | 30 FPS | -13.05 | FAIL | provisional hardware |
