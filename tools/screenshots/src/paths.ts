import { isAbsolute, join, resolve } from "node:path";

/**
 * Output-path normalisation for the drivers (visual-qa re-run finding: `--out /c/...` from Git Bash with MSYS_NO_PATHCONV=1
 * reached Node unconverted and resolved to `C:\c\...`).
 *
 * - On Windows, `/c/Users/x`, `/mnt/c/Users/x` and `//c/Users/x` (MSYS, WSL, cygdrive) become `C:\Users\x`.
 * - Relative paths resolve against the directory the user typed the command in (`INIT_CWD`, set by pnpm, which otherwise runs
 *   the script inside `tools/screenshots`), not the package directory.
 * - On POSIX platforms the path is only resolved.
 */
export interface PathContext {
  readonly platform: string;
  readonly cwd: string;
  readonly initCwd?: string | undefined;
}

const DRIVE_PREFIX = /^(?:\/\/|\/mnt\/|\/cygdrive\/|\/)([a-zA-Z])(?:\/|$)(.*)$/;

export function normalizeOutPath(input: string, ctx: PathContext = defaultContext()): string {
  let p = input.trim();
  if (p === "") throw new Error("empty output path");
  if (ctx.platform === "win32") {
    const m = DRIVE_PREFIX.exec(p.replace(/\\/g, "/"));
    if (m !== null) p = `${m[1]!.toUpperCase()}:\\${(m[2] ?? "").replace(/\//g, "\\")}`;
  }
  if (isAbsolute(p)) return resolve(p);
  return resolve(join(ctx.initCwd ?? ctx.cwd, p));
}

export function defaultContext(): PathContext {
  return { platform: process.platform, cwd: process.cwd(), initCwd: process.env["INIT_CWD"] };
}
