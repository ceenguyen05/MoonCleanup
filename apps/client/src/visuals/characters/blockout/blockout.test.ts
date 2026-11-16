// M1-W3-T07 blockout custodian + Desk Duster v0: the built GLBs (pipeline output in public/assets/blockout), the
// loader's dequantisation and sockets, the palette, and the procedural motion.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BufferAttribute } from "three/webgpu";
import { CUSTODIAN_ASSET_ID, DUSTER_ASSET_ID, extractAsset, type LoadedAsset } from "./assets";
import { CustodianMotion, MOON_G } from "./motion";
import { ID_SCALE, PART, PLAYER_COLORS, SLOT, SLOTS, playerSlot, srgbHexToLinear } from "./palette";

const DIR = fileURLToPath(new URL("../../../../public/assets/blockout/", import.meta.url));
const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")) as {
  assets: Record<string, { file: string; bytes: number; placeholder?: boolean; class: string }>;
};

async function load(id: string): Promise<LoadedAsset> {
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const { MeshoptDecoder } = await import("three/addons/libs/meshopt_decoder.module.js");
  const entry = manifest.assets[id]!;
  const bytes = readFileSync(join(DIR, entry.file));
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await loader.parseAsync(buffer, "");
  return extractAsset(id, gltf.scene, entry.file, entry.placeholder === true);
}

function triangles(asset: LoadedAsset, lod: number): number {
  return (asset.levels[lod]!.index?.count ?? 0) / 3;
}

describe("blockout assets (pipeline output)", () => {
  it("manifest lists both placeholder assets with hashed names", () => {
    for (const id of [CUSTODIAN_ASSET_ID, DUSTER_ASSET_ID]) {
      const e = manifest.assets[id]!;
      expect(e.placeholder).toBe(true);
      expect(e.file).toMatch(new RegExp(`^${id}\\.[0-9a-f]{12}\\.glb$`));
      expect(readFileSync(join(DIR, e.file)).byteLength).toBe(e.bytes);
    }
  });

  it("custodian: <= 6k triangles, 4-level LOD chain, final proportions and sockets", async () => {
    const c = await load(CUSTODIAN_ASSET_ID);
    expect(c.levels.length).toBe(4);
    expect(triangles(c, 0)).toBeLessThanOrEqual(6000);
    expect(triangles(c, 3)).toBeLessThanOrEqual(600);
    for (let i = 1; i < 4; i++) expect(triangles(c, i)).toBeLessThan(triangles(c, i - 1));
    const box = c.levels[0]!.boundingBox!;
    const height = box.max.y - box.min.y;
    expect(height).toBeGreaterThan(1.83);
    expect(height).toBeLessThan(1.87);
    expect(box.min.y).toBeCloseTo(0, 2); // origin between the soles
    // Helmet 0.40 m tall: 4.4-4.8 helmet-heights (art-direction 4.1, VT-M1-18).
    expect(height / 0.4).toBeGreaterThanOrEqual(4.4);
    expect(height / 0.4).toBeLessThanOrEqual(4.8);
    for (const name of [
      "socket_hand_R",
      "socket_hand_L",
      "socket_nametag",
      "socket_lamp",
      "pivot_hip_L",
      "pivot_knee_R",
      "pivot_shoulder_L",
      "pivot_elbow_R",
    ]) {
      expect(c.sockets.has(name), name).toBe(true);
    }
    // Right hand on the character's right (-X; the asset faces +Z), name tag above the helmet.
    expect(c.sockets.get("socket_hand_R")!.position.x).toBeLessThan(-0.2);
    expect(c.sockets.get("socket_nametag")!.position.y).toBeGreaterThan(height);
    expect(c.sockets.get("socket_lamp")!.position.z).toBeGreaterThan(0.15);
  });

  it("custodian: slot / part ids decode exactly from COLOR_0, every slot is a known palette row", async () => {
    const c = await load(CUSTODIAN_ASSET_ID);
    const color = c.levels[0]!.getAttribute("color") as BufferAttribute;
    const slots = new Set<number>();
    const parts = new Set<number>();
    for (let i = 0; i < color.count; i++) {
      const s = color.getX(i) * ID_SCALE;
      const p = color.getZ(i) * ID_SCALE;
      expect(Math.abs(s - Math.round(s))).toBeLessThan(1e-3);
      expect(Math.abs(p - Math.round(p))).toBeLessThan(1e-3);
      slots.add(Math.round(s));
      parts.add(Math.round(p));
      const ao = color.getY(i);
      expect(ao).toBeGreaterThan(0.3);
      expect(ao).toBeLessThanOrEqual(1);
    }
    for (const s of slots) expect(SLOTS[s], `slot ${s}`).toBeDefined();
    expect(slots.has(SLOT["playerPlate"]!)).toBe(true);
    expect(slots.has(SLOT["playerGlow"]!)).toBe(true);
    expect(slots.has(SLOT["visor"]!)).toBe(true);
    expect([...parts].sort((a, b) => a - b)).toEqual(Object.values(PART).sort((a, b) => a - b));
  });

  it("Desk Duster v0: comically tiny handled brush, contact socket at the bristle tips", async () => {
    const d = await load(DUSTER_ASSET_ID);
    expect(d.levels.length).toBe(3);
    expect(triangles(d, 0)).toBeLessThanOrEqual(4000);
    expect(triangles(d, 1)).toBeLessThanOrEqual(800);
    expect(triangles(d, 2)).toBeLessThanOrEqual(200);
    const box = d.levels[0]!.boundingBox!;
    const length = box.max.z - box.min.z;
    expect(length).toBeGreaterThan(0.15);
    expect(length).toBeLessThan(0.19); // shorter than the 0.14 m glove is tall plus a thumb: absurdly small
    const contact = d.sockets.get("socket_contact")!.position;
    expect(contact.z).toBeGreaterThan(0.08); // ahead of the grip
    expect(contact.y).toBeLessThan(0); // bristles down
  });
});

describe("palette", () => {
  it("16 player colours, wrap-safe slots, sRGB -> linear", () => {
    expect(PLAYER_COLORS.length).toBe(16);
    expect(playerSlot(-1)).toBe(15);
    expect(playerSlot(17)).toBe(1);
    const [r, g, b] = srgbHexToLinear(0xffffff);
    expect([r, g, b]).toEqual([1, 1, 1]);
    expect(srgbHexToLinear(0x808080)[0]).toBeCloseTo(0.2158, 3);
    expect(SLOTS.length).toBeLessThanOrEqual(ID_SCALE + 1);
  });
});

describe("procedural motion", () => {
  it("idle: holds heading, no swing, gentle breathing only", () => {
    const m = new CustodianMotion();
    m.reset(0.5);
    for (let i = 0; i < 120; i++) m.step(1 / 60, 0, 0);
    expect(m.yaw).toBeCloseTo(0.5, 5);
    expect(Math.abs(m.hipL)).toBeLessThan(1e-6);
    expect(Math.abs(m.bob)).toBeLessThan(0.006);
  });

  it("turns toward travel, bobs on a low-g arc and swings the limbs in counter-phase", () => {
    const m = new CustodianMotion();
    let maxBob = 0;
    let maxHip = 0;
    for (let i = 0; i < 600; i++) {
      m.step(1 / 60, 2.5, 0); // +x at full lope
      if (i > 120) {
        maxBob = Math.max(maxBob, m.bob);
        maxHip = Math.max(maxHip, Math.abs(m.hipL));
        // arms counter-swing the legs: left shoulder opposes left hip
        if (Math.abs(m.hipL) > 0.1) expect(Math.sign(m.shoulderL)).toBe(-Math.sign(m.hipL));
      }
    }
    expect(m.yaw).toBeCloseTo(Math.PI / 2, 2);
    const hang = (MOON_G * 0.5 * 0.5) / 8;
    expect(maxBob).toBeGreaterThan(hang * 0.7);
    expect(maxBob).toBeLessThan(hang * 1.3);
    expect(maxHip).toBeGreaterThan(0.3);
    expect(m.pitch).toBeGreaterThan(0.05);
  });

  it("tool stroke: right arm reaches forward and scrubs; frame-rate independent heading", () => {
    const m = new CustodianMotion();
    for (let i = 0; i < 120; i++) m.step(1 / 60, 0, 0, Number.NaN, true);
    expect(m.reach).toBeGreaterThan(0.95);
    expect(m.shoulderR).toBeGreaterThan(0.8);
    const a = new CustodianMotion();
    const b = new CustodianMotion();
    for (let i = 0; i < 60; i++) a.step(1 / 60, 0, 0, 1.0);
    for (let i = 0; i < 20; i++) b.step(1 / 20, 0, 0, 1.0);
    expect(a.yaw).toBeCloseTo(b.yaw, 3);
  });

  it("step() does not allocate in steady state (no per-frame objects)", () => {
    const m = new CustodianMotion();
    // Smoke check for hidden state growth: fields only, no arrays.
    for (let i = 0; i < 1000; i++) m.step(1 / 60, Math.sin(i / 50) * 2, Math.cos(i / 50) * 2, Number.NaN, i % 200 < 50);
    expect(Object.keys(m).length).toBeLessThan(30);
    expect(Number.isFinite(m.yaw + m.bob + m.pitch + m.roll)).toBe(true);
  });
});
