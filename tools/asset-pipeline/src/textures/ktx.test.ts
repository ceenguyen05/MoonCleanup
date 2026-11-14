import { describe, expect, it } from "vitest";

import { classifyTexture, codecFor, encodeArgs, formatFor } from "./ktx.js";

function pngHeader(colourType: number, bitDepth = 8): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes[24] = bitDepth;
  bytes[25] = colourType;
  return bytes;
}

describe("KTX2 texture classes", () => {
  it("classifies by material slot, normal first", () => {
    expect(classifyTexture(["normalTexture"])).toBe("normal");
    expect(classifyTexture(["baseColorTexture"])).toBe("color");
    expect(classifyTexture(["emissiveTexture"])).toBe("emissive");
    expect(classifyTexture(["occlusionTexture", "metallicRoughnessTexture"])).toBe("data");
  });

  it("uses UASTC for normals and data, ETC1S for colour (ADR-0013)", () => {
    expect(codecFor("normal")).toBe("uastc");
    expect(codecFor("data")).toBe("uastc");
    expect(codecFor("color")).toBe("etc1s");
    expect(codecFor("emissive")).toBe("etc1s");
  });

  it("picks sRGB only for colour classes and reads channels from the PNG header", () => {
    expect(formatFor(pngHeader(6), "color")).toBe("R8G8B8A8_SRGB");
    expect(formatFor(pngHeader(2), "normal")).toBe("R8G8B8_UNORM");
    expect(() => formatFor(pngHeader(6, 16), "data")).toThrow(/8-bit/);
  });

  it("builds mipmapped ktx create arguments", () => {
    const args = encodeArgs("etc1s", "R8G8B8A8_SRGB", "in.png", "out.ktx2");
    expect(args.slice(0, 4)).toEqual(["create", "--format", "R8G8B8A8_SRGB", "--generate-mipmap"]);
    expect(args).toContain("basis-lz");
    expect(encodeArgs("uastc", "R8G8B8A8_UNORM", "a", "b")).toContain("uastc");
  });
});
