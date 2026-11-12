# @moon-cleanup/client

**Path:** `apps/client` - **Deploys to:** Vercel Hobby (static, `apps/client/dist`) - **Dev port:** 5173 + agent offset N

## Purpose and ownership

The Vite browser app: three.js `WebGPURenderer` + TSL (auto WebGL2 fallback), React 19 DOM HUD with Motion, Colyseus SDK
networking, Web Audio. Each `src/` folder has exactly one owner (module-boundaries section 3):

| Folder | Owner role | Content |
| --- | --- | --- |
| `src/app` | integrator | Composition root: boot, module registration, game loop, scene roots, error boundary |
| `src/render` | rendering-engineer | Renderer/backend detection, frame orchestration, culling/LOD infra, quality presets, dynamic resolution |
| `src/visuals` | technical-artist | TSL materials, lighting rig, sky, post pipeline look, VFX |
| `src/terrain` | terrain-dust-engineer | CDLOD sphere terrain, dust tile atlas, stroke replay, detail ring, orbit coverage |
| `src/animation` | animation-engineer | Skeleton/clip loading, blend trees, foot IK, vehicle suspension visuals |
| `src/ui` | ui-ux-motion-designer | React HUD/menus/shop/map, design tokens, motion, accessibility |
| `src/audio` | audio-engineer | Web Audio graph, buses, cues, music |
| `src/gameplay` | gameplay-systems-engineer | Input (KBM + gamepad), prediction glue, camera rig, tool aiming |
| `src/net` | netcode-engineer | Colyseus SDK wiring, reconnect/wake-up flow, snapshot ingestion |
| `src/debug` | performance-profiler | Perf HUD (F3), GPU timestamps, stats export |
| `public/assets` | technical-artist | Generated web assets from `tools/asset-pipeline` (see below) |
| `public/hub` | devops-engineer | Hub kit: `metadata.json` + thumbnails (see `docs/SETUP_CHECKLIST.md`) |

## What Fable will build here

Everything under `src/` (client modules implementing the `ClientModule` interface), `index.html`, `vite.config`, the Sentry
source-map plugin wiring, and the ESLint ban-list compliance. The placeholder `dev` / `build` / `lint` / `typecheck`
scripts only echo; `devops-engineer` replaces them in M0-W0-T03 (`vite --port 5173`, `tsc --noEmit && vite build`) and also adds the minimal bootstrap stub `src/app/boot.ts` (no-op `boot()`; `src/main.ts` is a one-line import of it). The integrator replaces/extends the stub in M0-W1-T06; after that `src/app/**` is integrator-only.

## Key contracts consumed

From `@moon-cleanup/shared` (via the barrel): `ClientModule` + service registry keys, event catalog, UI store shape,
audio cue IDs, render quality presets, REST DTOs, protocol catalog. From `protocol` (session, codecs), `sim` (prediction,
future offline solo) and `world` (plot grid, height sampling). Never imports `@moon-cleanup/db`, never `apps/*`.

## Environment

See `apps/client/.env.example` (`VITE_SERVER_HTTP_URL`, `VITE_SERVER_WS_URL`, `VITE_SENTRY_DSN`, `VITE_BUILD_VERSION`,
`VITE_ENV`). Everything `VITE_*` is public: never put secrets there.

## Notes and open items (verify before relying)

- Vite's own output goes to **`/_app/`** (`build.assetsDir = "_app"`, `vercel.json` rule `/_app/(.*)`, 1-year `immutable`), so it never collides with the
  pipeline's `/assets/` folder. Static assets in `public/assets/` are served at `/assets/(.*)`, also `immutable` for one year, and must therefore be
  **content-hashed file names** emitted by `tools/asset-pipeline` / `tools/terrain-bake` (only `manifest.json` is exempt and has a short TTL);
  `asset-validation.yml` enforces it.
- The build injects a **meta Content-Security-Policy** whose `connect-src` is built from `VITE_SERVER_HTTP_URL` and `VITE_SERVER_WS_URL`
  (security.md §4.4; the static CSP header in `vercel.json` covers the other directives). Both are Vite-config work for the integrator/devops task.
- WebGPU typings (for example `@webgpu/types`) are not in the dependency list: verify whether three's types suffice and add
  with a verified version if needed.
- Vitest browser mode (`@vitest/browser-playwright` 5.1.0, all `@vitest/*` on identical versions) is not yet a dependency; add
  it when the first browser-mode test lands. Rapier 0.21 (cosmetic client-only debris) is v1.0 optional.

## Commands

```
pnpm --filter @moon-cleanup/client dev        # placeholder -> vite
pnpm --filter @moon-cleanup/client build      # placeholder -> vite build (also run by Vercel via vercel.json)
pnpm --filter @moon-cleanup/client test
```
