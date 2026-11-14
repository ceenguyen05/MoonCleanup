// Shared custom column types. Tables are declared WITHOUT a schema qualifier (see ops.ts): the target Postgres schema
// is selected at runtime through the connection search_path.

import { customType } from "drizzle-orm/pg-core";

/**
 * Hash stored as `bytea`, exposed to TypeScript as a lower-case hex string. The raw token or recovery code is never
 * stored: only HMAC-SHA256(secret, pepper) digests pass through here.
 */
export const hexBytea = customType<{ data: string; driverData: Uint8Array }>({
  dataType: () => "bytea",
  toDriver: (hex) => Buffer.from(hex, "hex"),
  fromDriver: (bytes) => Buffer.from(bytes).toString("hex"),
});

/** Binary blob (`bytea`) exposed as a Buffer; used by the compressed save payloads. Never selected in list queries. */
export const blobBytea = customType<{ data: Buffer; driverData: Uint8Array }>({
  dataType: () => "bytea",
  toDriver: (value) => value,
  fromDriver: (bytes) => Buffer.from(bytes),
});
