// Argument parsing of the room-save archive admin CLI (restore-archive-cli.ts). Pure so it can be unit tested; erasable
// TypeScript only (runs under Node type stripping).

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RestoreCliCommand =
  | { readonly kind: "list"; readonly contractId: string }
  | {
      readonly kind: "restore";
      readonly contractId: string;
      readonly archiveId: string;
      readonly apply: boolean;
      readonly replaceLive: boolean;
    }
  | { readonly kind: "help" }
  | { readonly kind: "invalid"; readonly problems: readonly string[] };

export const RESTORE_CLI_USAGE = [
  "Usage (read-only unless --apply; connection from DATABASE_URL / DB_SCHEMA like the migrate CLI):",
  "  list    --contract <uuid>",
  "  restore --contract <uuid> --archive <uuid> [--replace-live] [--apply --confirm <archive uuid>]",
  "Dry run is the default. --apply also requires --confirm with the same archive id. Archives are never deleted;",
  "--replace-live first archives the current live save under reason pre_restore. Stop the room first (no active lease).",
].join("\n");

const VALUE_FLAGS = new Set(["--contract", "--archive", "--confirm"]);
const BOOL_FLAGS = new Set(["--apply", "--replace-live"]);

export function parseRestoreArgs(argv: readonly string[]): RestoreCliCommand {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") return { kind: "help" };
  if (command !== "list" && command !== "restore") {
    return { kind: "invalid", problems: [`unknown command "${command.slice(0, 32)}" (expected list or restore)`] };
  }
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const problems: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    if (BOOL_FLAGS.has(arg)) {
      flags.add(arg);
    } else if (VALUE_FLAGS.has(arg)) {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith("--")) problems.push(`${arg} needs a value`);
      else values.set(arg, value);
      i++;
    } else {
      problems.push(`unknown argument "${arg.slice(0, 32)}"`);
    }
  }
  const contractId = values.get("--contract");
  if (contractId === undefined || !UUID_RE.test(contractId)) problems.push("--contract: a contract uuid is required");
  if (command === "list") {
    if (flags.size > 0 || values.has("--archive") || values.has("--confirm")) {
      problems.push("list takes only --contract");
    }
    if (problems.length > 0 || contractId === undefined) return { kind: "invalid", problems };
    return { kind: "list", contractId: contractId.toLowerCase() };
  }
  const archiveId = values.get("--archive");
  if (archiveId === undefined || !UUID_RE.test(archiveId)) problems.push("--archive: an archive uuid is required");
  const apply = flags.has("--apply");
  const confirm = values.get("--confirm");
  if (
    apply &&
    (confirm === undefined || archiveId === undefined || confirm.toLowerCase() !== archiveId.toLowerCase())
  ) {
    problems.push("--apply requires --confirm <the same archive uuid>");
  }
  if (!apply && confirm !== undefined) problems.push("--confirm only makes sense with --apply");
  if (problems.length > 0 || contractId === undefined || archiveId === undefined) return { kind: "invalid", problems };
  return {
    kind: "restore",
    contractId: contractId.toLowerCase(),
    archiveId: archiveId.toLowerCase(),
    apply,
    replaceLive: flags.has("--replace-live"),
  };
}
