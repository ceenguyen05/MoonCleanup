# Perf capture: bench / tier C / high / webgpu

Created 2026-11-13T05:21:37.148Z. Milestone M0/matrix-webgpu-high. **PROVISIONAL hardware.**

## Machine

- CPU: Intel(R) Core(TM) i7-8650U CPU @ 1.90GHz (8 threads), RAM 15.9 GB
- GPU: ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)
- Browser: Chrome 157.0.8103.79; adapter flag: default
- OS: Windows_NT 10.0.26200 (x64); Node v26.13.1

## Method

Seed perf-1; camera path "orbit-v0"; 8 s warm-up discarded, 15 s capture; 2 run(s). Values are median over runs (min to max across runs). Frame statistics cover every frame of each run. CPU and GPU lines are medians of the HUD's 240-frame windows (labeled p50/p95 of those windows).
GPU timing source: **timestamp-query** (measured; per-pass split unavailable in three r187, one render total).

## Results

| Metric | Value |
| --- | --- |
| FPS | 6.2 (6.1 to 6.4, spread 4%) |
| Frame p50 / p95 / p99 (ms) | 154.80 (152.40 to 157.20, spread 3%) / 211.30 (205.40 to 217.20, spread 6%) / 233.00 (228.20 to 237.80, spread 4%) |
| CPU total p50 / p95 (ms) | 155.05 (148.90 to 161.20, spread 8%) / 179.45 (171.60 to 187.30, spread 9%) |
| GPU render p50 / p95 (ms) | n/a / n/a |
| Draw calls | 597 (596 to 597, spread 0%) |
| Triangles | 1279537 (1279379 to 1279695, spread 0%) |
| GPU memory ledger (bytes) | 281401576 (281401576 to 281401576, spread 0%) |
| JS heap (bytes) | 156905983 (156295833 to 157516133, spread 1%) |
| Pipelines after warm-up | n/a |
| Device losses | 0 (0 to 0, spread 0%) |

### CPU per step, p95 of windows (ms)

| Step | p95 |
| --- | --- |
| render | 179.45 (171.60 to 187.30, spread 9%) |

## Budget comparison (reports only; performance-reviewer decides)

| Budget | Source | Value | Limit | Margin | Status | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Frame interval (p95) | section 1 | 211.3 ms | 33.3 ms | -178 | FAIL | provisional hardware |
| Main-thread CPU per frame (p95) | section 2 | 179.5 ms | 15 ms | -164.5 | FAIL | provisional hardware |
| Render submit CPU (p95) | section 2 | 179.5 ms | 4.5 ms | -175 | FAIL | provisional hardware |
| Net ingest CPU (p95) | section 2 | 0 ms | 0.8 ms | 0.8 | PASS | provisional hardware |
| UI flush CPU (p95) | section 2 | 0 ms | 0.6 ms | 0.6 | PASS | provisional hardware |
| GPU frame time (p95) | section 3 | n/a ms | 28 ms | n/a | UNVERIFIED | provisional hardware |
| Draw calls per frame | section 4 | 596.5 calls | 350 calls | -246.5 | FAIL | provisional hardware |
| Triangles per frame | section 4 | 1280000 tris | 1000000 tris | -279500 | FAIL | provisional hardware |
| Pipelines created after warm-up | section 4 | n/a count | 0 count | n/a | UNVERIFIED | provisional hardware |
| GPU memory (engine ledger) | section 4 | 268.4 MB | 1024 MB | 755.6 | PASS | provisional hardware |
| JS heap used | section 4 | 149.6 MB | 300 MB | 150.4 | PASS | provisional hardware |
| Frame rate (median of runs) | section 1 | 6.247 FPS | 30 FPS | -23.75 | FAIL | provisional hardware |
