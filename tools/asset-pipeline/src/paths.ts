// Repo-relative locations used by the asset pipeline (ADR-0013, ADR-0017).
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root (this file lives in tools/asset-pipeline/src). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Blender helper scripts (kitbash library, trim sheet, turntable). */
export const BLENDER_SCRIPT_DIR = resolve(REPO_ROOT, "tools", "asset-pipeline", "src", "blender");

/** Git-ignored intermediates: raw GLB from Blender, baked PNGs, build log (`.cache/` is in .gitignore). */
export const CACHE_DIR = resolve(REPO_ROOT, "assets", "models", ".cache");

/**
 * Where the M0-W0-T06 proof outputs land. The production target is `apps/client/public/assets/` (ADR-0013);
 * the proof task does not own that folder, so the hashed files and their manifest stay beside the sources.
 * Pass `--out` to build somewhere else.
 */
export const PROOF_OUT_DIR = resolve(REPO_ROOT, "assets", "models", "proof");

/** Default Blender location (owner input, OPEN_QUESTIONS Q23). Override with BLENDER_PATH. */
export const DEFAULT_BLENDER_PATH = "C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe";

/** Per-user, git-ignored KTX-Software v4.4.2 copy (tools/.bin/ is in .gitignore). Override with KTX_PATH. */
export const DEFAULT_KTX_PATH = resolve(
  REPO_ROOT,
  "tools",
  ".bin",
  "ktx",
  "bin",
  process.platform === "win32" ? "ktx.exe" : "ktx",
);
