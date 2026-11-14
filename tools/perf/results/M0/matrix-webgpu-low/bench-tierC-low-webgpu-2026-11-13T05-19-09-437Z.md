# Perf capture: bench / tier C / low / webgpu

Created 2026-11-13T05:19:09.437Z. Milestone M0/matrix-webgpu-low. **PROVISIONAL hardware.**

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
| FPS | 20.2 (19.8 to 20.6, spread 4%) |
| Frame p50 / p95 / p99 (ms) | 49.15 (48.20 to 50.10, spread 4%) / 65.60 (63.60 to 67.60, spread 6%) / 70.45 (68.30 to 72.60, spread 6%) |
| CPU total p50 / p95 (ms) | 45.90 (45.10 to 46.70, spread 3%) / 51.45 (50.80 to 52.10, spread 3%) |
| GPU render p50 / p95 (ms) | n/a / n/a |
| Draw calls | 361 (360 to 361, spread 0%) |
| Triangles | 760001 (759969 to 760033, spread 0%) |
| GPU memory ledger (bytes) | 164983070 (164983030 to 164983110, spread 0%) |
| JS heap (bytes) | 139852555 (139533083 to 140172027, spread 0%) |
| Pipelines after warm-up | n/a |
| Device losses | 0 (0 to 0, spread 0%) |

### CPU per step, p95 of windows (ms)

| Step | p95 |
| --- | --- |
| render | 51.40 (50.70 to 52.10, spread 3%) |
| ui | 0.05 (0.00 to 0.10, spread 200%) |

## Budget comparison (reports only; performance-reviewer decides)

| Budget | Source | Value | Limit | Margin | Status | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Frame interval (p95) | section 1 | 65.6 ms | 33.3 ms | -32.3 | FAIL | provisional hardware |
| Main-thread CPU per frame (p95) | section 2 | 51.45 ms | 15 ms | -36.45 | FAIL | provisional hardware |
| Render submit CPU (p95) | section 2 | 51.4 ms | 4.5 ms | -46.9 | FAIL | provisional hardware |
| Net ingest CPU (p95) | section 2 | 0 ms | 0.8 ms | 0.8 | PASS | provisional hardware |
| UI flush CPU (p95) | section 2 | 0.05 ms | 0.6 ms | 0.55 | PASS | provisional hardware |
| GPU frame time (p95) | section 3 | n/a ms | 28 ms | n/a | UNVERIFIED | provisional hardware |
| Draw calls per frame | section 4 | 360.5 calls | 350 calls | -10.5 | FAIL | provisional hardware |
| Triangles per frame | section 4 | 760000 tris | 1000000 tris | 240000 | PASS | provisional hardware |
| Pipelines created after warm-up | section 4 | n/a count | 0 count | n/a | UNVERIFIED | provisional hardware |
| GPU memory (engine ledger) | section 4 | 157.3 MB | 1024 MB | 866.7 | PASS | provisional hardware |
| JS heap used | section 4 | 133.4 MB | 300 MB | 166.6 | PASS | provisional hardware |
| Frame rate (median of runs) | section 1 | 20.17 FPS | 30 FPS | -9.827 | FAIL | provisional hardware |
