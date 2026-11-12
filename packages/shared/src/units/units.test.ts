import { describe, expect, expectTypeOf, it } from "vitest";
import type { Hertz, Kilograms, Lumens, Metres, Milliseconds, Seconds, Tick } from "./units";

describe("unit aliases (type level)", () => {
  it("are plain numbers", () => {
    expectTypeOf<Metres>().toEqualTypeOf<number>();
    expectTypeOf<Seconds>().toEqualTypeOf<number>();
    expectTypeOf<Milliseconds>().toEqualTypeOf<number>();
    expectTypeOf<Kilograms>().toEqualTypeOf<number>();
    expectTypeOf<Lumens>().toEqualTypeOf<number>();
    expectTypeOf<Hertz>().toEqualTypeOf<number>();
    expectTypeOf<Tick>().toEqualTypeOf<number>();
  });

  it("mix in arithmetic without casts", () => {
    const distance: Metres = 12;
    const duration: Seconds = 0.05;
    const speed = distance / duration;
    const wallet: Lumens = 100;
    const cargo: Kilograms = 2.5;
    expectTypeOf(speed).toEqualTypeOf<number>();
    expect(speed).toBe(240);
    expect(wallet + cargo).toBe(102.5);
  });
});
