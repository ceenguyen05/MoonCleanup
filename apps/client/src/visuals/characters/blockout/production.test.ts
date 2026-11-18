// M1-W4-T07 production custodian + T1-T4 tools: the built GLBs (pipeline output in public/assets/{characters,tools}),
// skinned bind-pose extraction, joints shared with the blockout, the skin budget, the glyph decal and the per-class
// held tools.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Texture, type BufferAttribute, type Object3D } from "three/webgpu";
import {
  CUSTODIAN_ASSET_ID,
  DUSTER_ASSET_ID,
  SUIT_ASSET_ID,
  TOOL_ASSET_IDS,
  extractAsset,
  type LoadedAsset,
} from "./assets";
import { BlockoutCast } from "./index";
import { ID_SCALE, SLOT } from "./palette";

const PUBLIC = fileURLToPath(new URL("../../../../public/assets/", import.meta.url));

/** GLTF parse in Node; KTX2 textures resolve to an empty Texture (no transcoder here, not a GPU proof). */
async function parse(dir: string, id: string): Promise<{ asset: LoadedAsset; scene: Object3D }> {
  const manifest = JSON.parse(readFileSync(join(PUBLIC, dir, "manifest.json"), "utf8")) as {
    assets: Record<string, { file: string; placeholder?: boolean }>;
  };
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const { MeshoptDecoder } = await import("three/addons/libs/meshopt_decoder.module.js");
  const entry = manifest.assets[id]!;
  const bytes = readFileSync(join(PUBLIC, dir, entry.file));
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.setKTX2Loader({
    load: (_url: string, onLoad: (t: Texture) => void) => onLoad(new Texture()),
    detectSupport() {
      return this;
    },
  } as never);
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  return { asset: extractAsset(id, gltf.scene, entry.file, entry.placeholder === true), scene: gltf.scene };
}

const tri = (a: LoadedAsset, lod: number): number => (a.levels[lod]!.index?.count ?? 0) / 3;

describe("production custodian (M1-W4-T07)", () => {
  beforeAll(() => vi.stubGlobal("self", globalThis)); // GLTFLoader wraps embedded images in blob URLs via self.URL
  it("skinned GLB: 4 LODs within 18k/8k/3k/600, final proportions after the bind-pose dequantise", async () => {
    const { asset: c, scene } = await parse("characters", SUIT_ASSET_ID);
    expect(c.placeholder).toBe(false);
    expect(c.levels.length).toBe(4);
    const caps = [18000, 8000, 3000, 600];
    for (let i = 0; i < 4; i++) expect(tri(c, i)).toBeLessThanOrEqual(caps[i]!);
    for (let i = 0; i < 4; i++) {
      const box = c.levels[i]!.boundingBox!;
      expect(box.max.y - box.min.y, `LOD${i} height`).toBeGreaterThan(1.83);
      expect(box.max.y - box.min.y, `LOD${i} height`).toBeLessThan(1.88);
      expect(Math.abs(box.min.y), `LOD${i} feet`).toBeLessThan(0.02); // LOD3 drops the sole
      expect(box.max.z, `LOD${i} faces +Z`).toBeLessThan(0.3);
    }
    // Skin for W5-T04: <= 64 joints (art-direction 9), the published joint names.
    let joints: string[] = [];
    scene.traverse((n) => {
      const s = (n as { skeleton?: { bones: { name: string }[] } }).skeleton;
      if (s !== undefined) joints = s.bones.map((b) => b.name);
    });
    expect(joints.length).toBe(16);
    expect(joints.length).toBeLessThanOrEqual(64);
    for (const j of [
      "root",
      "pelvis",
      "spine",
      "head",
      "thigh_L",
      "shin_R",
      "foot_L",
      "upperarm_R",
      "forearm_L",
      "hand_R",
    ])
      expect(joints).toContain(j);
    expect(c.glyphs).toBeInstanceOf(Texture);
  });

  it("shares the blockout's joints and sockets, so the rig profile and poser tuning carry over", async () => {
    const { asset: suit } = await parse("characters", SUIT_ASSET_ID);
    const { asset: block } = await parse("blockout", CUSTODIAN_ASSET_ID);
    for (const [name, s] of block.sockets) {
      const p = suit.sockets.get(name);
      expect(p, name).toBeDefined();
      expect(p!.position.distanceTo(s.position), name).toBeLessThan(1e-3);
    }
  });

  it("glyph decal faces carry the full atlas cell in TEXCOORD_0; every other face sits at the empty cell corner", async () => {
    const { asset: c } = await parse("characters", SUIT_ASSET_ID);
    const g = c.levels[0]!;
    const color = g.getAttribute("color") as BufferAttribute;
    const uv = g.getAttribute("uv") as BufferAttribute;
    let glyphVerts = 0;
    let maxU = 0;
    let otherNonZero = 0;
    for (let i = 0; i < color.count; i++) {
      const slot = Math.round(color.getX(i) * ID_SCALE);
      if (slot === SLOT["glyph"]) {
        glyphVerts++;
        maxU = Math.max(maxU, uv.getX(i));
      } else if (Math.abs(uv.getX(i)) > 1e-3 || Math.abs(uv.getY(i) - 1) > 1e-3) otherNonZero++; // Blender (0,0) = glTF (0,1)
    }
    expect(glyphVerts).toBeGreaterThan(20);
    expect(maxU).toBeGreaterThan(0.95);
    expect(otherNonZero).toBe(0);
  });

  it("T1-T4 tools: hand-tool budgets, contact sockets; Desk Duster keeps the v0 contact (scrub pose unchanged)", async () => {
    const { asset: v0 } = await parse("blockout", DUSTER_ASSET_ID);
    const widths: number[] = [];
    for (const [cls, id] of TOOL_ASSET_IDS) {
      const { asset: t } = await parse("tools", id);
      expect(t.levels.length, id).toBe(3);
      expect(tri(t, 0), id).toBeLessThanOrEqual(4000);
      expect(tri(t, 0), id).toBeGreaterThanOrEqual(1500);
      expect(tri(t, 1), id).toBeLessThanOrEqual(800);
      expect(tri(t, 2), id).toBeLessThanOrEqual(200);
      expect(t.sockets.get("socket_contact"), id).toBeDefined();
      const box = t.levels[0]!.boundingBox!;
      widths[cls] = box.max.x - box.min.x;
    }
    const { asset: duster } = await parse("tools", "desk_duster");
    expect(
      duster.sockets.get("socket_contact")!.position.distanceTo(v0.sockets.get("socket_contact")!.position),
    ).toBeLessThan(1e-3);
    // Head widths follow the sim contact widths (tools.json widthM 0.15 / 0.28 / 0.45 / 0.75).
    expect(widths[1]!).toBeLessThan(0.05);
    expect(widths[2]!).toBeGreaterThan(0.27);
    expect(widths[3]!).toBeGreaterThan(0.44);
    expect(widths[4]!).toBeGreaterThan(0.74);
  });

  it("custodian shows exactly the held tool of the animation class, with its contact socket", async () => {
    const { asset: suit } = await parse("characters", SUIT_ASSET_ID);
    const tools = new Map<number, LoadedAsset>();
    for (const [cls, id] of TOOL_ASSET_IDS) tools.set(cls, (await parse("tools", id)).asset);
    const cast = new BlockoutCast(suit, tools.get(1)!, tools);
    expect(cast.production).toBe(true);
    const c = cast.spawn(6);
    expect(c.shading.glyph).toBe(6);
    expect(c.tools.size).toBe(4);
    const visible = (): number[] => [...c.tools].filter(([, l]) => l.visible).map(([k]) => k);
    expect(visible()).toEqual([1]);
    c.setTool(3, true);
    expect(visible()).toEqual([3]);
    expect(c.toolContact.position.distanceTo(tools.get(3)!.sockets.get("socket_contact")!.position)).toBeLessThan(1e-6);
    c.setTool(3, false);
    expect(visible()).toEqual([]);
    c.setTool(7, true); // Assembly Gun: no model yet
    expect(visible()).toEqual([]);
    c.setToolVisible(true);
    expect(visible()).toEqual([1]);
    cast.dispose();
  });
});
