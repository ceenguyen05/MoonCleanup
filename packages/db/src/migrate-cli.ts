// Entry point of `pnpm --filter @moon-cleanup/db run migrate` (Render build step). Runs under Node's native type
// stripping, so it imports only sibling .ts files and uses erasable TypeScript syntax. Prints no secrets.

import { planMigrationFromEnv } from "./config.ts";
import { runMigrations } from "./migrate.ts";

const plan = planMigrationFromEnv(process.env);

if (plan.kind === "skip") {
  console.log(`[db:migrate] skipped: ${plan.reason}`);
} else if (plan.kind === "invalid") {
  console.error(`[db:migrate] invalid environment:\n - ${plan.problems.join("\n - ")}`);
  process.exitCode = 1;
} else {
  try {
    await runMigrations(plan.config, { log: (line) => console.log(`[db:migrate] ${line}`) });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "ERROR";
    console.error(`[db:migrate] failed (${code}); see the database logs. Connection details are not printed.`);
    process.exitCode = 1;
  }
}
