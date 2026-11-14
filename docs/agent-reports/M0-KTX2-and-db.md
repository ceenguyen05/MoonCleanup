# M0 KTX2 encode + PGlite migration test (devops-engineer, 2026-11-12)

Status: DONE for both jobs. No git mutations, no client code touched.

## Job 1: KTX2
- Tool: KTX-Software v4.4.2 (Apache-2.0) from the official GitHub release `KTX-Software-4.4.2-Windows-x64.exe`.
  sha256 `1f323b0fec19794f5e6c0425a61d4b1da396872a10be862d105f4f4b2d2957fe` = the digest GitHub publishes for the asset;
  Authenticode signature Valid (Khronos Group Inc, DigiCert). The installer requests administrator, so it was NOT run.
  It was unpacked (NSIS) with 7-Zip 26.06 (sha256 `6dc822569e777d9a3ecd5ffcbc22b55600af87e6c5d9810a64e8566cf5a4af9f`, from the
  MSI via `msiexec /a`, no install). Result: `tools/.bin/ktx/bin/ktx.exe` (git-ignored: `tools/.bin/` added to .gitignore).
  PATH/profile untouched; the pipeline finds it via `KTX_PATH` env var, else that default path, else `ktx` on PATH.
- Code (tools/asset-pipeline/src): `textures/ktx.ts` (resolve, classify, `ktx create` args, in-document encode, KHR_texture_basisu),
  `paths.ts` (DEFAULT_KTX_PATH), `gltf/io.ts` (optimizeGlb takes the ktx status), `build.ts` (logs per texture), `textures/ktx.test.ts` (4 tests),
  `budgets/check.ts` message text only.
- Codec per class: base colour + emissive = ETC1S (`--clevel 3 --qlevel 160`, sRGB); normal + ORM = UASTC (`--uastc-quality 2 --zstd 18`, UNORM).
  All with `--generate-mipmap`. `--normal-mode` deliberately NOT used (it can leave Z unreliable; three samples all three channels).
- Rebuilt with `assets:build --skip-source` from cached raw GLBs (no Blender rerun). New files:
  `rock_boulder_a.8f9c955a76af.glb`, `boreal_hab_module.18cb4367927f.glb`; manifest updated (textureFormat ktx2). `assets:check`: PASS, 0 errors, 0 warnings.
  Tests: asset-pipeline 11/11, tsc and eslint clean, prettier clean.

| Asset | Before (bytes) | After (bytes) |
| --- | --- | --- |
| rock_boulder_a (3 tex) | 1,873,996 | 1,505,416 (-20%) |
| boreal_hab_module (4 tex) | 1,415,324 | 1,153,876 (-18%) |

Per texture (PNG -> KTX2): rock basecolor 574,708 -> 118,489 (ETC1S); rock normal 841,355 -> 812,900 and ORM 399,050 -> 514,988 (UASTC);
hab basecolor 265,495 -> 33,854; emissive 4,559 -> 1,577; normal 11,296 -> 5,364; ORM 157,478 -> 136,379.
Note: download size gain is modest because the UASTC maps are big (smooth generated data compresses well as PNG; ORM actually grew).
If download size matters more than ORM fidelity, ORM could move to ETC1S with a higher `--qlevel`; ADR-0013 says UASTC, so left as is.

GPU memory (decoded, with mips, 1024x1024 each): PNG as RGBA8 = 5.59 MB/texture, so rock 16.8 MB + hab 22.4 MB = 39.1 MB.
KTX2 transcoded to BC7/ASTC 4x4 (1 byte/texel worst case) = 1.40 MB/texture: rock 4.2 MB + hab 5.6 MB = 9.8 MB (about 4x smaller;
ETC1S colour can transcode to BC1, half again). Estimate only; verify in the client once KTX2Loader is wired.

## Job 2: PGlite
- `@electric-sql/pglite` 0.5.16 (exact), devDependency of packages/db. Apache-2.0 (Postgres licence for the engine), published
  with SLSA provenance attestation, maintainers: thruflo, icehaunter, kylemathews, sgwillis (ElectricSQL), release 2026-11-09
  (older than pnpm's default minimumReleaseAge, no exclude needed), NO runtime dependencies, NO install/postinstall/prepare
  scripts (only dev scripts), 26 MB unpacked (WASM). Install added +2/-1 lockfile entries; `allowBuilds` unchanged.
- `packages/db/src/migrate.test.ts`: new always-on suite through `drizzle-orm/pglite` migrator on the committed
  `migrations/` folder: schema create, 0000_ops_usage_daily applies, second run is a no-op (journal count 1), defaults and
  `on conflict` upsert, SQL rolled back inside a transaction (table absent afterwards), `drop schema cascade` leaves nothing.
  beforeAll timeout 60 s (WASM boot took >10 s once under CPU load; 4 s normally). The DATABASE_URL suite stays (skipped without it).
- Limits (honest): this covers the SQL and drizzle journal behaviour only; `runMigrations` itself (postgres.js, TLS, retry,
  lock/statement timeouts) still needs a real server to be exercised. No extension used by the migration needed.
- Evidence: packages/db vitest 22 passed / 2 skipped (the two real-server tests), tsc and eslint clean.
- Also recorded in docs/agent-reports/M0-W0-T02-devops-engineer.md (addendum) and the ledger row `tool-ktx-software` in docs/ASSET_LICENSES.md.

## Files
tools/asset-pipeline/src/{textures/ktx.ts,textures/ktx.test.ts,paths.ts,gltf/io.ts,build.ts,budgets/check.ts}, assets/models/proof/*,
packages/db/{package.json,src/migrate.test.ts}, pnpm-lock.yaml, .gitignore, docs/ASSET_LICENSES.md.
