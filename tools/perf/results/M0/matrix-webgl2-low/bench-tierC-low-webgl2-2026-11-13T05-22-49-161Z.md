# Perf capture: bench / tier C / low / webgl2

Created 2026-11-13T05:22:49.161Z. Milestone M0/matrix-webgl2-low. **PROVISIONAL hardware.**

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
| FPS | 22.1 (21.9 to 22.4, spread 3%) |
| Frame p50 / p95 / p99 (ms) | 44.55 (42.20 to 46.90, spread 11%) / 79.55 (79.40 to 79.70, spread 0%) / 287.80 (278.30 to 297.30, spread 7%) |
| CPU total p50 / p95 (ms) | 41.25 (40.80 to 41.70, spread 2%) / 73.20 (70.00 to 76.40, spread 9%) |
| GPU render p50 / p95 (ms) | n/a / n/a |
| Draw calls | 351 (350 to 351, spread 0%) |
| Triangles | 760893 (760169 to 761617, spread 0%) |
| GPU memory ledger (bytes) | 165045348 (165044764 to 165045932, spread 0%) |
| JS heap (bytes) | 146005228 (144637152 to 147373304, spread 2%) |
| Pipelines after warm-up | n/a |
| Device losses | 0 (0 to 0, spread 0%) |

### CPU per step, p95 of windows (ms)

| Step | p95 |
| --- | --- |
| render | 73.20 (70.00 to 76.40, spread 9%) |

## Budget comparison (reports only; performance-reviewer decides)

| Budget | Source | Value | Limit | Margin | Status | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Frame interval (p95) | section 1 | 79.55 ms | 33.3 ms | -46.25 | FAIL | provisional hardware |
| Main-thread CPU per frame (p95) | section 2 | 73.2 ms | 15 ms | -58.2 | FAIL | provisional hardware |
| Render submit CPU (p95) | section 2 | 73.2 ms | 4.5 ms | -68.7 | FAIL | provisional hardware |
| Net ingest CPU (p95) | section 2 | 0 ms | 0.8 ms | 0.8 | PASS | provisional hardware |
| UI flush CPU (p95) | section 2 | 0 ms | 0.6 ms | 0.6 | PASS | provisional hardware |
| GPU frame time (p95) | section 3 | n/a ms | 28 ms | n/a | UNVERIFIED | CPU only: no GPU timer query on this backend |
| Draw calls per frame | section 4 | 350.5 calls | 350 calls | -0.5 | FAIL | provisional hardware |
| Triangles per frame | section 4 | 760900 tris | 1000000 tris | 239100 | PASS | provisional hardware |
| Pipelines created after warm-up | section 4 | n/a count | 0 count | n/a | UNVERIFIED | provisional hardware |
| GPU memory (engine ledger) | section 4 | 157.4 MB | 1024 MB | 866.6 | PASS | provisional hardware |
| JS heap used | section 4 | 139.2 MB | 300 MB | 160.8 | PASS | provisional hardware |
| Frame rate (median of runs) | section 1 | 22.15 FPS | 30 FPS | -7.852 | FAIL | provisional hardware |
