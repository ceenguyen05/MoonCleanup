// assets:check - budget checker CLI. Exit 0 = every asset in the manifest is inside its budget;
// exit 1 = at least one error. Usage: tsx src/check.ts [--dir <dir with manifest.json>]
import { resolve } from "node:path";

import { checkDirectory, formatResult } from "./budgets/check.js";
import { PROOF_OUT_DIR } from "./paths.js";

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  let directory = PROOF_OUT_DIR;
  for (let i = 0; i < argv.length; i += 1) {
    const next = argv[i + 1];
    if (argv[i] === "--dir" && next !== undefined) {
      directory = resolve(next);
      i += 1;
    } else {
      throw new Error(`unknown argument: ${String(argv[i])}`);
    }
  }
  const result = await checkDirectory(directory);
  console.log(formatResult(directory, result));
  return result.ok ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  },
);
