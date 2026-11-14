# Device report 1e7deac4b61d

Created 2026-11-13T22:19:21.933Z. Schema 1. Contains no personal data; nothing was uploaded.

## Machine

- OS: Windows_NT 10.0.26200 (x64)
- CPU: Intel(R) Core(TM) i7-8650U CPU @ 1.90GHz (8 threads, 15.9 GB RAM)
- Browser: Chromium-based 157.0.8103.79 (channel chrome, headed)
- Screen 1920x1080, capture viewport 1920x1080, DPR 1
- GPU renderer string: ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)
- WebGPU: available
- Adapter: vendor "intel", architecture "gen-9", device "", description ""
- Timestamp queries: available (GPU ms are measured on WebGPU)
- Key limits: maxTextureDimension2D=16384, maxBufferSize=2147483648, maxStorageBufferBindingSize=2147483644, maxComputeInvocationsPerWorkgroup=1024
- Game tier detector chose: backend webgpu, tier B, preset low

## Results (warm-up 4 s discarded, 10 s captured per cell, scale mode preset spec ceiling (low 0.75, medium 0.85, high 1.00), seed device-1)

| Scene | Backend | Preset | Scale | FPS | Frame p50 | p95 | p99 | GPU p50 / p95 | CPU p95 | Draws | Tris | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s01 | webgpu | low | 0.75 | 45.9 | 21.7 | 32.0 | 35.8 | n/a | 22.2 | 188 | 388194 | ok |

Frame ms are requestAnimationFrame intervals (display refresh can floor them). GPU ms exist only where a WebGPU timestamp query measured them; webgl2 is CPU-only and never shown as GPU time.

## Provisional tier comparison

| Row | Scene | Result | Numbers | Note |
| --- | --- | --- | --- | --- |
| Tier A, High, WebGPU | s01 | NO DATA |  | cell not captured |
| Tier B, Medium, WebGPU | s01 | NO DATA |  | cell not captured |
| iGPU floor, Low, WebGPU | s01 | PASS | p95 32.0 / 33.3 ms (margin 1.3); 45.9 / 30 FPS; draws 188 / 350; tris 0.39 M / 1.00 M; GPU p95 n/a |  |
| iGPU floor, Low, WebGL2 (Tier C) | s01 | NO DATA |  | cell not captured |

Report only; performance-reviewer issues the verdict. Frame p95 allows 0.5 ms of display-refresh quantisation.
