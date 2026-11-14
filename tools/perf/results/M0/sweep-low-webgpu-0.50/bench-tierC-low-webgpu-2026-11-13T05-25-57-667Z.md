# Perf capture: bench / tier C / low / webgpu

Created 2026-11-13T05:25:57.667Z. Milestone M0/sweep-low-webgpu-0.50. **PROVISIONAL hardware.**

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
| FPS | 27.1 (27.1 to 27.1, spread 0%) |
| Frame p50 / p95 / p99 (ms) | 36.60 (36.60 to 36.60, spread 0%) / 53.20 (53.20 to 53.20, spread 0%) / 54.00 (54.00 to 54.00, spread 0%) |
| CPU total p50 / p95 (ms) | 33.50 (33.50 to 33.50, spread 0%) / 39.90 (39.90 to 39.90, spread 0%) |
| GPU render p50 / p95 (ms) | n/a / n/a |
| Draw calls | 429 (429 to 429, spread 0%) |
| Triangles | 757245 (757245 to 757245, spread 0%) |
| GPU memory ledger (bytes) | 157232971 (157232971 to 157232971, spread 0%) |
| JS heap (bytes) | 142966284 (142966284 to 142966284, spread 0%) |
| Pipelines after warm-up | n/a |
| Device losses | 0 (0 to 0, spread 0%) |

### CPU per step, p95 of windows (ms)

| Step | p95 |
| --- | --- |
| render | 39.90 (39.90 to 39.90, spread 0%) |

## Budget comparison (reports only; performance-reviewer decides)

| Budget | Source | Value | Limit | Margin | Status | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Frame interval (p95) | section 1 | 53.2 ms | 33.3 ms | -19.9 | FAIL | provisional hardware |
| Main-thread CPU per frame (p95) | section 2 | 39.9 ms | 15 ms | -24.9 | FAIL | provisional hardware |
| Render submit CPU (p95) | section 2 | 39.9 ms | 4.5 ms | -35.4 | FAIL | provisional hardware |
| Net ingest CPU (p95) | section 2 | 0 ms | 0.8 ms | 0.8 | PASS | provisional hardware |
| UI flush CPU (p95) | section 2 | 0 ms | 0.6 ms | 0.6 | PASS | provisional hardware |
| GPU frame time (p95) | section 3 | n/a ms | 28 ms | n/a | UNVERIFIED | provisional hardware |
| Draw calls per frame | section 4 | 429 calls | 350 calls | -79 | FAIL | provisional hardware |
| Triangles per frame | section 4 | 757200 tris | 1000000 tris | 242800 | PASS | provisional hardware |
| Pipelines created after warm-up | section 4 | n/a count | 0 count | n/a | UNVERIFIED | provisional hardware |
| GPU memory (engine ledger) | section 4 | 149.9 MB | 1024 MB | 874.1 | PASS | provisional hardware |
| JS heap used | section 4 | 136.3 MB | 300 MB | 163.7 | PASS | provisional hardware |
| Frame rate (median of runs) | section 1 | 27.13 FPS | 30 FPS | -2.866 | FAIL | provisional hardware |
