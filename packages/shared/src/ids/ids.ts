// @contract ids/ids v1
// @consumers every package and app that names a player, Contract, plot, entity or request (apps/server/src/{api,net,
//   persistence}, apps/client/src/{net,sim-host,gameplay}, packages/{sim,protocol,db}, tools/bots)
//
// Branded identifier types: a PlotId cannot be passed where an EntityId is expected, although both are numbers at
// runtime. The brand exists only in the type system (no runtime cost, nothing on the wire).
//
// v1 (additive): zod schemas that validate and brand in one step (`PlayerIdSchema`, `ContractIdSchema`,
// `PlotIdSchema`, `EntityIdSchema`, `RequestIdSchema`). The brand-by-cast of v0 stays valid for values that were
// already validated elsewhere. `PlotIdSchema` checks only the 18-bit wire range; the grid-specific bound
// (plotCount - 1) is checked by the caller that knows the grid.

import { z } from "zod";

declare const brand: unique symbol;

/** `T` tagged with a compile-time name. Two brands with different names are not assignable to each other. */
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };

/** Account-level player identifier. A UUID string (netcode.md section 4.1 writes `playerId: uuid`; UUIDv7 in the DB). */
export type PlayerId = Brand<string, "PlayerId">;

/**
 * Identifier of a Contract (one saved moon and its shift): a UUID string, UUIDv7 (data-model.md section 3.5). A
 * Contract first created offline carries a client-generated UUIDv7 (ADR-0031).
 */
export type ContractId = Brand<string, "ContractId">;

/** Index of a hex plot, 0 .. plotCount - 1 (163,842 plots; 18 bits on the wire, netcode.md section 2). */
export type PlotId = Brand<number, "PlotId">;

/** Identifier of a simulation entity, u32 (netcode.md section 4.2, SlotChanges). */
export type EntityId = Brand<number, "EntityId">;

/** Client-generated idempotency key of a control request (`requestId: uuid`, netcode.md sections 4.1 and 11). */
export type RequestId = Brand<string, "RequestId">;

/** Bits of a PlotId on the wire. */
export const PLOT_ID_BITS = 18;
/** Largest PlotId the 18-bit wire field can carry. */
export const PLOT_ID_WIRE_MAX = (1 << PLOT_ID_BITS) - 1;
/** Largest EntityId (u32). */
export const ENTITY_ID_MAX = 0xffff_ffff;

export const PlayerIdSchema = z.uuid().transform((value) => value as PlayerId);
export const ContractIdSchema = z.uuid().transform((value) => value as ContractId);
export const RequestIdSchema = z.uuid().transform((value) => value as RequestId);
export const PlotIdSchema = z
  .int()
  .min(0)
  .max(PLOT_ID_WIRE_MAX)
  .transform((value) => value as PlotId);
export const EntityIdSchema = z
  .int()
  .min(0)
  .max(ENTITY_ID_MAX)
  .transform((value) => value as EntityId);
