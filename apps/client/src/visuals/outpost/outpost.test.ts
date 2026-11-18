import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Texture } from "three/webgpu";
import { borealStandInSellPoints } from "@moon-cleanup/sim";
import { disposeOutpostKit, extractOutpostKit, OUTPOST_PIECES } from "./assets";
import { OutpostView, outpostLayout } from "./view";

function kitScene(): Group {
  const scene = new Group();
  scene.position.set(2, 0, 0);
  const geometry = new BoxGeometry();
  const material = new MeshStandardMaterial({ map: new Texture() });
  for (const piece of OUTPOST_PIECES)
    for (let i = 0; i < 3; i++) {
      const mesh = new Mesh(geometry, material);
      mesh.name = `${piece}_LOD${i}`;
      mesh.scale.setScalar(0.5);
      scene.add(mesh);
    }
  return scene;
}

describe("Boreal authored hardware", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("loads the shipped meshopt kit only with KTX2 support and extracts all twelve authored LODs", async () => {
    vi.stubGlobal("self", globalThis);
    const manifest = JSON.parse(
      await readFile(new URL("../../../public/assets/outpost/manifest.json", import.meta.url), "utf8"),
    ) as { assets: { boreal_hero_kit: { file: string } } };
    const bytes = await readFile(
      new URL(`../../../public/assets/outpost/${manifest.assets.boreal_hero_kit.file}`, import.meta.url),
    );
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    await expect(loader.parseAsync(buffer, "")).rejects.toThrow("setKTX2Loader");
    // CPU integration: assert the real embedded KTX2 bytes arrive at the decoder boundary.
    // Actual GPU format transcoding belongs to the coordinated browser look-check.
    const decoded: Promise<void>[] = [];
    const textureLoader = {
      load(url: string, onLoad: (texture: Texture) => void) {
        decoded.push(
          fetch(url)
            .then((response) => response.arrayBuffer())
            .then((data) => {
              expect(Array.from(new Uint8Array(data, 0, 12))).toEqual([
                171, 75, 84, 88, 32, 50, 48, 187, 13, 10, 26, 10,
              ]);
              onLoad(new Texture());
            }),
        );
      },
    };
    const gltf = await loader.setKTX2Loader(textureLoader as unknown as KTX2Loader).parseAsync(buffer, "");
    await Promise.all(decoded);
    expect(decoded).toHaveLength(4);
    const kit = extractOutpostKit(gltf.scene);
    expect([...kit.values()].flat()).toHaveLength(12);
    disposeOutpostKit(kit);
  });
  it("places the four dump plates at the authoritative sale directions and gates 2.6m beyond them", () => {
    const points = borealStandInSellPoints(2000);
    const placements = outpostLayout(points, 2000);
    expect(placements).toHaveLength(13);
    const plates = placements.filter((p) => p.piece === "dump_plate");
    const gates = placements.filter((p) => p.piece === "receiving_gate");
    points.slice(1).forEach((point, i) => {
      expect(Array.from(plates[i]!.position)).toEqual([point.x * 2000, point.y * 2000, point.z * 2000]);
      const delta = gates[i]!.position.map((v, j) => v - plates[i]!.position[j]!);
      expect(Math.hypot(...delta)).toBeCloseTo(2.6, 4);
      expect(delta.reduce((sum, v, j) => sum + v * gates[i]!.front[j]!, 0)).toBeLessThan(-2.59);
    });
  });
  it("retains export transforms, rejects incomplete LODs, and disposes shared resources once", () => {
    const scene = kitScene();
    const kit = extractOutpostKit(scene);
    const mesh = kit.get("assay_counter")![0] as Mesh;
    expect(mesh.position.x).toBe(2);
    expect(mesh.scale.x).toBe(0.5);
    const geometry = vi.spyOn(mesh.geometry, "dispose");
    const material = mesh.material as MeshStandardMaterial;
    const materialDispose = vi.spyOn(material, "dispose");
    const texture = vi.spyOn(material.map!, "dispose");
    disposeOutpostKit(kit);
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(texture).toHaveBeenCalledTimes(1);
    scene.remove(scene.getObjectByName("dump_plate_LOD2")!);
    expect(() => extractOutpostKit(scene)).toThrow("dump_plate_LOD2");
  });
  it("follows frame recentering and selects a single distance LOD", () => {
    let offset = 0;
    const mapper = {
      point(src: Float64Array, so: number, out: Float64Array, o: number) {
        out[o] = src[so]! - offset;
        out[o + 1] = src[so + 1]! - 2000;
        out[o + 2] = src[so + 2]!;
      },
      direction(src: Float64Array, so: number, out: Float64Array, o: number) {
        for (let i = 0; i < 3; i++) out[o + i] = src[so + i]!;
      },
    };
    const view = new OutpostView(extractOutpostKit(kitScene()), borealStandInSellPoints(2000), 2000, mapper);
    const camera = new PerspectiveCamera();
    camera.position.set(0, 4, 150);
    camera.updateMatrixWorld();
    view.update(camera);
    const counter = view.root.children[0]!;
    expect(counter.children.map((child) => child.visible)).toEqual([false, false, true]);
    offset = 20;
    view.update(camera);
    expect(counter.position.x).toBe(-20);
    view.dispose();
    expect(view.root.children).toHaveLength(0);
  });
});
