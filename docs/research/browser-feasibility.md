# Browser Platform Feasibility: Rendering, Hardware Budgets and Mobile Scope

**Date:** 2026-11-11 · **Author:** research subagent P1e · **Scope:** feasibility of the planned realistic-rendering, real-time co-op (1–16 players) moon-cleaning browser game: WebGPU/WebGL2 support, hardware tiers and budgets, memory and load-time budgets, web platform APIs, mobile scope, and headless/automated rendering tests. Planning research only. No code was written.

> **How to read this.** Numbers in square brackets, like [12], point to the numbered **Sources** list at the end. Every source was accessed on 2026-11-11. Most pages were read through automated fetches and search-result summaries. When a figure came only from a search-result summary and the page itself was not opened, the Sources entry says so. Items marked **"not re-verified"** come from the author's prior knowledge, not from a source read this session, and must be checked before anyone relies on them. Text marked **(analysis)** or **Recommendation** is the author's own reasoning, not a sourced fact. Confidence levels: **High** means an official source, consistent across sources. **Medium** means an official but indirect source, or a single source. **Low** means a secondary, anecdotal or snippet-only source.

---

## Executive summary

1. **WebGPU in Chromium:** enabled by default in Chrome/Edge 113+ on Windows (D3D12), macOS and ChromeOS. On Android it has been on since Chrome 121 (Android 12+, Qualcomm/ARM/Intel GPUs). On Linux it covers only Intel Gen12+ (Chrome 144) and NVIDIA with driver 535.183.01+ on Wayland (Chrome 147). Windows-on-ARM is still behind a flag [1][2][7][9]. **High.**
2. **WebGPU in Firefox:** shipped on Windows in Firefox 141 and on Apple-silicon macOS in Firefox 145 (Tahoe only), widened to all macOS versions in 147. Linux is Nightly-only and Android is behind a flag. Both were still unshipped on the status page as of 2026-10-02, and Mozilla "expects" Linux in 2026 [1][2][10]. **Medium-High**, since this can change with any release.
3. **WebGPU in Safari:** Safari 26 (2025-09-15) ships it on macOS Tahoe 26, iOS/iPadOS 26 and visionOS 26. Safari 26 running on older macOS does not enable it by default [11][4][68]. **High.**
4. **Coverage estimates disagree.** Can I use reports 88.63% global (full + partial) [3]. Web3D Survey reports 81.52% of sessions with a working adapter [13]. Plan for roughly **11–19% of visitors without WebGPU**. **Medium.**
5. **Our features:** compute shaders and storage textures are core WebGPU [11][12]. Optional features vary. BC texture compression appears on 87.3% of adapters versus about 46% for ETC2/ASTC. Subgroups reach 68.35%, float32-filterable 91.34%, and timestamp-query 98.88%. Chrome rounds timestamps to 100 µs [13][6]. **Medium.**
6. **Guaranteed default limits are modest:** a 128 MiB storage-buffer binding, 256 MiB buffers, 8192 px 2D textures and 256 invocations per workgroup. Compatibility mode (Chrome 146, OpenGL ES 3.1, Android first) lowers several of these [12][8]. **High.**
7. **WebGL2** reaches about 97–98% of users but has **no compute shaders**. Dust masks and particles would have to become fragment or transform-feedback passes. GPU timer queries work on only 62.84% of WebGL2 clients [14][15][11]. **High.**
8. **Steam survey, October 2026:** 1920×1080 is 50.23% of primary displays. 8 GB is the most common VRAM bucket (26.92%). 16 GB system RAM is 41.42%. The **RTX 4060 Laptop GPU** is the most common laptop GPU at 3.60% [16][17]. **High**, for Steam's population.
9. **Integrated graphics:** an Iris Xe 96EU or Arc 140V scores about 0.30–0.41× an RTX 4060 Laptop on 3DMark Time Spy medians [18][19]. By default the OS limits an iGPU to half of system RAM [20][21]. **Medium/Low**, because the benchmark figures came from search snippets.
10. **No web API reports a GPU memory budget.** Chrome's `memoryHeaps` is behind a flag [6]. iOS Safari terminates and reloads heavy WebGL pages, and pages cannot query a budget beforehand [28][29]. **Medium-High.**
11. **Portal download guidance:** Poki says 5–8 MB initial [32][33]. CrazyGames allows up to 50 MB initial, and requires 20 MB or less to appear on its mobile homepage [30]. **Recommendation:** 20 MB or less to the first playable or lobby screen, with everything else streamed. **Medium.**
12. **Wasm threads and SharedArrayBuffer** need COOP + COEP headers. Safari lacks `COEP: credentialless`, so the stricter `require-corp` would apply, and every cross-origin asset must then send CORP or CORS headers [51][52][53]. **Recommendation:** no threads in the MVP. **Medium-High.**
13. **Background tabs:** Chrome throttles timers to once per second. After 5 minutes hidden, timers can drop to once per minute, with exceptions. So the **server must be authoritative** and tolerate "away" clients [54]. **High.**
14. **Mobile is out of the MVP and is not a v1.0 commitment.** The reasons are Android WebGPU fragmentation, iOS memory kills, thermal throttling (one native case study fell from 60 to 32 FPS within 30 minutes) and a full touch-control redesign [1][28][58]. **Medium.**
15. **Testing:** headless Chrome disables the GPU by default, and real-GPU flags exist for Linux [59]. The automatic SwiftShader WebGL fallback is deprecated and now needs an opt-in flag [60][61]. Playwright warns that screenshots vary with hardware [65]. So use **two lanes**: software rendering in CI for smoke tests, and real-GPU machines for visual baselines. **Medium-High.**

---

## 1. WebGPU support status (November 2026)

### 1.1 Per browser and OS

The GPU for the Web "Implementation Status" wiki is the most current consolidated source. It was last edited on 2026-10-02 [1].

| Browser | OS / platform | Status | Since | Notes | Conf. | Src |
|---|---|---|---|---|---|---|
| Chrome / Edge | Windows x86/x64 | Shipped | 113 | D3D12 backend | High | [1][2][3] |
| Chrome / Edge | Windows ARM64 | **Flag only** (`enable-unsafe-webgpu`) | — | — | High | [1] |
| Chrome / Edge | macOS | Shipped | 113 | — | High | [1][2] |
| Chrome | ChromeOS | Shipped | 113 | — | High | [1][2] |
| Chrome | Android | Shipped | 121 | Android 12+ with Qualcomm/ARM GPUs (the wiki adds Intel). Imagination GPUs on Android 16+ since **139**. Samsung Xclipse and "other GPUs": **TBD** | High | [1][2][6] |
| Chrome | Android, compatibility mode | Shipped | 146 | `featureLevel: "compatibility"` on OpenGL ES 3.1, starting with Android. ChromeOS (GLES 3.1) and Windows D3D11 are "exploring" | High | [8] |
| Chrome | Linux | **Partial** | 144 / 147 | Intel Gen12+ since 144. NVIDIA driver ≥535.183.01 **on Wayland** since 147. Other setups need command-line flags. WebGPU uses Vulkan while the rest of Chromium stays on OpenGL | High | [1][7][9] |
| Firefox | Windows | Shipped | 141 (July 2025) | wgpu-based | High | [1][2] |
| Firefox | macOS, Apple silicon | Shipped | 145 (Tahoe 26+), 147 (all macOS versions) | Firefox 147 released 2026-01-13 | High | [1][2][10] |
| Firefox | macOS, Intel | **Nightly only** | — | — | High | [1] |
| Firefox | Linux | **Nightly only** | — | "Mozilla expects to ship on Linux in 2026" (as of 2026-10-02) | Medium | [1][2] |
| Firefox | Android | **Behind a flag** | — | Beta/Nightly with `gfx.webgpu.ignore-blocklist`. Work "expected in 2026" | Medium | [1] |
| Safari | macOS | Shipped (partial per Can I use) | 26.0 (2025-09-15) | Enabled by default only on macOS Tahoe 26+, so Safari 26 on older macOS does not expose `navigator.gpu` | High | [11][1][4][68] |
| Safari | iOS / iPadOS | Shipped | 26.0 | — | High | [11][1][3] |
| Safari | visionOS | Shipped | 26.0 | — | High | [11][1] |
| Samsung Internet | Android | Supported | 24 | Per Can I use | Medium | [3][4] |
| Opera | Desktop | Supported | 99 | Per Can I use | Medium | [3][4] |

**Spec status:** WebGPU is a W3C **Candidate Recommendation Draft**, dated 2026-09-15 [12]. **High.**

### 1.2 Global coverage estimate

- **Can I use:** 88.63% total, made up of 86.83% full and 1.8% partial support [3]. Can I use marks **Chrome for Android as "supported" with no qualification** [4]. Real Android support depends on OS version and GPU vendor [1], so this figure is likely an **overestimate** (analysis). Firefox appears only as "partial" (Windows/macOS) [4]. **Medium.**
- **Web3D Survey:** 81.52% of reports returned a working adapter, and 0.04% of working adapters were fallback (software) adapters [13]. This counts real adapters, but the page does not show its sample size or which sites contribute, so the sample may be biased. **Medium-Low.**
- **Working estimate (analysis):** about **81–89% of web visitors** can run WebGPU, which leaves roughly **1 in 9 to 1 in 5 without it**. The unsupported group concentrates in Firefox on Linux and Android, Linux on AMD or X11, Windows on ARM, Safari before 26 or on pre-Tahoe macOS, and older or unlisted Android GPUs [1][4]. Steam's population is 93.70% Windows [16], so a desktop-gamer audience is probably above this average. That is an inference; no source measures it.

### 1.3 Notable feature availability

| Feature | Core or optional | Availability | Notes | Conf. | Src |
|---|---|---|---|---|---|
| Compute shaders | **Core** | Every WebGPU implementation | WebKit describes compute as what WebGPU adds over WebGL | High | [11][12] |
| Storage buffers / storage textures | **Core**, with limits | Every implementation | `maxStorageTexturesPerShaderStage` default 4. Chrome 143 removed read-only storage use of `bgra8unorm`. The spec lists optional `texture-formats-tier1`/`tier2` features that extend formats (details not verified) | High / Medium | [12][5] |
| `timestamp-query` | Optional | 98.88% of tested browsers | Chrome **rounds to 100 µs** unless the "WebGPU Developer Features" flag is on. GPU counters can occasionally reset | Medium | [13][6] |
| `float32-filterable` | Optional | 91.34% | Plan for **no linear filtering of R32F/RGBA32F** on about 9% of adapters | Medium | [13] |
| `float32-blendable` | Optional | 94.17% | Chrome 132 added 32-bit float blending | Medium | [13][5] |
| `shader-f16` | Optional | 93.99% | Added on Linux NVIDIA in Chrome 155–156 | Medium | [13][5] |
| `subgroups` | Optional | 68.35% | Shipped in Chrome 134. Subgroup-size control in Chrome 151–152 | Medium | [13][5] |
| `texture-compression-bc` | Optional | 87.3% | The desktop format family | Medium | [13] |
| `texture-compression-etc2` / `-astc` | Optional | 46.62% / 46.42% | Mobile and Apple-silicon class hardware (analysis) | Medium | [13] |
| `*-sliced-3d`, `texture-compression-unaligned` | Optional | Chrome 139 / Chrome 155–156 | 3D BC/ASTC textures; unaligned compressed sizes | High | [5][12] |
| Transient attachments | Usage flag | Chrome 146 | Keeps attachments in tile memory and can avoid VRAM allocation. Useful on mobile and tile-based GPUs | High | [8] |
| Immediates (push-constant-like) | Feature | Chrome 149–150 | — | High | [5] |
| GPU memory heap info | Experimental | Chrome 121, **behind a flag** | `memoryHeaps` exposed only with "WebGPU Developer Features" | High | [6] |

**What this means:** the platform split visible in [13] is BC on desktops versus ETC2/ASTC on mobile. So a **transcodable format (KTX2/Basis)** is needed if we want one asset set for both (analysis, see §5).

### 1.4 Default limits that matter for us

These are the limits every adapter must offer. Adapters may expose higher ones, which must be requested explicitly [12].

| Limit | Default | Compatibility-mode default | Relevance |
|---|---|---|---|
| `maxStorageBufferBindingSize` | 134,217,728 B (128 MiB) | not shown | Particle and dust-sim buffers; split large data |
| `maxBufferSize` | 268,435,456 B (256 MiB) | not shown | Terrain and vertex megabuffers |
| `maxTextureDimension2D` | 8192 | 4096 | A whole-moon dust mask cannot be one huge texture, so use tiles or arrays |
| `maxTextureArrayLayers` | 256 | not shown | Cube-sphere tile arrays |
| `maxUniformBufferBindingSize` | 65,536 B | 16,384 B | Per-draw and per-frame UBOs |
| `maxColorAttachments` / bytes per sample | 8 / 32 | 4 / — | G-buffer layout |
| `maxComputeInvocationsPerWorkgroup` | 256 | 128 | Compute dispatch sizing |
| `maxComputeWorkgroupStorageSize` | 16,384 B | not shown | Shared-memory reductions |
| `maxStorageBuffersInVertexStage` | 8 | **0** | Compatibility mode forbids storage buffers in vertex shaders |

Source: W3C WebGPU CR Draft [12]. **High.**

### 1.5 Known driver and blocklist issues

- Linux enablement is gated by GPU vendor, driver version and display server, as in §1.1. Other configurations need command-line flags. The wiki asks users to update drivers and report failures [1]. **High.**
- Windows ARM64 Chrome is still behind a flag [1]. Firefox Android uses a blocklist override preference [1]. Samsung Xclipse Android GPUs are TBD [1]. **High.**
- Software **fallback adapters** exist. Chrome moved `isFallbackAdapter` into `GPUAdapterInfo` (Chrome 136) and removed it from `GPUAdapter` (Chrome 140) [5]. The spec advises apps to check it [12]. **High.**
- **Device loss:** per the spec, "devices can be lost at any time". Apps should request a new device unless the loss reason is `destroyed` [12]. A robust **device-lost recovery path is mandatory** (analysis). **High.**
- **Shader compiler changes in Chrome:** DXC replaced FXC on D3D12, with a 20% average speed-up in compute-shader compilation (Chrome 121) [6]. Compile times were also improved on Metal (130) and D3D12 (136) [5]. **High.**

---

## 2. WebGL2 coverage and fallback implications

### 2.1 Coverage

- Can I use: **97.29%** global. Supported since Chrome 56, Firefox 51 and Safari/iOS 15 [14]. **High.**
- Web3D Survey: **98.31%** of reports [15]. **Medium.**

### 2.2 Extension availability relevant to our renderer (Web3D Survey [15], **Medium**)

| Capability | WebGL2 mechanism | Availability | Note |
|---|---|---|---|
| HDR render targets (RGBA16F/32F) | `EXT_color_buffer_float` | 99.95% | HDR with filmic tone mapping is viable |
| Half-float color buffers | `EXT_color_buffer_half_float` | 91.69% | — |
| Linear filtering of 32-bit float textures | `OES_texture_float_linear` | 90.74% | Prefer 16F for anything that is sampled |
| Float blending | `EXT_float_blend` | 93.6% | — |
| GPU timing | `EXT_disjoint_timer_query_webgl2` | **62.84%** | Dynamic resolution must fall back to CPU-side heuristics on about 37% of clients |
| Parallel or async shader compile | `KHR_parallel_shader_compile` | 74.64% | Without it, compile stalls the main thread |
| Multi-draw | `WEBGL_multi_draw` | 92.32% | — |
| BC formats | `s3tc` / `rgtc` / `bptc` | 86.32% / 85.91% / 84.1% | Desktop |
| ETC / ASTC | `compressed_texture_etc` / `_astc` | 49.87% / 49.38% | Mobile |
| MRT | `MAX_DRAW_BUFFERS` | at least 4 on 100%, at least 7 on 96% | A G-buffer of 4 or fewer targets is safe |
| Max texture size | `MAX_TEXTURE_SIZE` | at least 4096 on 100%, at least 16384 on 83% | — |

### 2.3 What breaks if we fall back to WebGL2 (analysis, with sources where noted)

1. **No compute shaders** [11]:
   - **Dust masks:** cleaning would have to be done as fragment-shader "stamp" passes into render targets, ping-ponging between textures. This works, but it is less flexible. For example, it cannot count cleaned area with atomics.
   - **Clean-percentage readback:** use mip-reduction plus an async read-back instead of atomics.
   - **GPU particles:** use transform feedback or texture ping-pong.
   - **Auto-exposure histograms:** use a luminance mip chain instead.
2. **No storage buffers, atomics or indirect GPU-driven culling.** Expect CPU culling and more draw calls (analysis; storage buffers are a core WebGPU concept [12]).
3. **Weaker profiling.** Timer queries are available on only 62.84% of clients [15].
4. **Two shader languages.** WGSL and GLSL ES 3.00 would need to be maintained separately unless the engine abstracts them (analysis). Three.js, Babylon.js and PlayCanvas are among the engines listed with WebGPU support [2].
5. **Still fine in WebGL2:** PBR, cascaded shadow maps, SSAO, bloom, HDR (`EXT_color_buffer_float` is near-universal [15]), skeletal animation and compressed textures.

**Recommendation:** WebGPU is the primary renderer. Ship a **WebGL2 "Low" fallback only if the chosen engine provides it at low cost**, and design dust-mask updates so they can run either as a compute pass or as a fragment ping-pong pass. Otherwise, show a clear "browser not supported" page that recommends Chrome, Edge or Safari 26. Decide this in the engine-selection step. **Confidence: Medium.**

---

## 3. Hardware tiers

### 3.1 Steam Hardware & Software Survey, October 2026 [16][17] (High for Steam users)

- **OS:** Windows 93.70% (Windows 11 72.51%, Windows 10 21.11%), Linux 3.95%, macOS 2.35% [16].
- **Primary display:** 1920×1080 50.23%, 2560×1440 21.82% (down 5.22 points month-on-month, which shows how volatile the survey is), 2560×1600 5.46%, 3840×2160 5.05%, 3440×1440 3.23%, 1920×1200 2.97% [16].
- **VRAM:** 8 GB 26.92%, 16 GB 26.35%, 12 GB 12.91%, 6 GB 5.20%, 4 GB 5.54%, 24 GB 5.40% [16].
- **System RAM:** 16 GB 41.42%, 32 GB 37.06%, 8 GB 7.52% [16].
- **Laptop GPUs** (share of all surveyed systems, video-card table) [17]:

  | GPU | Share |
  |---|---|
  | RTX 4060 Laptop | 3.60% |
  | RTX 5060 Laptop | 2.68% |
  | RTX 4050 Laptop | 1.76% |
  | RTX 3060 Laptop | 1.74% |
  | RTX 4070 Laptop | 0.92% |
  | RTX 3050 6GB Laptop | 0.74% |
  | RTX 5070 Laptop | 0.69% |
  | RTX 3050 Ti Laptop | 0.61% |
  | RTX 5050 Laptop | 0.48% |

- **Integrated GPUs** [17]:

  | GPU | Share |
  |---|---|
  | Intel Iris Xe | 1.78% |
  | AMD Radeon Graphics | 1.75% |
  | Intel(R) UHD Graphics | 1.27% |
  | AMD Radeon(TM) Graphics | 0.97% |
  | Intel UHD Graphics | 0.72% |
  | UHD 620 | 0.44% |
  | Radeon 780M | 0.32% |
  | Vega 8 | 0.30% |
  | Intel Arc Graphics | 0.29% |
  | UHD 630 | 0.27% |
  | Vega 3 | 0.19% |

  These listed integrated GPUs add up to about **8.3%** of Steam systems (analysis). That is a lower bound for integrated graphics on Steam, and the general web audience is very likely more integrated-heavy (inference, no source).

### 3.2 Tier definitions (analysis built on the data above)

| | **Tier A: mid-range laptop with a discrete GPU** (target: locked 60 FPS, High) | **Tier B: integrated graphics** (target: 30+ FPS, Low/Medium) |
|---|---|---|
| Example GPUs | RTX 4050 / 4060 / 5050 / 5060 Laptop (the 4060 Laptop is the reference device as the most common laptop GPU) [17] | Intel Iris Xe (80/96EU), Intel UHD, Intel Arc integrated (e.g. Arc 140V), AMD Radeon 680M/780M-class ("AMD Radeon Graphics") [17][18][19]. Apple M-series is not researched here |
| GPU memory | Dedicated **6–8 GB** (the 8 GB bucket is the most common on Steam at 26.92% [16]). Per-model VRAM (4050 Laptop 6 GB, 4060 Laptop 8 GB) is from vendor specs and **not re-verified** | **Shared** system RAM, limited by the OS to **half of system memory** by default [20][21]. A newer Intel "Shared GPU Memory Override" defaults to 57% on select Core Ultra systems [22]. With 16 GB RAM (41.42% of Steam [16]) that is at most about 8 GB, shared with the OS and browser |
| System RAM | 16 GB typical [16] | 8–16 GB (analysis) |
| Display | 1920×1080 or 1920×1200 (16:9 or 16:10), increasingly 2560×1600 [16] | 1920×1080, sometimes 1920×1200 [16] |
| Device pixel ratio | Not measured by any source found. **Assumption:** 1.0–1.5 on Windows laptops (125–150% scaling), 2.0 on MacBooks. **Not verified** | Same assumption |
| Relative throughput (3DMark Time Spy median, Notebookcheck) | RTX 4060 Laptop ≈ **10,500** [18] | Arc 140V ≈ **4,330** [18]. Iris Xe 96EU ≈ **3,130** [19]. Radeon 780M: **not obtained** (page blocked) |
| Ratio to Tier A | 1.0× | **≈0.30–0.41×** (computed from the figures above) |

**Confidence:** **High** for the Steam shares. **Low-Medium** for the throughput figures, because they came from search-result snippets of Notebookcheck aggregates and it was unclear whether they are overall or graphics sub-scores.

**Reading the ratio (analysis):** Tier B gets 2× the frame time (33.3 ms) on about one third of the throughput. Its per-frame GPU work budget is therefore about **0.6–0.8× of Tier A's 60 FPS budget** before memory-bandwidth limits, which hit iGPUs harder. Low/Medium should cut pixel count (render scale 0.5–0.75), shadow cascades, AO resolution and particle counts rather than material quality.

---

## 4. Memory budgets

| Topic | Finding | Conf. | Src |
|---|---|---|---|
| Per-tab memory | No documented hard per-tab cap was found for desktop browsers. On iOS, WebKit terminates pages with heavy WebGL use under memory pressure and Safari reloads them, sometimes in a loop. A 2025 reporter asked for a way to query the budget and none was known. An Apple forums thread covers the same topic | Medium (iOS), Unknown (desktop) | [28][29] |
| wasm32 | The address space is 4 GiB by construction. Chrome raised its cap to 4 GB in 2020 (**not re-verified**) | Medium | [27] |
| Memory64 | Chrome/Edge 133 (2025-02-04) and Firefox 134 (2025-01) per web-features. One vendor blog says Firefox 143 or later. **Safari: not supported**, which blocks Baseline status. Browsers cap wasm memory growth at 16 GiB | Medium | [23][24][25][26] |
| GPU memory query | The WebGPU spec exposes **limits, not budgets** [12]. Chrome's experimental `memoryHeaps` sits behind the developer-features flag [6]. Adapter information such as architecture (Chrome 138) and power preference (Chrome 137) helps with heuristics [5] | High | [5][6][12] |
| iGPU shared memory | Limited by the OS to half of system memory, which is "simply the limit… at a given time", not a reservation [20][21]. The Intel override defaults to 57% on select Core Ultra systems [22] | Medium | [20][21][22] |

**What engines do without a budget API (analysis, common practice, no single source):**

- **Account for every allocation themselves.** Estimate texture bytes from format × mips × layers, and buffer bytes from size.
- **Use per-preset budgets:** pick a conservative default from the adapter, then let the player raise it.
- **Use texture streaming with a residency cap.**
- **Downgrade on failure:** treat out-of-memory errors and device loss as a signal to drop a quality step.
- **Avoid duplicate CPU-side copies** of uploaded data.

**Recommendations:**

- Keep the wasm heap (if any) and JS heap combined under about **1 GB on desktop** and under about **300–500 MB for any future mobile build**. These are estimates, not sourced.
- Cap **total GPU allocations at roughly 1–1.5 GB on Tier B and roughly 3 GB on Tier A**. That leaves about half of a 6–8 GB card for the browser compositor, other tabs and the OS (analysis).
- Do not depend on Memory64 while Safari lacks it [23][24].

---

## 5. Load-time budgets

### 5.1 Industry guidance

| Source | Guidance | Conf. |
|---|---|---|
| Poki requirements page | "Target an initial download size **under 8 MB**" [32] | Medium |
| Poki developer guide | Initial download "should not exceed **5MB**", and 8 MB in total [33]. Defold's manual repeats the 5 MB figure [34] | Medium (conflicts with [32]) |
| CrazyGames | Initial download **≤50 MB**. **≤20 MB** to be eligible for the mobile homepage. Measured from load start to first gameplay start when the SDK is integrated. Files loaded later do not count if implemented correctly [30]. Total ≤250 MB with the SDK (50 MB without), ≤1500 files [31] | Medium |
| Web Vitals, for the DOM shell and lobby | LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1 at the 75th percentile (**not re-verified**) | Medium |

**Recommendation (analysis):** our realistic-rendering scope can't meet Poki's 5–8 MB. Target **≤20 MB to the first interactive lobby or first frame**. That would meet CrazyGames' mobile-homepage threshold and leaves room under its 50 MB cap. Target **≤50 MB to a fully playable first session on Low/Medium**, and stream High/Ultra assets up to about 150–250 MB in total.

### 5.2 Delivery on Vercel

- Vercel compresses with **gzip and Brotli automatically**, and Brotli takes precedence when the client advertises it [35]. **Medium.**
- Content-addressed files are served `public, max-age=31536000, immutable`. Custom `headers` (including Cache-Control) can be set per path in `vercel.json` [36][37]. **Medium.**
- A community thread reports that **pre-compressed `.br` files get re-compressed** at the edge [38]. This is unverified, so do not rely on serving pre-compressed files. **Low.**
- **Recommendation (analysis):** use hashed filenames with immutable caching, and a short-TTL `index.html` and asset manifest. Brotli helps JS, JSON, WASM and WGSL. **KTX2 files with Zstd supercompression gain little from extra compression** [39].

### 5.3 Textures: KTX2 / Basis Universal

- **ETC1S** gives small files at lower quality. **UASTC** is high quality, 8 bits per texel, and transcodes quickly to BC7 or ASTC because UASTC is a common subset of both. KTX2 can apply Zstd supercompression, which is on by default for UASTC [39]. **Medium.**
- One benchmark transcoded a 1K texture set from UASTC to BC7 in about **160 ms on a Ryzen 5 3600** (2021). Transcoding between two lossy formats (for example BC to ASTC) is discouraged [40]. **Low** (old, single figure).
- **Recommendation (analysis):** transcode in a worker pool during streaming. Use UASTC for normal maps and hero materials, and ETC1S for bulk terrain detail. Target BC7/BC5 on desktop, which has 87.3% BC support [13], and ASTC/ETC2 on mobile.

### 5.4 Shader and pipeline compilation stalls

- WebGPU pipelines compile when they are created. The spec provides `createRenderPipelineAsync` and `createComputePipelineAsync` so creation need not block [12]. **Medium** (async section not quoted this session).
- Chrome sped up compilation with DXC on D3D12 (Chrome 121, 20% faster compute compiles) [6], and further in Chrome 130 (Metal) and 136 (D3D12) [5]. **High.**
- In WebGL2, `KHR_parallel_shader_compile` is available on only 74.64% of clients [15]. **Medium.**
- **Warm-up strategy (analysis):**
  - Enumerate every pipeline permutation in a manifest.
  - Create them all with the async APIs behind the loading screen or lobby.
  - Keep the permutation count small by using uber-shaders and specialization through overrides.
  - Never create pipelines on first use during gameplay.
  - Measure the time to "all pipelines ready" in telemetry.

### 5.5 Streaming strategy (analysis)

- Split the moon into a cube-sphere quadtree of terrain and dust-mask tiles.
- Load from coarse to fine in priority order: tiles near players and in view first.
- Load the **lowest mips first** so the game is playable early.
- Use HTTP/2 or HTTP/3 multiplexing from the CDN, cap concurrent fetches, and cache in the HTTP cache. Content hashing makes that safe.
- Defer the High/Ultra texture pack until after the first match starts.

---

## 6. Web platform features a game needs

| Feature | Status and gotchas | Conf. | Src |
|---|---|---|---|
| **Pointer Lock** | Requires **transient activation** (a click or key press). Calling it again right after the user's default unlock gesture (Esc) **fails** even with activation. A Promise-returning form exists but is not yet standard or universal | High | [41] |
| …`unadjustedMovement` (raw mouse input) | Chrome/Edge 88+. **Firefox desktop 152+**. Firefox Android throws `NotSupportedError`. **Safari 18.4+ on macOS**. **Not supported on iOS**. Feature-detect and catch `NotSupportedError` | Medium | [42][43][44] |
| **Fullscreen API** | Not researched in depth this session. Prior knowledge (**not re-verified**): it needs user activation, Esc exits, and iPhone Safari has limited element fullscreen | Low | — |
| **Keyboard Lock** | MDN marks it **experimental**. It is specified as a WICG draft [45][46]. Prior knowledge (**not re-verified**): it is Chromium-only, works in fullscreen, and Esc must be **pressed and held** to exit when locked. Do not design around it | Low-Medium | [45][46] |
| **Gamepad API** | Only one known layout, `"standard"`. If a pad is already connected, `gamepadconnected` fires on the first button press or axis move. **Firefox exposes pads only after the user interacts with one while the page is visible.** Poll `getGamepads()` every frame. Firefox does not support `Gamepad.timestamp`. Haptics support was not verified | High | [47] |
| **Web Audio autoplay** | Starting audio outside a user-input handler is subject to autoplay rules. By default Firefox lets an AudioContext play only after **sticky activation**. `navigator.getAutoplayPolicy("audiocontext")` reports the policy. Details vary by browser | High | [48] |
| **High-DPI** | `devicePixelContentBoxSize`: Chrome/Edge 84+. Firefox 93 or 108 (sources conflict). **Safari not supported** (the WebKit bug was closed as a duplicate). Feature-detect, with a fallback of CSS size × `devicePixelRatio` | Medium | [49][50] |
| **OffscreenCanvas + workers** | Not verified this session. Chrome has WebGPU in workers, including experimental synchronous buffer mapping in workers (Chrome 145) [5]. Safari/Firefox OffscreenCanvas with WebGPU is unverified | Low | [5] |
| **SharedArrayBuffer / wasm threads** | Require **cross-origin isolation**: `Cross-Origin-Opener-Policy: same-origin` plus `Cross-Origin-Embedder-Policy: require-corp` or `credentialless` [51]. **Safari does not support `credentialless`** [52][53], so Safari needs `require-corp`. Every cross-origin subresource must then send CORP or load via CORS [51][53] | Medium-High | [51][52][53] |
| …Vercel implications | Both headers can be set per path in `vercel.json` [37]. Third-party scripts, ads, analytics, embeds and fonts must be CORP/CORS-compatible or self-hosted (analysis). COOP `same-origin` likely breaks opener-based sign-in or payment popups (**not re-verified**). Whether COEP affects the **WebSocket to the Render game server** was **not verified**, so test it in a spike | Medium / Unknown | [37][51] |
| **Page Visibility and background throttling** | Chrome 88+: hidden-page timers run at most **once per second**. **Intensive throttling** (once per **minute**) applies after 5 minutes hidden, with a chain count of 5 or more and 30 seconds of silence, and not when WebRTC is in use. Audio played in the last 30 seconds exempts the page [54]. `requestAnimationFrame` is paused in background tabs in most browsers (**not re-verified**) [55] | High / Medium | [54][55] |

**Multiplayer implications of background throttling (analysis):**

- The client cannot simulate while hidden. The **server must be authoritative** and treat hidden clients as idle.
- On `visibilitychange` to hidden, send an "away" message and stop sending input.
- On return, request a **full state snapshot** rather than replaying missed deltas.
- Keep heartbeats driven by the server and tolerant of 1 s to 60 s timer gaps.
- Never use silent audio to dodge throttling. Chrome does not count a silent track as noise anyway [54].

---

## 7. Mobile and touch

### 7.1 Findings

- **Android WebGPU is fragmented.** It needs Chrome 121+ with Android 12+ on Qualcomm/ARM GPUs. Imagination GPUs need Android 16+. Samsung Xclipse is TBD. Firefox Android is behind a flag. Compatibility mode on GLES 3.1 (Chrome 146) widens reach but **lowers limits**, for example 4096 px textures and no storage buffers in vertex shaders [1][8][12]. **High.**
- **iOS/iPadOS 26 Safari** supports WebGPU [11]. However, **iOS kills and reloads heavy pages under memory pressure, with no budget API** [28][29]. Per-device thresholds circulating in third-party guides (for example "~256 MB") could **not** be confirmed and are not used here. **Medium.**
- **Thermal throttling:** in a native Android case study, a game fell from **60 to 32 FPS within 30 minutes on a Pixel 6** without adaptive measures [58]. Native apps have a Thermal API (headroom polling) and Google advises testing sessions of 15 minutes or more [56][57]. No web-exposed equivalent was found in this research (**unverified absence**). **Medium.**
- **Input:** raw mouse input via `unadjustedMovement` is unavailable on iOS and throws on Firefox Android [42][43]. A third-person game with vehicles needs a **complete touch scheme**: virtual stick, camera drag, context buttons, and vehicle throttle/steer/brake. That is a separate UX and design workstream (analysis).
- **Texture formats:** mobile needs ETC2/ASTC rather than BC [13], which reinforces the KTX2/Basis choice (analysis).
- **Distribution:** the CrazyGames mobile homepage requires ≤20 MB initial [30].

### 7.2 Recommendation

**Mobile is not in the MVP, and not a v1.0 commitment. Re-evaluate after v1.0 as an "experimental tablet tier"** (iPad on iOS 26+ and recent flagship Android with Chrome). **Confidence: Medium.**

**Justification:**

1. The visual bar (CSM, AO, bloom, whole-moon terrain) conflicts with mobile memory kills and sustained-thermal limits [28][58].
2. Android support depends on GPU and OS version [1].
3. The touch controls for vehicles are a large design cost.
4. Desktop is where the 60 FPS and 30 FPS targets are defined.

**Keep the door open at low cost (analysis):**

- Use KTX2/Basis textures.
- Add an input-abstraction layer so actions are separated from devices.
- Use render-scale-based dynamic resolution and per-preset memory budgets.
- Avoid a hard dependency on Keyboard Lock.
- Show mobile visitors a friendly "desktop recommended" page, optionally with a spectator view.

---

## 8. Headless and automated testing

### 8.1 Findings

- **Headless Chrome disables the GPU by default.** On a Linux machine with an NVIDIA GPU, Chrome's own guide enables WebGPU/WebGL acceleration with `--no-sandbox --headless=new --use-angle=vulkan --enable-features=Vulkan --disable-vulkan-surface --enable-unsafe-webgpu`. Without a working driver, ANGLE reports a **SwiftShader** renderer and `chrome://gpu` shows "Software only". The guide verifies acceleration by reading `chrome://gpu` through automation (Puppeteer) [59]. **High.**
- **The automatic SwiftShader WebGL fallback is deprecated.** Deprecation began in Chrome 130 and removal on desktop is around Chrome 137. Software WebGL now needs an opt-in flag, `--enable-unsafe-swiftshader` (one Chromium commit spells it `--allow-unsafe-swiftshader`). Windows is moving to **WARP** as the software fallback (planned for Chrome 139). Chrome measured SwiftShader fallback at about 2.7% of WebGL contexts [60][61][62]. **Medium-High.**
- **GitHub-hosted GPU runners:** a 4-core machine with one **Tesla T4**, 28 GB RAM and 16 GB VRAM, on Ubuntu and Windows. Generally available since 2024-07-08. Plan eligibility (Team vs Enterprise) is unclear in the sources found [63][64]. **Medium.**
- **Screenshot stability:** Playwright says rendering "can vary based on the host OS, version, settings, hardware, power source… headless mode". Its advice is to compare only against baselines generated **in the same environment**. It offers `threshold`, `maxDiffPixels` and `stylePath` to filter volatile elements [65]. **High.**
- **Firefox/WebKit under Playwright:** Firefox WebGPU on Linux is Nightly-only [1], so expect no WebGPU in Firefox on Ubuntu CI (inference). WebGPU in Playwright's Linux WebKit build is **unknown**. Whether Chrome exposes a WebGPU **fallback (SwiftShader) adapter** in headless mode on a GPU-less Linux runner is also **unknown**. Web3D Survey sees fallback adapters on only 0.04% of working adapters [13], which suggests they are rarely exposed. Needs a spike.

### 8.2 Recommendation: two lanes

| Lane | Where | Browser setup | What it checks | Baselines |
|---|---|---|---|---|
| **CI smoke** | GitHub-hosted Ubuntu, no GPU | Playwright Chromium headless with the software path (`--enable-unsafe-swiftshader` for WebGL2; WebGPU via fallback adapter **if** the spike proves it works) | Boots, adapter and device creation or a graceful fallback, no WebGPU validation errors, deterministic **debug scenes** render non-blank, DOM UI flows | CI-generated only, with tolerant diffs. Never compared with real-GPU images |
| **Real-GPU visual and performance** | Developer machines, a self-hosted runner, or the GitHub T4 runner (nightly) | Chromium headed, or `--headless=new` with the Linux GPU flags [59]. Confirm acceleration through `chrome://gpu` before trusting results [59] | Visual regression of fixed camera paths, frame-time capture per preset, pipeline warm-up time | **Per GPU, OS and driver** baseline sets [65] |

**Determinism checklist (analysis):**

- Fixed RNG seeds, scripted camera paths, and fixed canvas size and DPR.
- Disable dynamic resolution, TAA and other temporal effects in capture mode.
- Wait for N frames and for GPU work to finish before capturing.
- Capture the canvas and the DOM separately, and mask volatile UI [65].

---

## Recommended budgets

These are **engineering targets (analysis)**, derived from §3–§5. They are not sourced facts and must be validated by a rendering spike on reference hardware (RTX 4060 Laptop, Iris Xe 96EU, Arc 140V).

| Budget | **Tier B: integrated** (Low/Medium) | **Tier A: discrete laptop** (High) | **Desktop / high-end** (Ultra) |
|---|---|---|---|
| Reference GPUs | Iris Xe 96EU, Arc 140V, Radeon 680M/780M class [17][18][19] | RTX 4050/4060/5050/5060 Laptop [17] | RTX 4070+/5070-class desktop [17] |
| Output resolution | 1920×1080 [16] | 1920×1080 to 2560×1600 [16] | Up to 3840×2160 [16] |
| Internal render scale (dynamic-resolution range) | 0.5–0.75 (e.g. 960×540 to 1440×810), DPR capped at 1.0 | 0.75–1.0, DPR capped at 1.5 | 0.67–1.0 |
| Target FPS / frame time | **30 / 33.3 ms** (stretch: 45) | **60 locked / 16.7 ms** | 60 locked (uncapped optional) |
| CPU main thread per frame | ≤14 ms: sim + net 4, animation 2, cull + encode 4, UI 1, garbage-collection slack 3 | ≤8 ms: sim + net 2.5, animation 1.5, cull + encode 2.5, UI 0.5, slack 1 | ≤8 ms |
| GPU per frame | ≤28 ms: shadows (2 cascades) 4, opaque + terrain 10, AO (half-res) 3, particles 2, dust pass 1, post 3, headroom 5 | ≤14 ms: shadows (3–4 cascades) 2.5, opaque + terrain 5, AO 1.5, particles 1, dust pass 0.5, post 1.5, headroom 2 | ≤14 ms at higher scale and quality |
| GPU memory (all allocations) | **≤1.0–1.5 GB** (shared memory, half-RAM OS cap [20]) | **≤3 GB** (of 6–8 GB VRAM [16]) | ≤5–6 GB (12–16 GB cards [16]) |
| Texture pool (part of the above) | ≤512–768 MB | ≤1.5–2 GB | ≤3 GB |
| Shadow maps | 2 × 1024–2048 | 4 × 2048 | 4 × 4096 |
| Draw calls per frame | ≤800–1,200 (WebGL2 fallback: ≤800) | ≤2,500–4,000 | ≤5,000 |
| Triangles per frame | ≤1–2 M | ≤4–6 M | ≤10 M |
| Download to first playable or lobby | **≤20 MB** (CrazyGames mobile-homepage threshold [30]) | ≤20 MB | ≤20 MB |
| Download to full first session | ≤40–50 MB (Low/Medium pack; CrazyGames cap 50 MB [30]) | ≤80–120 MB (High pack streamed) | ≤250 MB total (CrazyGames total cap with SDK [31]) |

---

## Contradictions and uncertainty

1. **WebGPU coverage:** Can I use reports 88.63% [3] and Web3D Survey 81.52% [13]. They use different methods: browser-version share versus working adapters from a sample.
2. **Firefox on macOS:** Can I use notes say "macOS 26 Tahoe or later on Apple Silicon" [4]. MDN, for Firefox 147, says **all macOS versions** on Apple silicon [10], and the wiki agrees [1]. The Can I use note is out of date.
3. **Chrome Android:** Can I use shows unqualified support [4], while the wiki gates it by Android version and GPU vendor [1].
4. **Version mislabeling:** some secondary summaries attribute "Linux 144 / NVIDIA 147" to Firefox. These are **Chrome** versions [1][7][9].
5. **Poki size target:** under 8 MB on the requirements page [32] versus ≤5 MB initial and 8 MB total in the developer guide [33][34].
6. **Memory64 in Firefox:** version 134 [23][24] versus 143 or later [25].
7. **`devicePixelContentBoxSize` in Firefox:** version 93 versus 108, from two revisions of the same web.dev article [49].
8. **SwiftShader opt-in flag spelling:** `--enable-unsafe-swiftshader` versus `--allow-unsafe-swiftshader` [60][61].
9. **GitHub GPU runner eligibility:** third-party sources disagree (Team or Enterprise Cloud versus Enterprise only), and no official statement was found [63][64].
10. **Steam extraction:** the summary page and the video-card page gave slightly different shares for the same GPUs, for example RTX 4060 Laptop 3.40% vs 3.60% and RTX 3060 3.62% vs 3.78% [16][17]. This is likely because they use different denominators. The summary extraction also listed "Apple M2 2.14%", which is absent from the video-card table, so it was **excluded**. Video-card page values are used.
11. **Throughput numbers** came from Notebookcheck search snippets. The Radeon 780M figure was not obtained because the page returned HTTP 403 [18][19].
12. **iOS memory thresholds** circulating in third-party guides were not confirmed by any primary source [28][29].
13. **Vercel pre-compressed assets:** a community report says they are re-compressed [38], and the official docs are silent.

**Important unknowns:**

- Firefox Linux/Android WebGPU ship versions.
- Safari's optional WebGPU feature set: timestamp-query, subgroups, and BC on iOS.
- Whether headless Chrome on a GPU-less runner exposes a WebGPU fallback adapter.
- WebGPU in Playwright's Firefox and WebKit builds.
- Details of Keyboard Lock, Fullscreen and OffscreenCanvas (not verified this session).
- Whether COEP affects the WebSocket connection to Render.
- The real frame cost of our renderer on Iris Xe. This is the biggest risk and needs a prototype.

---

## Implications for our game

1. **WebGPU-first renderer.** Treat WebGL2 as an optional "Low/compat" path only if the engine supplies it. Write dust-mask updates so they can run as compute or as fragment ping-pong (§2.3).
2. **Stay within default limits.** Use a tiled cube-sphere layout for terrain and dust masks: no texture over 8192 px (4096 if compatibility mode is ever targeted), storage bindings of 128 MiB or less, and buffers of 256 MiB or less [12].
3. **Formats:** use RGBA16F for HDR and never require linear filtering of 32-bit float textures [13][15]. Deliver KTX2/Basis textures transcoded to BC7/BC5 on desktop.
4. **Dynamic resolution:** drive it from `timestamp-query` where available (100 µs rounding in Chrome is fine at millisecond scale [6]), and fall back to CPU frame-time heuristics.
5. **Robustness:** add device-lost recovery, per-preset memory accounting, and adapter-based default presets [12][5].
6. **Loading:** ≤20 MB to the lobby, async warm-up of every pipeline during the lobby, immutable hashed assets on Vercel with Brotli [35][36], and streamed High/Ultra packs.
7. **Input and audio:** a single "Play" click should unlock audio, request pointer lock (with `unadjustedMovement` feature-detected) and enter fullscreen [41][42][48]. Esc is reserved for unlock/menu. Gamepads use the standard mapping and are polled every frame [47].
8. **No COOP/COEP in the MVP,** so no SharedArrayBuffer or wasm threads. If threads become necessary, use `require-corp`, self-host all assets, and verify the Render WebSocket and any login popups first [51][52].
9. **Networking:** the server is authoritative, clients have an "away" state, and returning clients resynchronize from a snapshot. This is required because of background throttling [54].
10. **Platform scope:** Windows and macOS desktop on Chrome, Edge, Firefox or Safari 26, plus Linux on Chrome with Intel or NVIDIA (Wayland). Show a clear unsupported-browser page elsewhere. **Mobile comes after v1.0** (§7.2).
11. **Testing:** run CI smoke tests on software rendering and keep real-GPU baselines per device. Run a **spike** to confirm whether WebGPU works headless on a GPU-less runner (§8).
12. **First spike:** measure PBR + cascaded shadows + AO + bloom + whole-moon terrain + compute dust on an RTX 4060 Laptop, an Iris Xe 96EU and an Arc 140V. This validates or corrects the budgets table.

---

## Sources

All sources accessed 2026-11-11. "Search-result summary" means the content came from the search tool's summary or snippet and the page itself was not opened. "Not re-verified" means it comes from prior knowledge and was not re-checked this session.

1. GPU for the Web — "Implementation Status" wiki (last edited 2026-10-02) — https://github.com/gpuweb/gpuweb/wiki/Implementation-Status — accessed 2026-11-11 — standards-group wiki (official)
2. web.dev — "WebGPU is now supported in major browsers" (2025-11-25) — https://web.dev/blog/webgpu-supported-major-browsers — accessed 2026-11-11 — browser-vendor blog
3. Can I use — "WebGPU" — https://caniuse.com/webgpu — accessed 2026-11-11 — compatibility database
4. Can I use source data — `webgpu.json` — https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/webgpu.json — accessed 2026-11-11 — compatibility database (raw data)
5. Chrome for Developers — "What's New in WebGPU" (index, Chrome 130–156 entries) — https://developer.chrome.com/docs/web-platform/webgpu/news — accessed 2026-11-11 — browser-vendor release notes
6. Chrome for Developers — "What's New in WebGPU (Chrome 121)" — https://developer.chrome.com/blog/new-in-webgpu-121 — accessed 2026-11-11 — browser-vendor release notes
7. Chrome for Developers — "What's New in WebGPU (Chrome 144)" — https://developer.chrome.com/blog/new-in-webgpu-144 — accessed 2026-11-11 — browser-vendor release notes (search-result summary)
8. Chrome for Developers — "What's New in WebGPU (Chrome 146)" (2026-02-25) — https://developer.chrome.com/blog/new-in-webgpu-146 — accessed 2026-11-11 — browser-vendor release notes
9. Chrome for Developers — "What's New in WebGPU (Chrome 147-148)" — https://developer.chrome.com/blog/new-in-webgpu-147-148 — accessed 2026-11-11 — browser-vendor release notes (search-result summary)
10. MDN — "Firefox 147 release notes for developers" — https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/147 — accessed 2026-11-11 — browser-vendor release notes (search-result summary)
11. WebKit blog — "WebKit Features in Safari 26.0" (2025-09-15) — https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ — accessed 2026-11-11 — browser-vendor release notes
12. W3C — "WebGPU", Candidate Recommendation Draft (2026-09-15) — https://www.w3.org/TR/webgpu/ — accessed 2026-11-11 — specification
13. Web3D Survey — "WebGPU" — https://web3dsurvey.com/webgpu — accessed 2026-11-11 — community telemetry
14. Can I use — "WebGL 2.0" — https://caniuse.com/webgl2 — accessed 2026-11-11 — compatibility database
15. Web3D Survey — "WebGL2" — https://web3dsurvey.com/webgl2 — accessed 2026-11-11 — community telemetry
16. Valve — "Steam Hardware & Software Survey: October 2026" (summary page) — https://store.steampowered.com/hwsurvey/Steam-Hardware-Software-Survey-Welcome-to-Steam — accessed 2026-11-11 — hardware survey
17. Valve — Steam Hardware & Software Survey, video cards (October 2026) — https://store.steampowered.com/hwsurvey/videocard/ — accessed 2026-11-11 — hardware survey
18. Notebookcheck — "NVIDIA GeForce RTX 4060 Laptop GPU vs Intel Arc Graphics 140V" — https://www.notebookcheck.net/NVIDIA-GeForce-RTX-4060-Laptop-GPU-vs-Arc-140V_11455_12693.247598.0.html — accessed 2026-11-11 — benchmark database (search-result snippet)
19. Notebookcheck — "Intel Iris Xe Graphics G7 96EUs vs NVIDIA GeForce RTX 4060 Laptop GPU vs Intel Iris Xe Graphics G7 80EUs" — https://www.notebookcheck.net/Iris-Xe-G7-96EUs-vs-NVIDIA-GeForce-RTX-4060-Laptop-GPU-vs-Iris-Xe-G7-80EUs_10364_11455_10395.247598.0.html — accessed 2026-11-11 — benchmark database (search-result snippet)
20. Intel Support — Article 000020962 (maximum graphics memory for Intel graphics) — https://www.intel.com/content/www/us/en/support/articles/000020962/graphics.html — accessed 2026-11-11 — GPU-vendor documentation (search-result summary)
21. Intel Support — Article 000095032 (graphics memory limit explanation) — https://www.intel.com/content/www/us/en/support/articles/000095032.html — accessed 2026-11-11 — GPU-vendor documentation (search-result summary)
22. Intel Support — Article 000101789 (Shared GPU Memory Override) — https://www.intel.com/content/www/us/en/support/articles/000101789.html — accessed 2026-11-11 — GPU-vendor documentation (search-result summary)
23. web-features explorer — "Memory64 (WebAssembly)" — https://web-platform-dx.github.io/web-features-explorer/features/wasm-memory64/ — accessed 2026-11-11 — W3C WebDX Community Group data (search-result summary)
24. Can I use — "Memory64 (WebAssembly)" — https://caniuse.com/wf-wasm-memory64 — accessed 2026-11-11 — compatibility database (search-result summary)
25. SciChart — "Memory64: Unlocking WebAssembly's True Potential with 16GB of In-Browser Memory" — https://www.scichart.com/blog/memory64-unlocking-webassemblys-true-potential-with-16gb-of-in-browser-memory/ — accessed 2026-11-11 — vendor blog (search-result summary)
26. WebAssembly/spec issue #1892 — "wasm64: support memory larger than 16 GB" — https://github.com/WebAssembly/spec/issues/1892 — accessed 2026-11-11 — standards issue tracker (search-result summary)
27. V8 blog — "Up to 4GB of memory in WebAssembly" — https://v8.dev/blog/4gb-wasm-memory — accessed 2026-11-11 — browser-engine blog (not re-verified; page not opened)
28. WebKit Bugzilla — Bug 300782 (heavy-WebGL pages terminated under iOS memory pressure and reloaded) — https://bugs.webkit.org/show_bug.cgi?id=300782 — accessed 2026-11-11 — bug tracker (search-result summary)
29. Apple Developer Forums — "Browser memory limit on IOS" — https://developer.apple.com/forums/thread/741624 — accessed 2026-11-11 — vendor forum (search-result listing)
30. CrazyGames Docs — "Technical requirements" — https://docs.crazygames.com/requirements/technical/ — accessed 2026-11-11 — game-portal guidelines (search-result summary)
31. CrazyGames Docs — "Requirements" introduction — https://docs.crazygames.com/requirements/intro/ — accessed 2026-11-11 — game-portal guidelines (search-result summary)
32. Poki — "New requirements" — https://sdk.poki.com/new-requirements — accessed 2026-11-11 — game-portal guidelines (search-result summary)
33. Poki for Developers — "Web game engines" guide — https://developers.poki.com/guide/web-game-engines — accessed 2026-11-11 — game-portal guidelines (search-result summary)
34. Defold — "Optimizing game size" manual — https://defold.com/manuals/optimization-size — accessed 2026-11-11 — engine documentation (search-result summary)
35. Vercel Docs — "Vercel CDN Compression" — https://vercel.com/docs/compression — accessed 2026-11-11 — hosting documentation (search-result summary)
36. Vercel Docs — "Cache-Control headers" — https://vercel.com/docs/caching/cache-control-headers — accessed 2026-11-11 — hosting documentation (search-result summary)
37. Vercel Docs — "Static Configuration with vercel.json" — https://vercel.com/docs/project-configuration/vercel-json — accessed 2026-11-11 — hosting documentation (search-result summary)
38. Vercel Community — "BREAKING CHANGE: pre-compressed assets re-compressed at the edge" — https://community.vercel.com/t/breaking-change-pre-compressed-assets-re-compressed-at-the-edge/18744 — accessed 2026-11-11 — community forum (search-result summary)
39. Basis Universal README (Skia mirror of BinomialLLC/basis_universal) — https://skia.googlesource.com/external/github.com/BinomialLLC/basis_universal/+/ee626cec19e8e2d206bfc127296dfd9519352dc6 — accessed 2026-11-11 — library documentation (search-result summary)
40. Sascha Willems — "Texture compression in Vulkan" (Vulkanised 2021 slides) — https://saschawillems.de/files/Vulkanised_2021_texture_compression_in_vulkan.pdf — accessed 2026-11-11 — conference talk (search-result summary)
41. MDN — "Element: requestPointerLock() method" — https://developer.mozilla.org/en-US/docs/Web/API/Element/requestPointerLock — accessed 2026-11-11 — reference documentation
42. Can I use — "Element API: requestPointerLock: options.unadjustedMovement parameter" — https://caniuse.com/mdn-api_element_requestpointerlock_options_unadjustedmovement_parameter — accessed 2026-11-11 — compatibility database (search-result summary)
43. Mozilla Bugzilla — Bug 2037802 (unadjustedMovement release note; Android `NotSupportedError`) — https://bugzilla.mozilla.org/show_bug.cgi?id=2037802 — accessed 2026-11-11 — bug tracker (search-result summary)
44. web.dev — "Disable mouse acceleration to provide a better FPS gaming experience" — https://web.dev/articles/disable-mouse-acceleration — accessed 2026-11-11 — browser-vendor article (search-result summary)
45. MDN — "Keyboard API" — https://developer.mozilla.org/en-US/docs/Web/API/Keyboard_API — accessed 2026-11-11 — reference documentation
46. WICG — "Keyboard Lock" (draft specification; linked from [45]) — https://wicg.github.io/keyboard-lock/ — accessed 2026-11-11 — specification draft (page not opened)
47. MDN — "Using the Gamepad API" — https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API — accessed 2026-11-11 — reference documentation
48. MDN — "Autoplay guide for media and Web Audio APIs" — https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay — accessed 2026-11-11 — reference documentation
49. web.dev — "Pixel-perfect rendering with devicePixelContentBox" — https://web.dev/articles/device-pixel-content-box — accessed 2026-11-11 — browser-vendor article (search-result summary)
50. webkit-unassigned mailing list — Bug 264158 "Support devicePixelContentBoxSize with ResizeObserver" — https://lists.webkit.org/pipermail/webkit-unassigned/2023-November/1130864.html — accessed 2026-11-11 — bug tracker archive (search-result summary)
51. MDN — "Cross-Origin-Embedder-Policy" — https://developer.mozilla.org/docs/Web/HTTP/Headers/Cross-Origin-Embedder-Policy — accessed 2026-11-11 — reference documentation (search-result summary)
52. Can I use — "Cross-Origin-Embedder-Policy: credentialless" — https://caniuse.com/mdn-http_headers_cross-origin-embedder-policy_credentialless — accessed 2026-11-11 — compatibility database (search-result summary)
53. CentralCSP — "Cross-Origin-Embedder-Policy" guide — https://next.centralcsp.com/en/docs/web-security/policies/cross-origin-embedder-policy — accessed 2026-11-11 — third-party guide (search-result summary)
54. Chrome for Developers — blog post on heavy throttling of chained JS timers in Chrome 88 — https://developer.chrome.com/blog/timer-throttling-in-chrome-88 — accessed 2026-11-11 — browser-vendor blog
55. MDN — "Window: requestAnimationFrame() method" — https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame — accessed 2026-11-11 — reference documentation (not re-verified; page not opened)
56. Android Developers — "Thermal API" (Android Dynamic Performance Framework) — https://developer.android.com/games/optimize/adpf/thermal — accessed 2026-11-11 — OS-vendor documentation (search-result summary)
57. Android Developers — "Best practices for ADPF" — https://developer.android.com/games/optimize/adpf/best-practices-adpf — accessed 2026-11-11 — OS-vendor documentation (search-result summary)
58. Android Developers — "NCSoft Lineage W improves sustained performance and prevents thermal throttling by using ADPF" — https://developer.android.com/stories/games/lineagew-adpf — accessed 2026-11-11 — OS-vendor case study (search-result summary)
59. Chrome for Developers — "Supercharge Web AI model testing: WebGPU, WebGL, and Headless Chrome" — https://developer.chrome.com/blog/supercharge-web-ai-testing — accessed 2026-11-11 — browser-vendor blog
60. Chromium docs — "Using Chromium with SwiftShader" — https://chromium.googlesource.com/chromium/src/+/da170c2267b2201954efe1c8fa5d2d89ab09f7bf/docs/gpu/swiftshader.md — accessed 2026-11-11 — browser-vendor documentation (search-result summary)
61. blink-dev — "Intent to Remove: SwiftShader Fallback" — https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM — accessed 2026-11-11 — browser-vendor mailing list (search-result summary)
62. Esri Support — KB 000038872 (ArcGIS Maps SDK for JavaScript and Chrome's SwiftShader change) — https://support.esri.com/en-us/knowledge-base/usage-of-arcgis-maps-sdk-for-javascript-with-chrome-whe-000038872 — accessed 2026-11-11 — third-party vendor knowledge base (search-result summary)
63. GitHub Changelog — "GitHub Actions: GPU hosted runners are now generally available" (2024-07-08) — https://github.blog/changelog/2024-07-08-github-actions-gpu-hosted-runners-are-now-generally-available — accessed 2026-11-11 — vendor changelog (search-result summary)
64. GitHub Docs — Larger runners reference, machine sizes (Chinese-language edition) — https://docs.github.com/zh/actions/reference/runners/larger-runners — accessed 2026-11-11 — vendor documentation (search-result summary)
65. Playwright — "Visual comparisons" — https://playwright.dev/docs/test-snapshots — accessed 2026-11-11 — tool documentation
66. web.dev — "Web Vitals" — https://web.dev/articles/vitals — accessed 2026-11-11 — browser-vendor documentation (not re-verified; page not opened)
67. MDN — "WebGPU API" — https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API — accessed 2026-11-11 — reference documentation (search-result summary; compatibility mode described as a subset for OpenGL ES 3.1 / Direct3D 11)
68. WebKit Bugzilla — Bug 299237 (Safari 26 WebGPU on macOS 15; `navigator.gpu` requires macOS Tahoe 26+) — https://bugs.webkit.org/show_bug.cgi?id=299237 — accessed 2026-11-11 — bug tracker (search-result summary)
