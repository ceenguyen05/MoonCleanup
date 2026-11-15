import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type ServeMode = "dev" | "production" | "unreachable";

export interface ServeInfo {
  /** `dev` = Vite dev server (HMR client present); `production` = static build / vite preview. */
  readonly mode: ServeMode;
  readonly url: string;
  /** How the harness got the server: started `vite preview` itself, or attached to a URL it was given. */
  readonly how: "preview-started" | "external";
}

/** The dev server serves `/@vite/client`; a production build (or vite preview) does not. */
export async function detectServeMode(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<ServeMode> {
  try {
    const res = await fetchFn(new URL("/@vite/client", baseUrl), { signal: AbortSignal.timeout(5000) });
    const type = res.headers.get("content-type") ?? "";
    if (res.ok && /javascript/.test(type)) return "dev";
    return "production";
  } catch {
    return "unreachable";
  }
}

export function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

function viteBin(): string {
  const bin = join(repoRoot(), "apps", "client", "node_modules", "vite", "bin", "vite.js");
  if (!existsSync(bin)) throw new Error(`vite not found at ${bin}; run pnpm install`);
  return bin;
}

function run(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, { cwd, stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`vite ${args[0]} exited with ${code}`))));
    p.on("error", reject);
  });
}

/** `vite build` of the client (no tsc: typecheck is a separate gate). */
export async function buildClient(outDir?: string): Promise<void> {
  await run(
    [viteBin(), "build", ...(outDir ? ["--outDir", outDir, "--emptyOutDir"] : [])],
    join(repoRoot(), "apps", "client"),
  );
}

export interface Preview {
  readonly url: string;
  stop(): Promise<void>;
}

/** Starts `vite preview` of the already-built client on `port` (strict) and resolves when it answers. */
export async function startPreview(port: number, outDir?: string): Promise<Preview> {
  const child: ChildProcess = spawn(
    process.execPath,
    [
      viteBin(),
      "preview",
      "--port",
      String(port),
      "--strictPort",
      "--host",
      "127.0.0.1",
      ...(outDir ? ["--outDir", outDir] : []),
    ],
    {
      cwd: join(repoRoot(), "apps", "client"),
      stdio: "ignore",
    },
  );
  const url = `http://127.0.0.1:${port}/`;
  let exited = false;
  child.on("exit", () => (exited = true));
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (exited) throw new Error(`vite preview exited early (port ${port} busy, or no dist: run with --build)`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error("vite preview did not start within 30 s");
    }
    await new Promise((r) => setTimeout(r, 250)); // poll interval of a readiness probe, not a fixed wait for rendering
  }
  return {
    url,
    stop: () =>
      new Promise<void>((resolve) => {
        if (exited) return resolve();
        child.once("exit", () => resolve());
        child.kill();
      }),
  };
}
