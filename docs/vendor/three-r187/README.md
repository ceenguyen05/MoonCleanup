# three.js r187 offline docs snapshot

Read these files instead of guessing three.js APIs. Pinned engine: `three@0.187.0` (`docs/architecture/tech-stack.md`).
Used by the M0-W2 feature-verification matrix (`docs/architecture/rendering-pipeline.md` section 21) and by every
rendering, terrain and technical-art task.

- **Retrieved:** 2026-11-12 with `curl -fsSL` (exact bytes, nothing re-typed or model-rendered). Task M0-W0-T04.
- **Source of truth:** the `r187` git tag of https://github.com/mrdoob/three.js (never `master` or `dev`).
  Tag tree SHA `7e89746a687bb88271253698fa108b1dd59825d0`
  (`https://api.github.com/repos/mrdoob/three.js/git/trees/r187`).
  Raw base used below: `https://raw.githubusercontent.com/mrdoob/three.js/r187/` (written `<R187>/`).
- **Licence:** three.js is MIT, Copyright 2010-2026 three.js authors; the notice is in `LICENSE-three.txt` and applies to
  every file below. The wiki pages (untagged) are published by the same project.
- **Do not edit** files here. To refresh after a three upgrade, re-download from the new tag and update this index
  (one upgrade owner: rendering-engineer; `rendering-pipeline.md` section 18).
- Excluded on purpose: `manual/pages/how-to-use-post-processing.html` and the old `EffectComposer` examples (legacy WebGL
  path, banned by the lint ban-list).
- Total size: 809,170 bytes of vendored files plus this README (limit 5 MB).

## Index

`sha256` is the first 16 hex characters of the file's SHA-256, to detect accidental edits.

| File (relative to this folder) | Source URL | Bytes | sha256 |
| --- | --- | ---: | --- |
| `LICENSE-three.txt` | `<R187>/LICENSE` | 1,081 | 8b378ebe60e2fe50 |
| `llms.txt` | `<R187>/llms.txt` | 274 | 25e2af3670bf3adb |
| `docs-llms.txt` | `<R187>/docs/llms.txt` (served at https://threejs.org/docs/llms.txt) | 5,404 | 01ed2929603f3ed0 |
| `docs-llms-full.txt` | `<R187>/docs/llms-full.txt` (full variant, inline docs including TSL) | 378,970 | 7e06d23c852bc331 |
| `migration-guide-r180-r187.md` | https://raw.githubusercontent.com/wiki/mrdoob/three.js/Migration-Guide.md, lines 9-105 only (see note 1) | 14,071 | 80358d84109b9185 |
| `docs-pages/WebGPURenderer.html.md` | `<R187>/docs/pages/WebGPURenderer.html.md` | 2,602 | 1e60819981535594 |
| `docs-pages/RenderPipeline.html.md` | `<R187>/docs/pages/RenderPipeline.html.md` | 2,322 | 3ed57270e87bc109 |
| `docs-pages/CSMShadowNode.html.md` | `<R187>/docs/pages/CSMShadowNode.html.md` | 2,660 | 977e4a2833a42f5b |
| `docs-pages/BatchedMesh.html.md` | `<R187>/docs/pages/BatchedMesh.html.md` | 12,155 | 5599903bbc1a625c |
| `docs-pages/InstancedMesh.html.md` | `<R187>/docs/pages/InstancedMesh.html.md` | 5,299 | 69434b4456870d2c |
| `docs-pages/StorageTexture.html.md` | `<R187>/docs/pages/StorageTexture.html.md` | 1,427 | 69eb4e143160ecd0 |
| `docs-pages/StorageTextureNode.html.md` (extra) | `<R187>/docs/pages/StorageTextureNode.html.md` | 4,669 | c4ed48f2fd61c3da |
| `docs-pages/GTAONode.html.md` (extra) | `<R187>/docs/pages/GTAONode.html.md` | 4,417 | 4dd0090002bef482 |
| `docs-pages/BloomNode.html.md` (extra) | `<R187>/docs/pages/BloomNode.html.md` | 4,217 | 8887bd065748f44d |
| `docs-pages/TRAANode.html.md` (extra) | `<R187>/docs/pages/TRAANode.html.md` | 3,698 | 90936766cc54a9b7 |
| `docs-pages/SMAANode.html.md` (extra) | `<R187>/docs/pages/SMAANode.html.md` | 2,181 | 7a1735050ee5d175 |
| `docs-pages/ClusteredLightsNode.html.md` (extra) | `<R187>/docs/pages/ClusteredLightsNode.html.md` | 4,398 | b9191add76066d54 |
| `docs-pages/TileShadowNode.html.md` (extra) | `<R187>/docs/pages/TileShadowNode.html.md` | 3,294 | 46cfb8ab5e828c55 |
| `docs-pages/SunLight.html.md` (extra) | `<R187>/docs/pages/SunLight.html.md` | 1,835 | 7050fdea0a390ada |
| `docs-pages/PassNode.html.md` (extra) | `<R187>/docs/pages/PassNode.html.md` | 8,042 | 281ee5f8c504eb25 |
| `tsl/TSL-reference.html.md` | `<R187>/docs/pages/TSL.html.md` (the "TSL Reference" page, https://threejs.org/docs/#TSL) | 172,241 | 6a1e5a9476bcf8d7 |
| `tsl/wiki-Three.js-Shading-Language.md` | https://raw.githubusercontent.com/wiki/mrdoob/three.js/Three.js-Shading-Language.md (wiki, untagged; see note 2) | 65,643 | 6d5d9cc1da316ad3 |
| `manual/webgpurenderer.html` | `<R187>/manual/pages/webgpurenderer.html` (raw manual page source) | 9,222 | 645a23b381580baf |
| `addons/CSMShadowNode.js` (extra) | `<R187>/examples/jsm/csm/CSMShadowNode.js` (JSDoc-bearing source of the addon) | 14,168 | fe57b5b938b218a0 |
| `examples/webgpu_postprocessing_ao.html` | `<R187>/examples/webgpu_postprocessing_ao.html` | 21,328 | 83a910fc8490639f |
| `examples/webgpu_lights_clustered.html` | `<R187>/examples/webgpu_lights_clustered.html` | 8,558 | 4ce3acd35b99cdf3 |
| `examples/webgpu_shadowmap_csm.html` | `<R187>/examples/webgpu_shadowmap_csm.html` | 9,496 | bf01ee6570b1b908 |
| `examples/webgpu_postprocessing_bloom.html` | `<R187>/examples/webgpu_postprocessing_bloom.html` | 5,562 | 298e5809e048ab7b |
| `examples/webgpu_compute_texture.html` | `<R187>/examples/webgpu_compute_texture.html` | 3,972 | ad50ad1c9ae87d4f |
| `examples/webgpu_postprocessing_traa.html` | `<R187>/examples/webgpu_postprocessing_traa.html` | 4,019 | 9cbb61d209eb11a6 |
| `examples/webgpu_postprocessing_smaa.html` | `<R187>/examples/webgpu_postprocessing_smaa.html` | 3,955 | a1c8413fe392721e |
| `examples/webgpu_shadowmap.html` (extra, matrix row 3) | `<R187>/examples/webgpu_shadowmap.html` | 6,531 | e287522aa4fe4dc8 |
| `examples/webgpu_postprocessing_bloom_selective.html` (extra, matrix row 14) | `<R187>/examples/webgpu_postprocessing_bloom_selective.html` | 5,312 | 3c1b73e4658a6d3e |
| `examples/webgpu_upscaling_taau.html` (extra, matrix row 8) | `<R187>/examples/webgpu_upscaling_taau.html` | 5,814 | bab2b78ac7b6aeb2 |
| `examples/webgpu_upscaling_fsr1.html` (extra, matrix row 8) | `<R187>/examples/webgpu_upscaling_fsr1.html` | 5,019 | 75c22f60f7577f96 |
| `examples/webgpu_cubemap_dynamic.html` (extra, matrix row 5) | `<R187>/examples/webgpu_cubemap_dynamic.html` | 5,314 | 831efd57e239120f |

## Notes

1. **Migration Guide.** The wiki page is not tagged, so it was retrieved on 2026-11-12 from the live wiki. Only the
   sections that take a project to r180 through r187 are kept: `## 186 → 187` down to `## 179 → 180` (lines 9-105 of the
   page as retrieved), cut with `sed -n '9,105p'`. The page's intro banner and its `## 187 → 188` section (r188 is not our
   version) are left out. Older sections: read the wiki.
2. **TSL wiki page.** Untagged wiki page, retrieved 2026-11-12; the in-repo reference is `tsl/TSL-reference.html.md`.
   The task brief also named a TSL "manual page": the r187 tag has no TSL page under `manual/`
   (`manual/pages/` has no `tsl*.html`; the TSL guide is the external site https://threejs.org/tsl/ and the in-repo
   reference is `docs/pages/TSL.html.md`), so the substitution is the docs reference above plus
   `manual/webgpurenderer.html`. `docs-llms-full.txt` also contains inline TSL documentation.
3. **Doc pages as Markdown.** three publishes each docs page twice (`X.html` and a generated `X.html.md`); the `.md` files
   are stored. Example pages are stored as raw HTML/JS source (the source is the documentation).
4. **Verified in this snapshot** (grep, 2026-11-12): `RenderPipeline.outputColorTransform` and `renderOutput()` exist
   (`docs-pages/RenderPipeline.html.md`, `docs-llms-full.txt`), which confirms the names asked about in open issue 5 of
   `rendering-pipeline.md` section 20 (docs-keeper decides whether to close it; behaviour is still checked in M0-W2).
