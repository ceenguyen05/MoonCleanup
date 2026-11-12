import { describe, expect, expectTypeOf, it } from "vitest";
import type { Brand, ContractId, EntityId, PlayerId, PlotId } from "./ids";

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
