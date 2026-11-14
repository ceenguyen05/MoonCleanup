import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ContractIdSchema,
  EntityIdSchema,
  PLOT_ID_WIRE_MAX,
  PlayerIdSchema,
  PlotIdSchema,
  RequestIdSchema,
  type Brand,
  type ContractId,
  type EntityId,
  type PlayerId,
  type PlotId,
  type RequestId,
} from "./ids";

describe("branded ids (type level)", () => {
  it("are assignable to their base type", () => {
    expectTypeOf<PlayerId>().toExtend<string>();
    expectTypeOf<ContractId>().toExtend<string>();
    expectTypeOf<PlotId>().toExtend<number>();
    expectTypeOf<EntityId>().toExtend<number>();
  });

  it("are not assignable from their base type", () => {
    expectTypeOf<string>().not.toExtend<PlayerId>();
    expectTypeOf<string>().not.toExtend<ContractId>();
    expectTypeOf<number>().not.toExtend<PlotId>();
    expectTypeOf<number>().not.toExtend<EntityId>();
  });

  it("are not assignable to each other", () => {
    expectTypeOf<PlayerId>().not.toExtend<ContractId>();
    expectTypeOf<ContractId>().not.toExtend<PlayerId>();
    expectTypeOf<PlotId>().not.toExtend<EntityId>();
    expectTypeOf<EntityId>().not.toExtend<PlotId>();
    expectTypeOf<Brand<string, "A">>().not.toExtend<Brand<string, "B">>();
    expectTypeOf<Brand<string, "A">>().toEqualTypeOf<Brand<string, "A">>();
  });

  it("reject unbranded and wrongly branded values at compile time, and erase at runtime", () => {
    const plot = 7 as PlotId;
    const entity = 7 as EntityId;
    const player = "0190a6c4-7d3e-7b1a-9c55-2f8e4d6a1b00" as PlayerId;

    // @ts-expect-error -- a plain number is not a PlotId
    const unbranded: PlotId = 7;
    // @ts-expect-error -- an EntityId is not a PlotId
    const wrongBrand: PlotId = entity;
    // @ts-expect-error -- a PlayerId is not a ContractId
    const wrongStringBrand: ContractId = player;

    const asNumber: number = plot;
    const asString: string = player;
    expect([unbranded, wrongBrand, asNumber]).toEqual([7, 7, 7]);
    expect([wrongStringBrand, asString]).toEqual([player, player]);
  });
});

describe("id schemas (v1)", () => {
  const uuid7 = "0190a6c4-7d3e-7b1a-9c55-2f8e4d6a1b00";

  it("parse and brand uuids", () => {
    expect(PlayerIdSchema.parse(uuid7)).toBe(uuid7);
    expect(ContractIdSchema.parse(uuid7)).toBe(uuid7);
    expect(RequestIdSchema.parse(uuid7)).toBe(uuid7);
    expectTypeOf(PlayerIdSchema.parse(uuid7)).toEqualTypeOf<PlayerId>();
    expectTypeOf(ContractIdSchema.parse(uuid7)).toEqualTypeOf<ContractId>();
    expectTypeOf(RequestIdSchema.parse(uuid7)).toEqualTypeOf<RequestId>();
    expect(PlayerIdSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(ContractIdSchema.safeParse("").success).toBe(false);
  });

  it("bound plot and entity ids to their wire widths", () => {
    expect(PLOT_ID_WIRE_MAX).toBe(262_143);
    expect(PlotIdSchema.parse(163_841)).toBe(163_841);
    expect(PlotIdSchema.safeParse(PLOT_ID_WIRE_MAX + 1).success).toBe(false);
    expect(PlotIdSchema.safeParse(-1).success).toBe(false);
    expect(PlotIdSchema.safeParse(1.5).success).toBe(false);
    expectTypeOf(PlotIdSchema.parse(1)).toEqualTypeOf<PlotId>();
    expect(EntityIdSchema.parse(0xffff_ffff)).toBe(0xffff_ffff);
    expect(EntityIdSchema.safeParse(0x1_0000_0000).success).toBe(false);
    expectTypeOf(EntityIdSchema.parse(1)).toEqualTypeOf<EntityId>();
  });
});
