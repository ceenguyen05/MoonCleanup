# Perf capture: bench / tier C / medium / webgl2

Created 2026-11-13T05:33:38.261Z. Milestone M0/sweep-med-webgl2-0.50. **PROVISIONAL hardware.**

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
| FPS | 37.1 (37.1 to 37.1, spread 0%) |
| Frame p50 / p95 / p99 (ms) | 26.40 (26.40 to 26.40, spread 0%) / 48.30 (48.30 to 48.30, spread 0%) / 66.70 (66.70 to 66.70, spread 0%) |
| CPU total p50 / p95 (ms) | 23.10 (23.10 to 23.10, spread 0%) / 36.80 (36.80 to 36.80, spread 0%) |
| GPU render p50 / p95 (ms) | n/a / n/a |
| Draw calls | 384 (384 to 384, spread 0%) |
| Triangles | 1005833 (1005833 to 1005833, spread 0%) |
| GPU memory ledger (bytes) | 98023510 (98023510 to 98023510, spread 0%) |
| JS heap (bytes) | 179617615 (179617615 to 179617615, spread 0%) |
| Pipelines after warm-up | n/a |
| Device losses | 0 (0 to 0, spread 0%) |

### CPU per step, p95 of windows (ms)

| Step | p95 |
| --- | --- |
| render | 36.80 (36.80 to 36.80, spread 0%) |

## Budget comparison (reports only; performance-reviewer decides)

| Budget | Source | Value | Limit | Margin | Status | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Frame interval (p95) | section 1 | 48.3 ms | 33.3 ms | -15 | FAIL | provisional hardware |
| Main-thread CPU per frame (p95) | section 2 | 36.8 ms | 15 ms | -21.8 | FAIL | provisional hardware |
| Render submit CPU (p95) | section 2 | 36.8 ms | 4.5 ms | -32.3 | FAIL | provisional hardware |
| Net ingest CPU (p95) | section 2 | 0 ms | 0.8 ms | 0.8 | PASS | provisional hardware |
| UI flush CPU (p95) | section 2 | 0 ms | 0.6 ms | 0.6 | PASS | provisional hardware |
| GPU frame time (p95) | section 3 | n/a ms | 28 ms | n/a | UNVERIFIED | CPU only: no GPU timer query on this backend |
| Draw calls per frame | section 4 | 384 calls | 350 calls | -34 | FAIL | provisional hardware |
| Triangles per frame | section 4 | 1006000 tris | 1000000 tris | -5833 | FAIL | provisional hardware |
| Pipelines created after warm-up | section 4 | n/a count | 0 count | n/a | UNVERIFIED | provisional hardware |
| GPU memory (engine ledger) | section 4 | 93.48 MB | 1024 MB | 930.5 | PASS | provisional hardware |
| JS heap used | section 4 | 171.3 MB | 300 MB | 128.7 | PASS | provisional hardware |
| Frame rate (median of runs) | section 1 | 37.09 FPS | 30 FPS | 7.089 | PASS | provisional hardware |
