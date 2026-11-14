// Composition helper: picks the repository for PERSISTENCE_DRIVER. `postgres` wraps the lazy connection (nothing connects
// until the first query; a sleeping Neon database surfaces as an unreachable error that the API maps to 503), `memory`
// is the local-development store.

import type { DbConnection } from "../connection.ts";
import { createMemoryRepository } from "./memory.ts";
import { createPostgresRepository, type PgDb } from "./postgres.ts";
import type { MoonRepository } from "./types.ts";

export type RepositorySource =
  { readonly driver: "memory" } | { readonly driver: "postgres"; readonly connection: DbConnection };

export function createMoonRepository(source: RepositorySource): MoonRepository {
  if (source.driver === "memory") return createMemoryRepository();
  return createPostgresRepository(source.connection.db() as unknown as PgDb);
}
