// drizzle-kit configuration. `generate` needs no database: it diffs src/schema against the committed migrations and
// writes a new SQL file into ./migrations (reviewed by Cee, never edited after merge). Applying migrations is NOT done
// by the drizzle-kit CLI: `pnpm --filter @moon-cleanup/db run migrate` runs src/migrate-cli.ts, which uses the
// programmatic migrator so the session limits (lock_timeout, statement_timeout) and DB_SCHEMA apply.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  // Journal rows live in the target schema (see src/migrate.ts), so the CLI never needs to read a database.
  strict: true,
  verbose: true,
});
