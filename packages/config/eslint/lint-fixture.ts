// Test helper: lint a code string as if it lived at `filePath`, using the REAL repo-root eslint.config.js, so the
// fixture suites prove the whole chain (root file -> @moon-cleanup/config/eslint -> rules), not just this package.
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

let instance: ESLint | undefined;

function getEslint(): ESLint {
  instance ??= new ESLint({
    cwd: repoRoot,
    overrideConfigFile: fileURLToPath(new URL("../../../eslint.config.js", import.meta.url)),
  });
  return instance;
}

export interface Finding {
  ruleId: string | null;
  message: string;
}

/** Lint `code` as the repo file `filePath` (relative to the repo root; the file does not need to exist). */
export async function lintFixture(code: string, filePath: string): Promise<Finding[]> {
  const [result] = await getEslint().lintText(code, { filePath });
  if (result === undefined) {
    throw new Error(`ESLint returned no result for ${filePath} (is the path ignored by the config?)`);
  }
  for (const m of result.messages) {
    if (m.fatal) {
      throw new Error(`Fixture for ${filePath} did not parse: ${m.message}`);
    }
  }
  if (result.messages.some((m) => m.message.startsWith("File ignored"))) {
    throw new Error(`Fixture path ${filePath} is ignored by the config`);
  }
  return result.messages.map((m) => ({ ruleId: m.ruleId, message: m.message }));
}

const RESTRICTED_RULES = new Set(["no-restricted-imports", "no-restricted-globals", "no-restricted-syntax"]);

/** Only the findings produced by the boundary / ban-list rules. */
export function restrictedFindings(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.ruleId !== null && RESTRICTED_RULES.has(f.ruleId));
}
