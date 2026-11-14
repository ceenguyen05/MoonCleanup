# Perf capture: bench / tier C / low / webgpu

Created 2026-11-13T05:27:18.092Z. Milestone M0/sweep-low-webgpu-0.75. **PROVISIONAL hardware.**

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
| FPS | 17.2 (17.2 to 17.2, spread 0%) |
| Frame p50 / p95 / p99 (ms) | 57.40 (57.40 to 57.40, spread 0%) / 90.10 (90.10 to 90.10, spread 0%) / 127.60 (127.60 to 127.60, spread 0%) |
| CPU total p50 / p95 (ms) | 52.10 (52.10 to 52.10, spread 0%) / 73.80 (73.80 to 73.80, spread 0%) |
| GPU render p50 / p95 (ms) | n/a / n/a |
| Draw calls | 431 (431 to 431, spread 0%) |
| Triangles | 759533 (759533 to 759533, spread 0%) |
| GPU memory ledger (bytes) | 165008971 (165008971 to 165008971, spread 0%) |
| JS heap (bytes) | 177817256 (177817256 to 177817256, spread 0%) |
| Pipelines after warm-up | n/a |
| Device losses | 0 (0 to 0, spread 0%) |

### CPU per step, p95 of windows (ms)

| Step | p95 |
| --- | --- |
| render | 73.80 (73.80 to 73.80, spread 0%) |

## Budget comparison (reports only; performance-reviewer decides)

| Budget | Source | Value | Limit | Margin | Status | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Frame interval (p95) | section 1 | 90.1 ms | 33.3 ms | -56.8 | FAIL | provisional hardware |
| Main-thread CPU per frame (p95) | section 2 | 73.8 ms | 15 ms | -58.8 | FAIL | provisional hardware |
| Render submit CPU (p95) | section 2 | 73.8 ms | 4.5 ms | -69.3 | FAIL | provisional hardware |
| Net ingest CPU (p95) | section 2 | 0 ms | 0.8 ms | 0.8 | PASS | provisional hardware |
| UI flush CPU (p95) | section 2 | 0 ms | 0.6 ms | 0.6 | PASS | provisional hardware |
| GPU frame time (p95) | section 3 | n/a ms | 28 ms | n/a | UNVERIFIED | provisional hardware |
| Draw calls per frame | section 4 | 431 calls | 350 calls | -81 | FAIL | provisional hardware |
| Triangles per frame | section 4 | 759500 tris | 1000000 tris | 240500 | PASS | provisional hardware |
| Pipelines created after warm-up | section 4 | n/a count | 0 count | n/a | UNVERIFIED | provisional hardware |
| GPU memory (engine ledger) | section 4 | 157.4 MB | 1024 MB | 866.6 | PASS | provisional hardware |
| JS heap used | section 4 | 169.6 MB | 300 MB | 130.4 | PASS | provisional hardware |
| Frame rate (median of runs) | section 1 | 17.2 FPS | 30 FPS | -12.8 | FAIL | provisional hardware |
