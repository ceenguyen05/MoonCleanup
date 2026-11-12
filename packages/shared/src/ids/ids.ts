// @contract ids/ids v0
// @consumers every package and app that names a player, Contract, plot or entity (M0: apps/server/src/ops,
//   apps/server/src/net, apps/client/src/net, tools/bots)
//
// Branded identifier types: a PlotId cannot be passed where an EntityId is expected, although both are numbers at
// runtime. The brand exists only in the type system (no runtime cost, nothing on the wire).
//
// v0 is types only. A consumer brands a value with a cast at its trust boundary, after validating it
// (`value as PlotId`). zod schemas that parse and brand in one step arrive with the first payload contracts that
// carry these ids (M1 contracts wave); adding them is not a breaking change.

declare const brand: unique symbol;

/** `T` tagged with a compile-time name. Two brands with different names are not assignable to each other. */
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };

/** Account-level player identifier. A UUID string (netcode.md section 4.1 writes `playerId: uuid`). */
export type PlayerId = Brand<string, "PlayerId">;

/**
 * Identifier of a Contract (one saved moon and its shift). An opaque string in v0; its exact format is pinned with
 * the REST DTOs that carry it.
 */
export type ContractId = Brand<string, "ContractId">;

/** Index of a hex plot, 0 .. plotCount - 1 (163,842 plots; 18 bits on the wire, netcode.md section 2). */
export type PlotId = Brand<number, "PlotId">;

/** Identifier of a simulation entity, u32 (netcode.md section 4.2, SlotChanges). */
export type EntityId = Brand<number, "EntityId">;
