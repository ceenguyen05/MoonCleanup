# Tooling & Library Versions: Current Releases, Licenses and Maintenance

**Date:** 2026-11-11 · **Author:** research subagent P2j · **Scope:** research and documentation only (no code or config) · **Method:** npm registry packuments, the GitHub Releases API and official docs, all accessed 2026-11-11

**Conventions used in every table**

- **Version** is the npm `dist-tags.latest` value unless the row says otherwise. **Released** is `time[<version>]` from the same registry document (UTC date).
- **Status rubric:**
  - **Active** means the latest stable release is 90 days old or less.
  - **Slow** means it is between 90 days and 12 months old.
  - **Dormant** means it is more than 12 months old.
  - **Superseded/Deprecated** means maintainers flagged it or replaced it.
- **Unpacked** is npm `dist.unpackedSize`. That is the install footprint, not the size of the shipped bundle.
- **ESM-only** means the package is `"type":"module"` and its `exports` map has no `require` condition.
- **Source [1]** is the registry packument at `https://registry.npmjs.org/<package-name>`. The exact URLs are listed under Sources.

---

## Executive summary

- **Node.js on 2026-11-11:**
  - **v26 "Lithium"** is **Active LTS**. It was promoted on 2026-10-28, and the latest release is **26.13.1** (2026-11-10, security).
  - **v24 "Krypton"** has been in **Maintenance LTS** since 2026-10-20, with EOL on 2028-04-30.
  - **v22 "Jod"** is in Maintenance LTS until 2027-04-30.
  - **There is no "Current" line.** v27 is in **Alpha** (27.0.0-alpha, 2026-10-29) under the new one-major-per-year model, and 27.0.0 is due in April 2027.
  - **Recommendation:** `.nvmrc` = `26.13.1` and `engines.node` = `26.x`. Vercel's default is 26.x, and Render reads `.nvmrc`. [2][3][4][5][14][15]
- **Corepack is no longer shipped with Node ≥ 25,** so it is not in Node 26 LTS. pnpm must be installed explicitly: through `pnpm/action-setup@v6`, npm, or the standalone installer. The userland `corepack` package is 0.36.0. [6][7][8]
- **pnpm 12.18.0 is npm `latest`** (2026-11-05). pnpm 12 is a **Rust rewrite**: 12.0.0 shipped on 2026-08-26 and kept pnpm 11's lockfile and CLI. **pnpm 11.28.9** is still maintained as a fallback. Vercel auto-detects lockfile 9.0 as pnpm 9/10, so pin the install command. [1][9][12][13]
- **TypeScript 7.0.2 (the native Go compiler) is `latest`** (2026-07-08), but it ships **no programmatic API**.
  - typescript-eslint 8.72.2 declares the peer range `typescript >=4.8.4 <6.1.0`.
  - **Recommendation:** pin **typescript 6.0.3** as the tool-facing `typescript`. Optionally run 7.0.2 under an alias for fast CLI type-checks; Microsoft documents this side-by-side pattern. [1][16]
- **Build and test stack:**
  - **Vite 8.3.8** (2026-11-11) is Rolldown-powered. Rolldown has been stable since 1.0.0 on 2026-05-07 and is now at 1.3.2.
  - **Vitest 5.1.0** (2026-11-02) has browser mode through `@vitest/browser-playwright` 5.1.0.
  - **Playwright 1.65.0** (2026-11-05). [1]
- **WebGPU in headless CI is the riskiest test item.** No Playwright doc covers it. Chrome docs say WebGPU needs a hardware or emulated GPU plus flags on Linux. Third-party reports describe black canvas screenshots in headless mode on Windows and Linux. Run a spike: either a GPU runner or headed + Xvfb, with WebGL2 baselines. [39][40][41]
- **Rendering and physics:**
  - **three r187** is 0.187.0 (2026-10-30), with `@types/three` 0.187.0.
  - **Rapier 0.21.0** (2026-09-25) is the same version across all variants: base, `-compat`, `-simd` and `-deterministic`.
  - **Jolt reached 1.x** with `jolt-physics` 1.1.1 (2026-10-23).
  - **Havok** is `@babylonjs/havok` 1.3.14. [1][43][44]
- **Colyseus 0.18** shipped in August 2026:
  - **Versions:** `colyseus` 0.18.12, `@colyseus/core` 0.18.28 and `@colyseus/schema` **5.0.47**.
  - **Client SDK renamed:** the client is now **`@colyseus/sdk` 0.18.10**, replacing `colyseus.js`.
  - **Test tooling:** `@colyseus/testing` 0.18.6 and `@colyseus/loadtest` 0.18.4 are current.
  - **uWebSockets.js v20.71.0** is GitHub-only. It ships prebuilt binaries for Node 22, 24 and 26. [1][30][31][32][33]
- **Data layer:**
  - **drizzle-orm 0.45.4** is `latest`; 1.0.0-rc.5 is on the `rc` tag.
  - **drizzle-kit 0.31.11** and **mysql2 3.24.6**.
  - **Prisma's `latest` tag points at 8.0.0-rc.33.** The latest stable release is 7.10.1. [1]
- **UI layer:**
  - **Framework sizes (min+gzip, Bundlephobia):** **Preact 11.2.0** is 5.0 kB, **Solid 1.9.19** is 8.6 kB, **Svelte 5.57.3**'s runtime entry is 10.8 kB and **Lit 3.3.3** is 6.0 kB. **React 19.3.1** is not meaningfully measured there.
  - **Motion 14.12.0** is the full package at 63.3 kB.
  - **GSAP 3.15.1** is free, plugins included. Its license **forbids use in no-code visual-animation builders that compete with Webflow**. [1][47][48]
- **CI:** use `actions/checkout@v7` (v7.0.1), `actions/setup-node@v7` (v7.1.0) and `pnpm/action-setup@v6` (v6.1.1), plus actionlint 1.7.12. **Dependabot supports pnpm v7–v12** under the `npm` ecosystem, and it also supports `github-actions`. [18][19][20][21][22]
- **Observability:** `@sentry/browser`, `@sentry/node` and `@sentry/vite-plugin` are all aligned at **11.12.0** (2026-11-10). **pino** is at 10.4.0. [1]

---

## 1. Runtime & tooling

### 1.1 Node.js release status on 2026-11-11

| Line | Codename | Status on 2026-11-11 | Key dates (nodejs/Release `schedule.json`) | Latest release (date) | Notes | Src |
|---|---|---|---|---|---|---|
| v27 | none yet | **Alpha** (not for production) | alpha 2026-10-28 → 27.0.0 2027-04-22 → LTS 2027-10-20 → EOL 2030-04-30 | 27.0.0-alpha.0.0.0 (2026-10-29) | First line under the annual model. ABI 153. | [2][3][4][5] |
| **v26** | **Lithium** | **Active LTS** (since 2026-10-28) | start 2026-05-05; maintenance 2027-10-20; EOL 2029-04-30 | **26.13.1** (2026-11-10, security) | First LTS build was 26.13.0 (2026-10-28). Bundles npm 11.20.0. ABI 147. | [2][3][4] |
| v25 | none | EOL (2026-06-01) | none | 25.9.0 (2026-03-31) | n/a | [2][3] |
| v24 | Krypton | **Maintenance LTS** (since 2026-10-20) | EOL 2028-04-30 | 24.22.3 (2026-11-10, security) | ABI 137. Render's default for new services is 24.22.1. | [2][3][15] |
| v22 | Jod | **Maintenance LTS** | EOL 2027-04-30 | 22.23.5 (2026-11-11, security) | ABI 127 | [2][3] |
| v20 | Iron | EOL (2026-04-30) | none | 20.20.2 (2026-03-24) | n/a | [2][3] |

- **How nodejs.org labels these:** the nodejs.org "Previous Releases" table shows v27 = *Alpha* and v26/v24/v22 = *LTS*, without Active or Maintenance labels. The Active vs Maintenance phase comes from `schedule.json`. The page says: *"Starting with Node.js 27, the release cycle will be annual and every major version will move to LTS status after its six-month Current phase (and six additional months of Alpha phase)."* [4]
- **What the release-schedule blog says** (last updated 2026-03-10): *"Starting with 27.x, Node.js will move from two major releases per year to one."* It adds that *"Every release becomes LTS"* and that *"Node.js 26 follows the existing schedule. This is the last release line under the current model."* The schedule *"is not final and may be amended."* [5]
- **Verdict:** standardize on **Node 26 LTS**. Write `26.13.1` in `.nvmrc` and `"engines": {"node": "26.x"}`. Platform support:
  - **Vercel** offers only 26.x (the default), 24.x and 22.x. It selects the major from `engines.node`; its docs do not mention `.nvmrc`.
  - **Render** resolves the version in this order: `NODE_VERSION` → `.node-version` → `.nvmrc` → `engines`. [14][15]

### 1.2 Package manager, monorepo, build and TypeScript

| Package | Latest stable | Released | License | Status | Engines / format | Fit | Gotchas | Src |
|---|---|---|---|---|---|---|---|---|
| pnpm | **12.18.0** | 2026-11-05 | MIT | Active (weekly) | The npm package needs Node ≥18. pnpm 12 itself is a native executable. | Monorepo package manager | **Rust rewrite** since 12.0.0 (2026-08-26). It keeps pnpm 11's CLI, config, lockfile and store [12]. Other tags: `next-12` = 12.19.0 (2026-11-10), `latest-11` = 11.28.9 (2026-10-27), `latest-10` = 10.34.9 (2026-10-25). pnpm 11 does **not** support Node 18/20 [9]. | [1][9][10][11][12] |
| corepack (userland) | 0.36.0 | 2026-08-28 | MIT | Active | node ^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0 | Optional; honors `packageManager` | **Not bundled with Node ≥25.** v25.0.0 notes: *"build: stop distributing Corepack"*. The latest-v26 Corepack doc returns 404. | [1][6][7][8] |
| turbo (Turborepo) | **2.11.10** (npm) | 2026-10-20 | MIT | Active | Native binary | Task graph and caching over pnpm workspaces | **Disagreement:** GitHub has release v2.11.11 (2026-11-11), but npm `latest` was still 2.11.10 when accessed. `canary` = 2.11.11-canary.2. | [1][17] |
| nx (alternative only) | 24.0.6 | 2026-11-10 | MIT | Active | CJS; ~21 MB unpacked | Heavier alternative | Fast major cadence: 22.0.0 (2025-10-22), 23.0.0 (2026-06-16), 24.0.0 (2026-10-21) | [1] |
| vite | **8.3.8** | 2026-11-11 | MIT | Active | node ^20.19.0 \|\| >=22.12.0; **ESM-only** | Client dev server and bundler | Vite 8.0.0 (2026-03-12) depends on `rolldown ~1.2.18` and `lightningcss`; esbuild is now an *optional* peer. `previous` = 6.4.6 (2026-11-09 backport). | [1] |
| rolldown | 1.3.2 | 2026-11-11 | MIT | Active | Same engines; ESM-only; native binary | Comes through Vite 8; use directly only for libraries | **Stable since 1.0.0 (2026-05-07).** | [1] |
| typescript | **7.0.2** | 2026-07-08 | Apache-2.0 | Active (`beta` 7.1.0-beta 2026-10-20; nightly `next`) | Native Go compiler; ESM-only package | Fast `tsc` type-checking | The 7.0 post says *"it does not ship with an API"*; a new API is expected in 7.1. That **breaks API consumers**: typescript-eslint, ts-json-schema-generator, and Vue/Svelte/Astro editor tooling. | [1][16] |
| typescript (6.x line) | **6.0.3** | 2026-04-16 | Apache-2.0 | Maintained line | JS implementation | **Tool-facing `typescript`** | typescript-eslint peer: `>=4.8.4 <6.1.0` | [1] |
| @typescript/typescript6 | 6.0.2 | 2026-07-06 | Apache-2.0 | Compatibility shim | Binary `tsc6` | Microsoft's side-by-side 6.0 API package | One patch behind `typescript@6.0.3` | [1][16] |
| @typescript/native-preview | 7.0.0-dev.20260707.2 | 2026-07-07 | Apache-2.0 | **Superseded** by `typescript@7` | n/a | Do not use | Frozen since 7.0 went GA | [1] |
| tsx | 4.23.15 | 2026-09-20 | MIT | Active | node ≥18; uses esbuild ~0.28.0 | Runs the TS server and scripts in dev | Strips types only; it does no type-checking | [1] |
| esbuild | 0.28.2 | 2026-08-08 | MIT | Active (roughly quarterly) | node ≥18; native binary | Production server bundle | Pre-1.0: any 0.x minor can break | [1] |
| tsup | 9.0.0 | 2026-10-14 | MIT | Active (new major) | node ^22.18.0 \|\| ^24.11.0 \|\| >=26.0.0; esbuild ^0.28.2 | Legacy library bundler | 9.0.0 is 4 weeks old | [1] |
| tsdown | 0.23.7 | 2026-11-06 | MIT | Active | Same engines; **ESM-only**; rolldown ~1.3.0 | Rolldown-based successor to tsup for shared packages | Pre-1.0. Optional peer `typescript` ^5 \|\| ^6 \|\| ^7. | [1] |
| @types/node | 26.6.6 | 2026-10-28 | MIT | Active | n/a | Match the Node 26 runtime | `old-version` tag = 24.19.2 | [1] |

**Notes**

- **pnpm on hosts:**
  - **Vercel** lists pnpm 6–12 as supported, but its auto-detection maps `lockfileVersion: 9.0` to *"pnpm 9 or 10"*. To get pnpm 11/12 you need Corepack (`packageManager`) or an `installCommand` override. Corepack is not bundled in Node 26.
  - **Plan:** have the install command fetch the pinned pnpm, and verify in build logs. [13]
- **TypeScript strategy:** Microsoft recommends `typescript@npm:@typescript/typescript6` plus a second alias (`@typescript/native` → `typescript@^7.0.2`) so that `tsc` runs 7.0 while tools import 6.0. Pinning the real `typescript@6.0.3` works the same way for tools. [16]

---

## 2. Lint / format

| Package | Latest stable | Released | License | Status | Engines / notes | Fit | Gotchas | Src |
|---|---|---|---|---|---|---|---|---|
| eslint | **10.14.0** | 2026-10-30 | MIT | Active | node ^20.19.0 \|\| ^22.13.0 \|\| >=24 | Primary linter (flat config `eslint.config.*`) | v10 line. The `maintenance` tag is 9.39.5 (2026-07-10). Use flat config only; whether eslintrc was fully removed in v10 was not re-verified. | [1] |
| @eslint/js | 10.0.1 | 2026-02-06 | MIT | Stable (rarely changes) | Peer eslint ^10 | Recommended rules | Versioned separately from `eslint` | [1] |
| typescript-eslint | **8.72.2** | 2026-11-09 | MIT | Active (weekly) | Peers: eslint ^8.57 \|\| ^9 \|\| ^10 and **typescript >=4.8.4 <6.1.0** | TS and type-aware rules | **Does not support TS 7** (no API), so keep TS 6.0.3 | [1][16] |
| prettier | **3.10.0** | 2026-11-11 | MIT | Active | node ≥14 | Formatter | v4 is still alpha (4.0.0-alpha.13, 2025-11-18) | [1] |
| eslint-config-prettier | 10.1.8 | 2025-07-18 | MIT | Stable / slow | n/a | Turns off rules that conflict with Prettier | n/a | [1] |
| @biomejs/biome (alternative) | 2.6.6 | 2026-11-06 | MIT OR Apache-2.0 | Active | Native binary | Lint and format in one tool | Rule parity with typescript-eslint was not evaluated | [1] |
| oxlint | 1.93.0 | 2026-11-09 | MIT | Active | node ^20.19.0 \|\| >=22.12.0; ESM; native | Fast first-pass linter alongside ESLint | Rule coverage differs from ESLint | [1] |
| oxfmt (watch) | 0.78.0 | 2026-11-09 | MIT | Active | Pre-1.0; ~8.8 MB unpacked | Prettier-like formatter | Pre-1.0 | [1] |

---

## 3. Testing

| Package / tool | Latest stable | Released | License | Status | Engines / format | Fit | Gotchas | Src |
|---|---|---|---|---|---|---|---|---|
| vitest | **5.1.0** | 2026-11-02 | MIT | Active | node ^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0; peer vite ^6.4 \|\| ^7 \|\| ^8 | Unit and integration tests for the shared sim and server | 5.x is new (`rc` 5.0.0-rc.4 on 2026-08-31). The `V4` tag 4.1.12 (2026-10-15) is still patched. | [1] |
| @vitest/browser + @vitest/browser-playwright | 5.1.0 | 2026-11-02 | MIT | Active | ESM-only; peers `vitest@5.1.0` and `playwright` | Browser-mode tests (HUD/DOM, WebGL) | The provider is a separate package; keep every `@vitest/*` on the same exact version | [1] |
| @playwright/test / playwright | **1.65.0** | 2026-11-05 | Apache-2.0 | Active | node ≥20 | E2E tests and screenshot capture (`toHaveScreenshot()`) | Docs warn that rendering *"can vary based on the host OS, version, settings, hardware…"*, so keep baselines per OS and runner | [1][39] |
| k6 | **v2.3.0** | 2026-09-21 | AGPL-3.0 (per repo; not re-verified) | Active | Go binary (not npm); `@types/k6` 2.3.1 for typings | Protocol-level WebSocket load tests | The current module is `k6/websockets`; `k6/ws` is legacy [35]. k6 can't import Node or game client code. | [1][34][35] |
| artillery | 2.0.34 | 2026-08-14 | MPL-2.0 | Active (`canary` 2026-10-19) | node ≥22.18.0; ESM-only | YAML/JS scenarios with `engine: ws` | Heavy dependency tree | [1][36] |
| Toxiproxy (server/CLI) | **v2.13.0** | 2026-10-14 | MIT (per repo; not re-verified) | Active | Go binary / Docker | Latency, jitter, bandwidth and slicer faults between bots and server | TCP-level only, which is fine for WebSockets. New: optional bearer auth through `TOXIPROXY_AUTH_TOKEN`. | [37] |
| toxiproxy-node-client | 4.1.0 | 2026-04-26 | ISC | Slow | node ≥18 | Drive faults from tests | Community client | [1] |
| @colyseus/testing | 0.18.6 | 2026-09-23 | MIT | Active | node ≥22 | In-process room tests (if Colyseus is chosen) | Tied to the Colyseus minor version | [1] |
| @colyseus/loadtest | 0.18.4 | 2026-10-22 | MIT | Active | node ≥22 | Spawns N bot clients; fits the 16-bot test | `legacy-0.17` = 0.17.9 | [1] |
| pixelmatch | **8.0.0** | 2026-10-06 | ISC | Active | **ESM-only** | Pure-JS image diff | New major, 5 weeks old | [1] |
| odiff-bin | 4.5.0 | 2026-07-23 | MIT | Slow | Native binary | Fast diff for large screenshot sets | Per-platform binaries | [1][38] |
| pngjs | 7.0.0 | 2023-02-20 | MIT | Dormant (stable) | node ≥14.19.0 | PNG decoding for pixelmatch | n/a | [1] |

**Headless WebGPU (Playwright/Chromium).** No Playwright doc was found on this. The facts gathered:

- Chrome's troubleshooting page (updated 2025-10-17) says WebGPU *"requires a GPU (either hardware or software-emulated)"*. On Linux it says *"you'll also need to enable the `chrome://flags/#enable-vulkan` flag"* together with `enable-unsafe-webgpu`. [40]
- A third-party guide (secondary source) reports that headless needs `--enable-unsafe-webgpu`, that Linux uses SwiftShader Vulkan, and that canvas screenshots can come out **black** on Windows and Linux in headless mode. [41]
- The Chrome Web AI testing post uses `--headless=new` and `--use-angle=vulkan`. [42]

**Plan:**

- A Phase-0 spike to prove WebGPU screenshots on the chosen CI runner.
- Keep WebGL2-fallback baselines.
- Mask HUD and dynamic regions, and set `maxDiffPixelRatio` thresholds.

**Latency and loss injection without Toxiproxy:** use a test-only transport wrapper that adds delay, jitter, drops and reordering in the bot and server send queues. On Linux runners there is also OS-level `tc netem`. Neither needs a package.

---

## 4. Rendering & graphics libraries (versions only)

| Package | Latest stable | Released | License | Status | Notes / gotchas | Src |
|---|---|---|---|---|---|---|
| three | **0.187.0** (r187) | 2026-10-30 | MIT | Active (monthly) | Contains WebGPURenderer and TSL. 0.x: every monthly minor can break; r187 *"Remove[d] code deprecated in r177."* ~20 MB unpacked. | [1][43] |
| @types/three | 0.187.0 | 2026-10-30 | MIT | Active | Keep in lockstep with the `three` minor | [1] |
| three-mesh-bvh | 0.9.18 | 2026-11-03 | MIT | Active | Pre-1.0 | [1] |
| postprocessing (pmndrs) | 6.39.6 | 2026-11-01 | Zlib | Active | v6 is built for WebGLRenderer. v7 is in prerelease (`beta` 7.0.0-beta.16, `alpha` 7.0.0-alpha.4); its WebGPU support was **not verified**. With WebGPURenderer, use three's TSL post-processing. | [1] |
| stats-gl | 4.2.3 | 2026-07-10 | MIT | Slow | WebGPU support not re-verified | [1] |
| @react-three/fiber | 9.8.2 | 2026-10-14 | MIT | Active | Only if React is chosen. v10 is in prerelease (`alpha` 10.0.0-alpha.6). WebGPU status in v9/v10 not re-verified. | [1] |
| @react-three/drei | 10.7.9 | 2026-09-25 | MIT | Active | `alpha` = 11.0.0-alpha.7 | [1] |
| @babylonjs/core | 9.35.0 | 2026-11-06 | Apache-2.0 | Active (weekly) | ESM-only; ~70 MB unpacked | [1] |
| playcanvas | 2.24.0 | 2026-11-09 | MIT | Active | node ≥18.3.0 for tooling. The `lts` tag = 1.77.0. ~63 MB unpacked. | [1] |

---

## 5. Physics

| Package | Latest | Released | License | Status | Unpacked | Loading / format | SIMD / threads | Determinism | Src |
|---|---|---|---|---|---|---|---|---|---|
| @dimforge/rapier3d | **0.21.0** | 2026-09-25 | Apache-2.0 | Active | 4.8 MB | ESM with a separate `.wasm` import, so the bundler must support WASM | None required | See note | [1] |
| @dimforge/rapier3d-compat | **0.21.0** | 2026-09-25 | Apache-2.0 | Active | 14.3 MB | WASM embedded as base64; works in Vite and Node without plugins (async init) | None required | See note | [1] |
| @dimforge/rapier3d-simd / -simd-compat | 0.21.0 | 2026-09-25 | Apache-2.0 | Active | 5.0 / 15.1 MB | As above | Needs WASM SIMD | Not specified (avoid when bit-exactness matters) | [1] |
| @dimforge/rapier3d-deterministic / -deterministic-compat | 0.21.0 | 2026-09-25 | Apache-2.0 | Active | 4.8 / 14.4 MB | As above | n/a | Variant built for determinism | [1] |
| jolt-physics (JoltPhysics.js) | **1.1.1** | 2026-10-23 | MIT | Active | 44.5 MB (many builds) | **ESM-only**. Entry points: `wasm-compat` (embedded), `wasm`, `asm`, `*-multithread`, `debug-*`. | Multithread builds need SharedArrayBuffer, which requires cross-origin isolation (COOP/COEP headers) | 1.1.1 *"Removed `PhysicsSettings.mDeterministicSimulation`"*. Cross-platform determinism of the JS builds is **unverified**. | [1][44][46] |
| @babylonjs/havok | 1.3.14 | 2026-07-29 | MIT | Slow | 4.2 MB | ESM + `.wasm` | Unverified | Unverified | [1] |

**Determinism note:**

- Rapier's JS guide states: *"The WASM/Typescript/JavaScript version of Rapier is fully cross-platform deterministic."* It warns that inputs must also come from deterministic operations, and that `Math.sin`/`cos` *"are not cross-platform determinis[tic]"*. [45]
- Separate `-deterministic` packages also exist. If client prediction and server reconciliation rely on bit-exact replay, use the **same variant and same exact version on client and server** (for example `-deterministic-compat@0.21.0`), and confirm with a cross-OS replay test.

---

## 6. Animation

| Item | Version | Released | License | Status | Fit / notes | Src |
|---|---|---|---|---|---|---|
| three built-ins: `AnimationMixer`, `AnimationUtils`, addons `SkeletonUtils` (retarget helpers) and `CCDIKSolver` | Ship with three 0.187.0 | 2026-10-30 | MIT | Active | Default blending and crossfades. r187 fixed *"AnimationUtils – cubic spline additive reference sampling"*. | [1][43] |
| @pixiv/three-vrm | 3.5.5 | 2026-07-09 | MIT | Slow | Humanoid normalization; useful as a retarget reference | [1] |
| closed-chain-ik | 0.0.3 | 2023-05-04 | Apache-2.0 | **Dormant** | General IK solver; not maintained on npm since 2023 | [1] |
| **Blender (latest stable)** | **5.3.0** | 2026-11-10 (download mirror) | GPL | Active | Newest feature release | [49] |
| **Blender LTS** | **5.2 LTS**, latest patch **5.2.4** | 5.2 released 2026-07-14; 5.2.4 on 2026-11-10 | GPL | Active | Supported until July 2028 (per release page via search; blender.org blocked direct fetch). endoflife.date says full support ended 2026-11-10 and critical fixes run to 2028-07-14. | [49][50][51] |
| Blender 4.5 LTS | 4.5.9 latest verified (2026-04-21) | n/a | GPL | Maintenance | The mirror directory changed on 2026-11-10, so a newer 4.5 patch may exist (**unverified**) | [49] |
| Blender glTF exporter | Bundled with Blender (versioned with Blender) | n/a | n/a | n/a | Export from the LTS line for reproducibility | [49] |

**Mixamo alternatives for tooling:** Blender Rigify (bundled), Auto-Rig Pro (paid add-on), Reallusion AccuRIG, Cascadeur and Mesh2Motion. Versions and licenses for these were **unverified** in this pass, so verify them before adopting one.

---

## 7. UI layer (DOM/CSS HUD overlay)

| Package | Latest | Released | License | Status | Min+gzip (Bundlephobia) | Fit for frequent game-state updates | Gotchas | Src |
|---|---|---|---|---|---|---|---|---|
| solid-js | **1.9.19** | 2026-11-10 | MIT | Active | 8.6 kB | Excellent: fine-grained signals update only the bound nodes | `next` = **2.0.0-rc.21**, so API changes are coming | [1][48] |
| preact | **11.2.0** | 2026-11-06 | MIT | Active | 5.0 kB | Good with signals | Preact 11 is new (10.29.8 on 2026-08-01); check third-party compatibility | [1][48] |
| @preact/signals | 2.11.4 | 2026-10-27 | MIT | Active | 3.7 kB | Signal-bound text skips the VDOM diff | n/a | [1][48] |
| svelte | 5.57.3 | 2026-10-26 | MIT | Active | 10.8 kB (runtime entry only; compiled output varies) | Good (runes) | Needs the Svelte compiler plugin; node ≥18 | [1][48] |
| react / react-dom | 19.3.1 | 2026-10-14 | MIT | Active | Not representative (Bundlephobia measures only the 1.5 kB root entry, not the client renderer) | Weakest at 60 Hz unless state is kept outside React (external store + refs) | Largest ecosystem; R3F | [1][48] |
| lit | 3.3.3 | 2026-05-14 | BSD-3-Clause | Slow | 6.0 kB | Good (web components) | ESM-only | [1][48] |
| Vanilla custom elements | Platform API | n/a | n/a | n/a | 0 kB | Best raw control | More boilerplate | n/a |
| motion (motion.dev) | **14.12.0** | 2026-11-10 | MIT | Active | 63.3 kB for the full package (tree-shaken subsets not measured) | Springs and gestures; vanilla + React APIs | 13.x ended 2026-10-02, so majors move fast | [1][48] |
| gsap | 3.15.1 | 2026-11-04 | **"Standard 'no charge' license"** (proprietary, Webflow) | Active | 27.4 kB (core) | Timelines | `beta` = 4.0.0-beta.4. See the license quotes below. | [1][47][48] |
| @react-spring/web | 10.1.2 | 2026-06-24 | MIT | Slow | Not measured | React-only springs | n/a | [1] |
| @vanilla-extract/css | 1.21.3 | 2026-10-08 | MIT | Active | 0 runtime (build-time CSS) | Typed CSS | Needs its Vite plugin (version not checked) | [1] |
| CSS Modules | Built into Vite 8 | n/a | n/a | n/a | 0 | Simplest scoped CSS | n/a | [1] |
| tailwindcss + @tailwindcss/vite | **4.3.5** | 2026-11-06 | MIT | Active | Build-time | Utility CSS | `v3-lts` = 3.4.19 | [1] |

**GSAP license.** These are excerpts from gsap.com/standard-license (*"Last modified date: May 30, 2025"*, effective April 30, 2025), as returned by the fetch tool:

- **Grant:** *"Webflow grants you a non-exclusive, worldwide license to use, reproduce, display, and implement GSAP Products"*.
- **Commercial use:** allowed (*"Commercial usage is covered under the standard license."*). The former members-only plugins, such as SplitText and MorphSVG, are included at no charge.
- **Prohibited uses:** tools *"that allow users to build visual animations without code"* when they *"encourage, induce, or materially assist"* a solution competing with *"Webflow's visual animation building capabilities"*. Prohibited uses need *"prior written consent."*
- **Implication:** GSAP is fine for a game HUD, but it is **not OSI open source**.

[47]

---

## 8. Netcode-adjacent

| Package | Latest | Released | License | Status | Engines / format | Fit | Gotchas | Src |
|---|---|---|---|---|---|---|---|---|
| colyseus | **0.18.12** | 2026-11-07 | MIT | Active (near-daily patches) | node ≥22 | Authoritative room server framework | 0.x minors break compatibility. The 0.18 blog lists built-in client prediction and lag compensation, plus request/response messages. | [1][33] |
| @colyseus/core | 0.18.28 | 2026-11-10 | MIT | Active | node ≥22 | Core server | `legacy-0.17` = 0.17.56 | [1] |
| @colyseus/schema | **5.0.47** | 2026-11-11 | MIT | Active | n/a | State sync | **Schema 5: at most 63 fields per Schema** (down from 64) | [1][33] |
| @colyseus/sdk | **0.18.10** | 2026-11-10 | MIT | Active | n/a | **Client SDK (replaces `colyseus.js`)** | Browser bundle *"about 58 KB gzip"* per the blog | [1][33] |
| colyseus.js | 0.16.22 | 2025-10-22 | MIT | **Superseded** | n/a | Do not use with 0.18 | n/a | [1] |
| @colyseus/ws-transport / @colyseus/uwebsockets-transport | 0.18.5 / 0.18.5 | 2026-11-10 | MIT | Active | node ≥22 | Transport choice | n/a | [1] |
| uWebSockets.js | **v20.71.0** (GitHub tag) | 2026-09-16 | Apache-2.0 (per repo; not re-verified) | Active | **Not on the npm registry**; install from the GitHub tag. Prebuilt `.node` files for ABI 127/137/147 (Node 22/24/26) on linux x64/arm64, darwin x64/arm64 and win32 x64. | Highest-throughput WebSocket server | No Node 27 (ABI 153) binary yet. No musl/Alpine binary in the file list. | [30][31][3] |
| ws | **8.22.2** | 2026-11-08 | MIT | Active | node ≥10; CJS | Default WebSocket server | n/a | [1] |
| msgpackr | 2.1.4 | 2026-11-02 | MIT | Active | n/a | Compact binary messages | New major (`previous` = 1.12.1) | [1] |
| @msgpack/msgpack | 3.1.3 | 2025-12-26 | ISC | Slow | node ≥18 | Reference MessagePack | n/a | [1] |
| @bufbuild/protobuf + @bufbuild/protoc-gen-es | 2.17.0 | 2026-11-05 | Apache-2.0 AND BSD-3-Clause / Apache-2.0 | Active | protoc-gen-es needs node ≥22 | Schema-first binary protocol | Adds a code-generation step | [1] |
| flatbuffers | 25.9.23 | 2025-09-24 | Apache-2.0 | Dormant (>12 months) | n/a | Zero-copy messages | Needs the `flatc` compiler | [1] |
| @geckos.io/snapshot-interpolation | 1.1.1 | 2025-02-22 | BSD-3-Clause | Dormant | CJS | Snapshot interpolation helper | Small enough to reimplement; overlaps with Colyseus 0.18's built-in prediction | [1] |
| bitecs | 0.4.0 | 2025-12-06 | **MPL-2.0** | Slow | n/a | High-performance struct-of-arrays ECS | Pre-1.0; MPL is file-level copyleft | [1] |
| miniplex | 2.0.0 | 2023-07-16 | MIT | **Dormant** | n/a | Object ECS | No release in 3+ years | [1] |
| koota | 0.6.6 | 2026-04-09 | ISC | Slow (canary 2026-11-10) | n/a | Data-oriented ECS | Pre-1.0 | [1] |
| @lastolivegames/becsy | 0.16.1 | 2026-10-02 | MIT | Active | node ≥16; ESM-only | ECS | Pre-1.0 | [1] |

---

## 9. Schemas / validation

| Package | Latest | Released | License | Status | Fit | Gotchas | Src |
|---|---|---|---|---|---|---|---|
| zod | **4.6.7** | 2026-10-12 | MIT | Active | Runtime validation with inferred types. Zod 4 has built-in JSON Schema output (`z.toJSONSchema`). | ~5.9 MB unpacked (includes v3-compat and mini builds); `zod/mini` for client bundles | [1] |
| valibot | 1.5.0 | 2026-09-09 | MIT | Active | Smallest tree-shakable validator for client payloads | JSON Schema through `@valibot/to-json-schema` 1.8.0 (2026-09-11) | [1] |
| typebox (successor) | **1.4.6** | 2026-11-08 | MIT | Active | Types *are* JSON Schema, which suits data-driven balance config | ESM-only. Successor of `@sinclair/typebox`. | [1] |
| @sinclair/typebox | 0.34.52 | 2026-07-11 | MIT | Legacy line | Only for existing code | n/a | [1] |
| zod-to-json-schema | 3.25.2 | 2026-03-27 | ISC | Slow | Not needed with Zod 4 | n/a | [1] |
| ts-json-schema-generator | 2.9.0 | 2026-03-04 | MIT | Slow | Generates JSON Schema from TS types | node ≥22. Uses the TS compiler API, so it needs TS 6. A `native` tag (3.0.0-native.6) is in prerelease. | [1] |

**JSON Schema options for data-driven balance config:**

1. **TypeBox 1.x (preferred):** the schema is the source of truth, and it validates both the editor JSON and the runtime data.
2. **Zod 4** with `z.toJSONSchema()`, if Zod is used elsewhere.
3. **Valibot** with `@valibot/to-json-schema`.
4. **ts-json-schema-generator**, if the types are written first. It is tied to TS 6.

---

## 10. Data

| Package | Latest stable | Released | License | Status | Engines / format | Fit | Gotchas | Src |
|---|---|---|---|---|---|---|---|---|
| drizzle-orm | **0.45.4** | 2026-10-08 | Apache-2.0 | Active | Dual ESM/CJS | Typed SQL, MySQL dialect over mysql2 | **1.0.0-rc.5 on the `rc` tag** (2026-10-21), so a major migration is pending; pre-1.0 | [1] |
| drizzle-kit | 0.31.11 | 2026-09-21 | MIT | Active | n/a | Migrations | Must move with drizzle-orm when 1.0 lands | [1] |
| prisma (CLI) | **7.10.1** stable; npm `latest` tag = **8.0.0-rc.33** (2026-11-06) | 2026-10-15 | Apache-2.0 | Active | 8.0 RC engines: ^22.18 \|\| ^24.11 \|\| >=26 | Alternative ORM | **Registry anomaly:** `latest` points at an RC, so pin exact versions | [1] |
| @prisma/client | 7.10.1 | 2026-10-15 | Apache-2.0 | Active | node ^20.19 \|\| ^22.12 \|\| >=24.0 | n/a | ~71 MB unpacked | [1] |
| kysely | 0.29.8 | 2026-11-01 | MIT | Active | node ≥22; ESM-only | Query builder alternative | `release-0.28` = 0.28.19; 0.30 is in beta | [1] |
| mysql2 | **3.24.6** | 2026-10-13 | MIT | Active | CJS | Driver for Aiven MySQL (TLS) | n/a | [1] |

---

## 11. Asset pipeline & audio

| Item | Latest | Released | License | Status | Format / runtime | Fit | Gotchas | Src |
|---|---|---|---|---|---|---|---|---|
| @gltf-transform/core, /functions, /extensions | **4.5.1** | 2026-09-28 | MIT | Active | Dual ESM/CJS | Programmatic glTF pipeline | `next` = 4.4.0-alpha.1 (stale tag) | [1] |
| @gltf-transform/cli | 4.5.1 | 2026-09-28 | MIT | Active | node ≥20; ESM-only | `gltf-transform` CLI (dedup, prune, meshopt, KTX2) | KTX2 encoding calls the external KTX-Software CLI (per gltf-transform docs; not re-verified) | [1] |
| KTX-Software (`ktx` CLI, libktx, JS bindings) | **v4.4.2** | 2025-10-04 | Apache-2.0 (per repo; not re-verified) | Slow (13 months since the last stable release) | Native binaries per OS | ETC1S/UASTC KTX2 encoding | v4.4.2 *"replaces v4.4.1 which has been withdrawn"* (version-number fix). Whether `toktx` is kept or deprecated was not re-verified. | [23] |
| basis_universal | **v2.50** (tag `v2_50`) | 2026-08-03 | Apache-2.0 (per repo; not re-verified) | Slow/Active | C++ encoder | Basis encoder | v2.50 adds *"XUASTC with in-loop deblocking, XUBC7, DDS support"*. Stick to ETC1S/UASTC unless three's transcoder is confirmed to read newer modes. | [24] |
| meshoptimizer / gltfpack | **1.3.0** (GitHub v1.3) | 2026-09-25 | MIT | Active | gltfpack npm is a WASM build (node ≥18); ESM | Simplification, quantization and meshopt compression | Reached 1.x (0.25.0 was 2025-08-20) | [1][25] |
| draco3d / draco3dgltf | 1.5.9 | 2026-10-16 | Apache-2.0 | Active | WASM | Draco geometry compression | Release notes recommend the versioned gstatic decoders | [1][26] |
| FFmpeg | **9.0.2 "Lei"** (top of the download page); also listed: 8.1.3 "Hoare", 8.0.3 "Huffman" | 9.0.x date **unverified**; 8.1 released 2026-03-16 | LGPL/GPL depending on build (not re-verified) | Active | Native | Encode Opus (libopus) and fallback formats | Pin the version in the asset-build container | [27][28] |
| opus-tools (`opusenc`) | **unverified** | n/a | n/a | n/a | n/a | Alternative Opus encoder | opus-codec.org could not be fetched | [29] |
| howler | 2.2.4 | 2023-09-19 | MIT | **Dormant** | CJS | Simple audio sprites | No release in 3+ years | [1] |
| tone | npm `latest` = 15.1.22 (2025-04-27); `next` = **15.5.66** (2026-10-31) | see left | MIT | Active on `next` | ESM-only | Music and synth scheduling | Registry tag anomaly. Overkill for SFX. | [1] |
| Raw Web Audio | Platform API | n/a | n/a | n/a | n/a | **Recommended for SFX** behind a thin wrapper | n/a | n/a |

---

## 12. Observability

| Package | Latest | Released | License | Status | Engines | Fit | Gotchas | Src |
|---|---|---|---|---|---|---|---|---|
| @sentry/browser | **11.12.0** | 2026-11-10 | MIT | Active | >=20.19.0 <22 \|\| >=22.12.0 <23 \|\| >=23.2.0 | Client errors and performance | The `v10` tag (10.78.0) is still maintained | [1] |
| @sentry/node | **11.12.0** | 2026-11-10 | MIT | Active | Same | Game-server errors and tracing | n/a | [1] |
| @sentry/vite-plugin | **11.12.0** | 2026-11-10 | MIT | Active | Same | Source-map upload at build time | The version jumped from 5.4.1 (2026-10-06) to 11.12.0, now aligned with SDK numbering | [1] |
| pino | **10.4.0** | 2026-10-02 | MIT | Active | CJS | Structured JSON server logs | n/a | [1] |
| pino-pretty | 13.2.0 | 2026-10-04 | MIT | Active | n/a | Dev-only pretty printer | n/a | [1] |

---

## 13. CI

| Item | Latest | Released | Status | Use | Notes | Src |
|---|---|---|---|---|---|---|
| actions/checkout | **v7.0.1**, so use `@v7` | 2026-07-20 | Active | Checkout | Consider pinning to a commit SHA | [18] |
| actions/setup-node | **v7.1.0**, so use `@v7` | 2026-10-08 | Active | Node from `.nvmrc` | 7.1.0 adds `mise.toml` support | [19] |
| pnpm/action-setup | **v6.1.1**, so use `@v6` | 2026-11-03 | Active | Installs pnpm (required, since Node 26 has no Corepack) | 6.1.1 notes mention a "native bootstrap" fix | [20] |
| actionlint | **v1.7.12** | 2026-03-30 | Slow | Workflow linting | Go binary | [21] |
| Dependabot | n/a | Docs accessed 2026-11-11 | n/a | Version and security updates | The `npm` ecosystem covers **npm v7–v12 and pnpm v7–v12**. `github-actions` is supported. Lockfile-format details were not stated on the page. | [22] |

---

## 14. Recommended pinned versions

| Package / tool | Pin | Why |
|---|---|---|
| Node (`.nvmrc`) | **26.13.1** | Active LTS; Vercel default (26.x); Render reads `.nvmrc`; uWS has ABI-147 binaries |
| `engines.node` | **26.x** | Vercel selects the major from `engines` |
| pnpm (`packageManager`) | **12.18.0** (fallback 11.28.9) | npm `latest`; supported by Vercel, Dependabot and action-setup. A young Rust rewrite, hence the 11.x fallback. |
| turbo | **2.11.10** | npm `latest` (GitHub already shows 2.11.11) |
| typescript (tool-facing) | **6.0.3** | Needed by typescript-eslint (<6.1.0) and API consumers |
| typescript (native `tsc`, aliased) | **7.0.2** | ~10× faster CI type-checks; no API |
| @types/node | **26.6.6** | Matches the runtime |
| vite | **8.3.8** | Current; Rolldown-based |
| tsx / esbuild | **4.23.15 / 0.28.2** | Dev runner / production server bundle |
| tsdown (optional) | **0.23.7** | Shared-package builds (pre-1.0) |
| eslint / @eslint/js / typescript-eslint | **10.14.0 / 10.0.1 / 8.72.2** | Flat config; TS rules |
| prettier (or biome) | **3.10.0** (or 2.6.6) | Formatter |
| vitest / @vitest/browser-playwright | **5.1.0 / 5.1.0** | Keep every `@vitest/*` identical |
| @playwright/test | **1.65.0** | E2E + `toHaveScreenshot` |
| pixelmatch | **8.0.0** | ESM image diff |
| k6 / Toxiproxy (binaries) | **v2.3.0 / v2.13.0** | WebSocket load and fault injection |
| @colyseus/loadtest / @colyseus/testing | **0.18.4 / 0.18.6** | 16-bot tests (if Colyseus) |
| three / @types/three | **0.187.0 / 0.187.0** | Lockstep minors |
| three-mesh-bvh / stats-gl | **0.9.18 / 4.2.3** | Raycasts / profiling |
| @dimforge/rapier3d-compat (or -deterministic-compat) | **0.21.0** | Same variant and version on client and server |
| solid-js **or** preact + @preact/signals | **1.9.19** or **11.2.0 + 2.11.4** | Fine-grained HUD updates (pick one) |
| motion | **14.12.0** | MIT springs (vanilla + React) |
| colyseus / @colyseus/schema / @colyseus/sdk / transport | **0.18.12 / 5.0.47 / 0.18.10 / 0.18.5** | Patches are frequent, so pin exact versions |
| uWebSockets.js (GitHub tag) or ws | **v20.71.0** or **8.22.2** | uWS = throughput; ws = simplicity |
| msgpackr | **2.1.4** | If using a custom binary protocol |
| zod or typebox | **4.6.7** or **1.4.6** | Validation / JSON Schema config |
| drizzle-orm / drizzle-kit / mysql2 | **0.45.4 / 0.31.11 / 3.24.6** | MySQL on Aiven; plan the 1.0 migration |
| @gltf-transform/cli (+core/functions/extensions) | **4.5.1** | glTF optimization |
| gltfpack / meshoptimizer | **1.3.0** | Meshopt compression |
| KTX-Software / basisu | **v4.4.2 / v2.50** | KTX2 encoding (native binaries in the asset container) |
| @sentry/browser / @sentry/node / @sentry/vite-plugin | **11.12.0** (all) | Aligned SDK line |
| pino / pino-pretty | **10.4.0 / 13.2.0** | Server logs |
| actions/checkout / setup-node / pnpm/action-setup | **@v7 / @v7 / @v6** | Current majors |
| actionlint | **1.7.12** | Workflow linting |
| Blender | **5.2 LTS (5.2.4)** | Reproducible exports through July 2028 |

### Watch-outs

1. **TypeScript 7 has no programmatic API.** Every tool that imports `typescript` (typescript-eslint, ts-json-schema-generator, some editors and plugins) must stay on 6.0.x until the 7.1 API arrives. [16]
2. **Node 26 has no Corepack.** CI, Vercel and Render must install pnpm explicitly. Vercel's auto-detection maps lockfile 9.0 to pnpm 9/10. [7][13]
3. **pnpm 12 is a 2.5-month-old Rust rewrite.** Keep pnpm 11.28.x as the rollback option. On Windows, pnpm's docs recommend installing through npm because Defender may block the standalone executable. [9][12]
4. **Pre-1.0 packages** (any minor can break):
   - three 0.187, three-mesh-bvh 0.9 and Rapier 0.21
   - Colyseus 0.18, drizzle-orm 0.45 (1.0 RC pending), drizzle-kit 0.31 and kysely 0.29
   - esbuild 0.28, tsdown 0.23 and oxfmt 0.78
   - bitecs 0.4, koota 0.6 and becsy 0.16
5. **ESM-only:**
   - vite, rolldown, vitest, @vitest/browser*, tsdown and typescript 7
   - pixelmatch 8, typebox 1.x, kysely, lit and tone
   - jolt-physics, @babylonjs/core, @gltf-transform/cli, gltfpack, artillery, oxlint and becsy
6. **Native binaries:**
   - JS toolchain: pnpm 12, turbo, esbuild, rolldown/lightningcss (Vite 8), Biome, oxlint and odiff
   - **uWebSockets.js:** GitHub-only, with per-ABI binaries for Node 22/24/26 only; no musl build in the file list
   - Standalone tools: k6 and Toxiproxy (Go); KTX-Software and basisu (C++); Playwright browsers
7. **WASM weight (npm unpacked):**
   - rapier3d-compat is 14.3 MB (base64-embedded WASM) and rapier3d is 4.8 MB.
   - jolt-physics is 44.5 MB across all its builds; import a single entry point.
   - havok is 4.2 MB.
   - Jolt's multithreaded builds need COOP/COEP cross-origin isolation, which also restricts third-party embeds.
8. **Headless WebGPU in CI is unproven.** Spike it early, keep WebGL2 screenshot baselines, and keep baselines per OS and GPU. [39][40][41]
9. **Licenses to note:**
   - **GSAP:** proprietary, free, with a Webflow-competitor restriction. [47]
   - **MPL-2.0:** bitecs and artillery.
   - **AGPL-3.0:** k6, per its repo (not re-verified); this only matters if k6 is modified or redistributed.
10. **Dormant dependencies:** howler (2023), miniplex (2023), closed-chain-ik (2023), @geckos.io/snapshot-interpolation (2025-02) and flatbuffers (2025-09). Avoid them, or vendor them.
11. **Colyseus 0.18 breaking changes:** `colyseus.js` was replaced by `@colyseus/sdk`, `client.id` was removed, Schema is capped at 63 fields, and metadata is now replaced rather than merged. [33]

### Discrepancies log (registry vs docs)

- **Turborepo:** GitHub has release **v2.11.11** (2026-11-11), but npm `latest` = **2.11.10** (2026-10-20). [1][17]
- **Colyseus 0.18 date:** the blog is dated **2026-08-20**, while the GitHub release "0.18" was published **2026-08-25**. [32][33]
- **prisma:** npm `latest` = **8.0.0-rc.33**, but `@prisma/client` `latest` = **7.10.1**. [1]
- **tone:** npm `latest` = 15.1.22 (2025-04-27), while `next` = 15.5.66 (2026-10-31). [1]
- **@typescript/typescript6:** the shim is at 6.0.2, but `typescript` 6.0.3 exists. [1]
- **pnpm `latest`:** Socket's article said `latest` still pointed to pnpm 11 at the time of publication. The registry now shows `latest` = 12.18.0. [1][12]
- **Node.js labels:** the nodejs.org table shows only "LTS", without Active or Maintenance; the phase dates come from `schedule.json`. Render's default for new services is 24.22.1, while the newest 24.x is 24.22.3. [2][3][4][15]

---

## Sources

All sources were accessed on 2026-11-11.

1. npm registry packuments (`dist-tags`, `time`, `license`, `engines`, `type`/`exports`, `dist.unpackedSize`, `readme`), one per package. URL pattern: `https://registry.npmjs.org/<package-name>`. Packages queried:
   - **Runtime and build:** pnpm, corepack, turbo, nx, vite, rolldown, typescript, @typescript/native-preview, @typescript/typescript6, tsx, esbuild, tsup, tsdown, @types/node
   - **Lint and format:** eslint, @eslint/js, typescript-eslint, @typescript-eslint/parser, @typescript-eslint/typescript-estree, prettier, eslint-config-prettier, @biomejs/biome, oxlint, oxfmt
   - **Testing:** vitest, @vitest/browser, @vitest/browser-playwright, @playwright/test, playwright, artillery, @colyseus/testing, @colyseus/loadtest, pixelmatch, odiff-bin, pngjs, toxiproxy-node-client, @types/k6
   - **Rendering:** three, @types/three, three-mesh-bvh, postprocessing, stats-gl, @react-three/fiber, @react-three/drei, @babylonjs/core, playcanvas
   - **Physics:** @dimforge/rapier3d, @dimforge/rapier3d-compat, @dimforge/rapier3d-simd, @dimforge/rapier3d-simd-compat, @dimforge/rapier3d-deterministic, @dimforge/rapier3d-deterministic-compat, jolt-physics, @babylonjs/havok
   - **Animation:** closed-chain-ik, @pixiv/three-vrm
   - **UI and CSS:** solid-js, preact, @preact/signals, svelte, react, react-dom, lit, motion, gsap, @react-spring/web, @vanilla-extract/css, tailwindcss, @tailwindcss/vite
   - **Netcode and ECS:** colyseus, @colyseus/core, @colyseus/schema, colyseus.js, @colyseus/sdk, @colyseus/uwebsockets-transport, @colyseus/ws-transport, ws, msgpackr, @msgpack/msgpack, @bufbuild/protobuf, @bufbuild/protoc-gen-es, flatbuffers, @geckos.io/snapshot-interpolation, bitecs, miniplex, koota, @lastolivegames/becsy
   - **Schemas:** zod, valibot, @sinclair/typebox, typebox, zod-to-json-schema, @valibot/to-json-schema, ts-json-schema-generator
   - **Data:** drizzle-orm, drizzle-kit, prisma, @prisma/client, kysely, mysql2
   - **Assets and audio:** @gltf-transform/core, @gltf-transform/cli, @gltf-transform/functions, @gltf-transform/extensions, meshoptimizer, gltfpack, draco3d, draco3dgltf, howler, tone
   - **Observability:** @sentry/browser, @sentry/node, @sentry/vite-plugin, pino, pino-pretty
2. Node.js Release schedule (machine-readable) — https://raw.githubusercontent.com/nodejs/Release/main/schedule.json — accessed 2026-11-11
3. Node.js distribution index (versions, dates, LTS codenames, `modules` ABI) — https://nodejs.org/dist/index.json — accessed 2026-11-11
4. Node.js — Previous Releases — https://nodejs.org/en/about/previous-releases — accessed 2026-11-11
5. Node.js blog — Evolving the Node.js Release Schedule — https://nodejs.org/en/blog/announcements/evolving-the-nodejs-release-schedule — accessed 2026-11-11
6. Node.js v25.8.0 docs — Corepack — https://nodejs.org/download/release/v25.8.0/docs/api/corepack.html — accessed 2026-11-11
7. Node.js v25.0.0 (Current) release notes — https://nodejs.org/en/blog/release/v25.0.0 — accessed 2026-11-11
8. Node.js latest-v26.x docs — Corepack (HTTP 404) — https://nodejs.org/docs/latest-v26.x/api/corepack.html — accessed 2026-11-11
9. pnpm — Installation (compatibility table) — https://pnpm.io/installation — accessed 2026-11-11
10. pnpm — Blog index — https://pnpm.io/blog — accessed 2026-11-11
11. pnpm v12.0.0 release — https://github.com/pnpm/pnpm/releases/tag/v12.0.0 — accessed 2026-11-11
12. Socket — pnpm 12's Rust Rewrite Cuts Install Times by Up to 90% — https://socket.dev/blog/pnpm-12 — accessed 2026-11-11
13. Vercel — Package Managers (last_updated 2026-08-11) — https://vercel.com/docs/package-managers — accessed 2026-11-11
14. Vercel — Supported Node.js versions — https://vercel.com/docs/functions/runtimes/node-js/node-js-versions — accessed 2026-11-11
15. Render — Setting your Node.js version — https://render.com/docs/node-version — accessed 2026-11-11
16. Microsoft — Announcing TypeScript 7.0 (2026-07-08) — https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ — accessed 2026-11-11
17. Turborepo v2.11.11 release — https://api.github.com/repos/vercel/turborepo/releases/latest (https://github.com/vercel/turborepo/releases) — accessed 2026-11-11
18. actions/checkout v7.0.1 — https://api.github.com/repos/actions/checkout/releases/latest (https://github.com/actions/checkout/releases) — accessed 2026-11-11
19. actions/setup-node v7.1.0 — https://api.github.com/repos/actions/setup-node/releases/latest (https://github.com/actions/setup-node/releases) — accessed 2026-11-11
20. pnpm/action-setup v6.1.1 — https://api.github.com/repos/pnpm/action-setup/releases/latest (https://github.com/pnpm/action-setup/releases) — accessed 2026-11-11
21. rhysd/actionlint v1.7.12 — https://api.github.com/repos/rhysd/actionlint/releases/latest (https://github.com/rhysd/actionlint/releases) — accessed 2026-11-11
22. GitHub Docs — Dependabot supported ecosystems and repositories — https://docs.github.com/en/code-security/dependabot/ecosystems-supported-by-dependabot/supported-ecosystems-and-repositories — accessed 2026-11-11
23. KhronosGroup/KTX-Software v4.4.2 — https://api.github.com/repos/KhronosGroup/KTX-Software/releases/latest (https://github.com/KhronosGroup/KTX-Software/releases) — accessed 2026-11-11
24. BinomialLLC/basis_universal v2_50 — https://api.github.com/repos/BinomialLLC/basis_universal/releases/latest (https://github.com/BinomialLLC/basis_universal/releases) — accessed 2026-11-11
25. zeux/meshoptimizer v1.3 — https://api.github.com/repos/zeux/meshoptimizer/releases/latest (https://github.com/zeux/meshoptimizer/releases) — accessed 2026-11-11
26. google/draco 1.5.9 — https://api.github.com/repos/google/draco/releases/latest (https://github.com/google/draco/releases) — accessed 2026-11-11
27. FFmpeg — Download — https://ffmpeg.org/download.html — accessed 2026-11-11
28. FFmpeg — News (home page) — https://ffmpeg.org/index.html — accessed 2026-11-11
29. Opus — Downloads (fetch failed; opus-tools version unverified) — https://opus-codec.org/downloads/ — accessed 2026-11-11
30. uNetworking/uWebSockets.js v20.71.0 — https://api.github.com/repos/uNetworking/uWebSockets.js/releases/latest (https://github.com/uNetworking/uWebSockets.js/releases) — accessed 2026-11-11
31. uWebSockets.js v20.71.0 file listing (prebuilt binaries) — https://api.github.com/repos/uNetworking/uWebSockets.js/contents?ref=v20.71.0 — accessed 2026-11-11
32. colyseus/colyseus release "0.18" — https://api.github.com/repos/colyseus/colyseus/releases/latest (https://github.com/colyseus/colyseus/releases) — accessed 2026-11-11
33. Colyseus — "Colyseus 0.18 is here" — https://colyseus.io/blog/colyseus-018-is-here/ — accessed 2026-11-11
34. grafana/k6 v2.3.0 — https://api.github.com/repos/grafana/k6/releases/latest (https://github.com/grafana/k6/releases) — accessed 2026-11-11
35. Grafana k6 docs — k6/websockets — https://grafana.com/docs/k6/latest/javascript-api/k6-websockets/ — accessed 2026-11-11
36. Artillery docs — WebSocket engine — https://www.artillery.io/docs/reference/engines/websocket — accessed 2026-11-11
37. Shopify/toxiproxy v2.13.0 — https://api.github.com/repos/Shopify/toxiproxy/releases/latest (https://github.com/Shopify/toxiproxy/releases) — accessed 2026-11-11
38. dmtrKovalenko/odiff v4.5.0 — https://api.github.com/repos/dmtrKovalenko/odiff/releases/latest (https://github.com/dmtrKovalenko/odiff/releases) — accessed 2026-11-11
39. Playwright — Visual comparisons — https://playwright.dev/docs/test-snapshots — accessed 2026-11-11
40. Chrome for Developers — WebGPU: Troubleshooting tips and fixes (updated 2025-10-17) — https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips — accessed 2026-11-11
41. agent-browser — WebGPU guide (secondary; seen via search results) — https://agent-browser.dev/webgpu — accessed 2026-11-11
42. Chrome for Developers — Supercharge Web AI model testing: WebGPU, WebGL, and Headless Chrome (seen via search results) — https://developer.chrome.com/blog/supercharge-web-ai-testing — accessed 2026-11-11
43. mrdoob/three.js r187 release — https://api.github.com/repos/mrdoob/three.js/releases/latest (https://github.com/mrdoob/three.js/releases/tag/r187) — accessed 2026-11-11
44. jrouwe/JoltPhysics.js 1.1.1 release — https://api.github.com/repos/jrouwe/JoltPhysics.js/releases/latest (https://github.com/jrouwe/JoltPhysics.js/releases) — accessed 2026-11-11
45. Rapier — JavaScript user guide: Determinism — https://rapier.rs/docs/user_guides/javascript/determinism — accessed 2026-11-11
46. jolt-physics README (from the registry packument) — https://registry.npmjs.org/jolt-physics — accessed 2026-11-11
47. GSAP — Standard "No Charge" License — https://gsap.com/standard-license — accessed 2026-11-11
48. Bundlephobia size API (preact@11.2.0, solid-js@1.9.19, svelte@5.57.3, react-dom@19.3.1, lit@3.3.3, motion@14.12.0, gsap@3.15.1, @preact/signals@2.11.4) — https://bundlephobia.com/api/size?package=<name@version> — accessed 2026-11-11
49. Blender download mirror (release directories 4.5, 5.0, 5.1, 5.2, 5.3) — https://download.blender.org/release/ — accessed 2026-11-11
50. Blender 5.2 LTS release page (seen via search; direct fetch of blender.org returned HTTP 403) — https://www.blender.org/releases/5-2/ — accessed 2026-11-11
51. endoflife.date — Blender (seen via search results) — https://endoflife.date/blender — accessed 2026-11-11
52. Blender LTS page (HTTP 403 on fetch) — https://www.blender.org/download/lts/ — accessed 2026-11-11
