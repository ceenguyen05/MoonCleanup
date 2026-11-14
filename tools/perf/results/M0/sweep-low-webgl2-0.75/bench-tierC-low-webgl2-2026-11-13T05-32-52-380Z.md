# Perf capture: bench / tier C / low / webgl2

Created 2026-11-13T05:32:52.380Z. Milestone M0/sweep-low-webgl2-0.75. **PROVISIONAL hardware.**

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
| FPS | 21.6 (21.6 to 21.6, spread 0%) |
| Frame p50 / p95 / p99 (ms) | 45.20 (45.20 to 45.20, spread 0%) / 81.50 (81.50 to 81.50, spread 0%) / 135.20 (135.20 to 135.20, spread 0%) |
| CPU total p50 / p95 (ms) | 43.70 (43.70 to 43.70, spread 0%) / 75.30 (75.30 to 75.30, spread 0%) |
| GPU render p50 / p95 (ms) | n/a / n/a |
| Draw calls | 381 (381 to 381, spread 0%) |
| Triangles | 758385 (758385 to 758385, spread 0%) |
| GPU memory ledger (bytes) | 165055020 (165055020 to 165055020, spread 0%) |
| JS heap (bytes) | 140310095 (140310095 to 140310095, spread 0%) |
| Pipelines after warm-up | n/a |
| Device losses | 0 (0 to 0, spread 0%) |

### CPU per step, p95 of windows (ms)

| Step | p95 |
| --- | --- |
| render | 75.30 (75.30 to 75.30, spread 0%) |

## Budget comparison (reports only; performance-reviewer decides)

| Budget | Source | Value | Limit | Margin | Status | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Frame interval (p95) | section 1 | 81.5 ms | 33.3 ms | -48.2 | FAIL | provisional hardware |
| Main-thread CPU per frame (p95) | section 2 | 75.3 ms | 15 ms | -60.3 | FAIL | provisional hardware |
| Render submit CPU (p95) | section 2 | 75.3 ms | 4.5 ms | -70.8 | FAIL | provisional hardware |
| Net ingest CPU (p95) | section 2 | 0 ms | 0.8 ms | 0.8 | PASS | provisional hardware |
| UI flush CPU (p95) | section 2 | 0 ms | 0.6 ms | 0.6 | PASS | provisional hardware |
| GPU frame time (p95) | section 3 | n/a ms | 28 ms | n/a | UNVERIFIED | CPU only: no GPU timer query on this backend |
| Draw calls per frame | section 4 | 381 calls | 350 calls | -31 | FAIL | provisional hardware |
| Triangles per frame | section 4 | 758400 tris | 1000000 tris | 241600 | PASS | provisional hardware |
| Pipelines created after warm-up | section 4 | n/a count | 0 count | n/a | UNVERIFIED | provisional hardware |
| GPU memory (engine ledger) | section 4 | 157.4 MB | 1024 MB | 866.6 | PASS | provisional hardware |
| JS heap used | section 4 | 133.8 MB | 300 MB | 166.2 | PASS | provisional hardware |
| Frame rate (median of runs) | section 1 | 21.61 FPS | 30 FPS | -8.39 | FAIL | provisional hardware |
