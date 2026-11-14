// M0 look-polish round 4: receiver-aware kernel size and the per-receiver normal offset (the parts that need no GPU).
import { describe, expect, it } from "vitest";
import { createGroundMaterial } from "../lookdev/ground-material";
import {
  createChipMaterial,
  createMaskBuffer,
  createMaskTextureFromBuffer,
  createRegolithMaterial,
} from "../materials";
import {
  KEY_NORMAL_OFFSET_PROPERTY,
  KeyCascadeShadowNode,
  SHADOW_FLAT_RECEIVER_KEY,
  isFlatShadowReceiver,
} from "./cascade-shadow-node";
import { normalBiasM } from "./shadow-bias";
import { RECEIVER_KERNEL_K, receiverKernelK, receiverKernelScale, shadowFilterFor } from "./shadow-filter";

const DEG = Math.PI / 180;

describe("receiver-aware kernel size", () => {
  it("keeps the full kernel from 19.5 degrees of light on the receiver, so the far-cascade comb fix at a high sun stays", () => {
    expect(RECEIVER_KERNEL_K).toBe(3);
    expect(receiverKernelK.value).toBe(RECEIVER_KERNEL_K);
    for (const elevation of [20, 30, 60, 90]) expect(receiverKernelScale(Math.sin(elevation * DEG))).toBe(1);
    expect(receiverKernelScale(Math.sin(19.4 * DEG))).toBeLessThan(1);
  });

  it("shrinks toward one comparison at a grazing sun and never goes negative on faces turned away", () => {
    expect(receiverKernelScale(Math.sin(15 * DEG))).toBeCloseTo(0.776, 3);
    expect(receiverKernelScale(Math.sin(4 * DEG))).toBeCloseTo(0.209, 3);
    expect(receiverKernelScale(Math.sin(1 * DEG))).toBeCloseTo(0.052, 3);
    expect(receiverKernelScale(-0.3)).toBe(0);
    // A wall that faces a grazing sun keeps the full kernel.
    expect(receiverKernelScale(Math.cos(4 * DEG))).toBe(1);
  });

  it("why: the kernel's reach along the light on flat ground, Low cascade 1 (18.4 cm texels), in metres", () => {
    const texelM = 0.184;
    const reachM = (rows: number, elevationDeg: number, scale: number): number =>
      (rows * texelM * scale + texelM) / Math.sin(elevationDeg * DEG);
    // Square 6-texel kernel at 1 degree: over 70 m of ground for a 21.8 m rock shadow.
    expect(reachM(6, 1, 1)).toBeGreaterThan(70);
    // Scaled: within about one texel row of the map (the resolution limit) at 1 and at 4 degrees.
    expect(reachM(6, 1, receiverKernelScale(Math.sin(1 * DEG)))).toBeLessThan(14);
    expect(reachM(6, 4, receiverKernelScale(Math.sin(4 * DEG)))).toBeLessThan(6.5);
  });

  it("only the exact tents have a receiver-aware variant, and it is a different graph from the lamp's", () => {
    for (const id of ["pcf3", "pcf5"] as const) {
      expect(typeof shadowFilterFor(id, true)).toBe("function");
      expect(shadowFilterFor(id, true)).not.toBe(shadowFilterFor(id));
      expect(shadowFilterFor(id, false)).toBe(shadowFilterFor(id));
    }
    expect(shadowFilterFor("hard", true)).toBe(shadowFilterFor("hard"));
    expect(shadowFilterFor("tent4", true)).toBe(shadowFilterFor("tent4"));
    expect(shadowFilterFor("vogel5", true)).toBeNull();
  });
});

describe("per-receiver normal offset", () => {
  it("why: a lifted lookup ends ground shadows early by offset / tan(elevation)", () => {
    const offsetM = normalBiasM(0.184);
    expect(offsetM).toBeCloseTo(0.202, 3);
    // The 0.38 m rock of S05 at a 1 degree sun: 21.8 m expected, 10.2 m with the offset (measured 10.3 m).
    expect(0.38 / Math.tan(1 * DEG)).toBeCloseTo(21.8, 1);
    expect((0.38 - offsetM) / Math.tan(1 * DEG)).toBeCloseTo(10.2, 1);
  });

  it("terrain materials are flagged as flat receivers, prop materials are not", () => {
    const buffer = createMaskBuffer(4, 4, { originX: -1, originZ: -1, sizeX: 2, sizeZ: 2 });
    const mask = createMaskTextureFromBuffer(buffer, { mipmaps: false });
    const regolith = createRegolithMaterial({ mask, maskRect: buffer.rect, maskSize: [4, 4] });
    expect(isFlatShadowReceiver(regolith.material)).toBe(true);
    expect(regolith.material.userData[SHADOW_FLAT_RECEIVER_KEY]).toBe(true);
    const standIn = createGroundMaterial({ allClean: true });
    expect(isFlatShadowReceiver(standIn.material)).toBe(true);
    const chip = createChipMaterial(0.33);
    expect(isFlatShadowReceiver(chip)).toBe(false);
    regolith.dispose();
    mask.dispose();
    standIn.material.dispose();
    chip.dispose();
  });

  it("the cascade node is its own node type and reads its offset from a property of the cascade's shadow", () => {
    expect(KeyCascadeShadowNode.type).toBe("KeyCascadeShadowNode");
    expect(KEY_NORMAL_OFFSET_PROPERTY).toBe("mcNormalOffsetM");
  });
});
