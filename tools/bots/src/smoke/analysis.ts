// Pure helpers of the post-deploy smoke (no I/O): CSP/CORS inspection and the plain-English next steps for Cee.

export type CheckStatus = "PASS" | "FAIL" | "SKIP" | "WARN";

export interface CheckResult {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
  /** Plain-English next steps; only set on FAIL/WARN. */
  readonly next?: string;
  readonly ms: number;
}

/** Does one CSP source expression allow `url` (scheme + host)? Handles `scheme:`, `scheme://host`, `scheme://*.host`. */
export function cspSourceMatches(source: string, url: URL, scheme: string): boolean {
  const s = source.toLowerCase();
  if (s === `${scheme}:`) return true;
  const m = /^(?:([a-z]+):\/\/)?(\*|\*\.[^:/]+|[^:/*]+)(?::(\d+|\*))?$/.exec(s);
  if (m === null) return false;
  const [, srcScheme, host, port] = m;
  if (srcScheme !== undefined && srcScheme !== scheme) return false;
  if (
    port !== undefined &&
    port !== "*" &&
    port !== (url.port || (scheme === "https" || scheme === "wss" ? "443" : "80"))
  )
    return false;
  const target = url.hostname.toLowerCase();
  if (host === "*") return true;
  if (host !== undefined && host.startsWith("*.")) return target.endsWith(host.slice(1));
  return host === target;
}

export interface CspVerdict {
  readonly hasCsp: boolean;
  readonly https: boolean;
  readonly wss: boolean;
  readonly connectSrc: string;
}

/** Checks that the page CSP `connect-src` (falling back to `default-src`) lets the page reach the server over https and wss. */
export function cspAllowsServer(csp: string | null, serverUrl: string, clientOrigin: string): CspVerdict {
  if (csp === null || csp.trim() === "") return { hasCsp: false, https: true, wss: true, connectSrc: "" };
  const directives = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    const name = tokens.shift()?.toLowerCase();
    if (name !== undefined && !directives.has(name)) directives.set(name, tokens);
  }
  const sources = directives.get("connect-src") ?? directives.get("default-src") ?? [];
  const server = new URL(serverUrl);
  const same = server.origin === new URL(clientOrigin).origin;
  const wsScheme = server.protocol === "https:" ? "wss" : "ws";
  const httpScheme = server.protocol === "https:" ? "https" : "http";
  const allows = (scheme: string): boolean =>
    sources.some((src) => {
      if (src === "'self'") return same;
      if (src === "'none'") return false;
      return cspSourceMatches(src, server, scheme);
    });
  return { hasCsp: true, https: allows(httpScheme), wss: allows(wsScheme), connectSrc: sources.join(" ") };
}

/** True when the preflight/response headers allow exactly this origin (or `*`). */
export function corsAllows(headers: Headers, origin: string): boolean {
  const v = headers.get("access-control-allow-origin");
  return v === origin || v === "*";
}

export function overallPass(results: readonly CheckResult[]): boolean {
  return results.every((r) => r.status !== "FAIL");
}

export function renderConsoleLine(r: CheckResult): string {
  const tag = r.status.padEnd(4);
  const lines = [`[${tag}] ${r.name} - ${r.detail}`];
  if (r.next !== undefined) lines.push(`        NEXT: ${r.next}`);
  return lines.join("\n");
}

export function renderMarkdown(
  meta: { serverUrl: string; clientOrigin: string; startedAt: string; durationS: number },
  results: readonly CheckResult[],
): string {
  const rows = results.map((r) => `| ${r.status} | ${r.name} | ${r.detail.replaceAll("|", "/")} |`);
  const next = results.filter((r) => r.next !== undefined).map((r) => `- **${r.name}**: ${r.next}`);
  return [
    `# Post-deploy smoke: ${overallPass(results) ? "PASS" : "FAIL"}`,
    "",
    `Server ${meta.serverUrl}, client origin ${meta.clientOrigin}, started ${meta.startedAt}, ${meta.durationS.toFixed(0)} s.`,
    "",
    "| Result | Check | Detail |",
    "| --- | --- | --- |",
    ...rows,
    ...(next.length > 0 ? ["", "## Next steps", "", ...next] : []),
    "",
  ].join("\n");
}
