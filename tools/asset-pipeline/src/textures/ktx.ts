// KTX2 step (ADR-0013: UASTC for normals/ORM/hero, ETC1S for bulk colour). It shells out to the KTX-Software
// `ktx` CLI (v4.4.2, `ktx create`). The binary is resolved from KTX_PATH, else the git-ignored per-user copy at
// tools/.bin/ktx/bin/ktx.exe, else `ktx` on PATH. Nothing here touches the user's PATH or profile.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Document, Texture } from "@gltf-transform/core";
import { KHRTextureBasisu } from "@gltf-transform/extensions";

import { DEFAULT_KTX_PATH } from "../paths.js";

export interface KtxStatus {
  readonly available: boolean;
  readonly path: string;
  readonly detail: string;
}

export type TextureClass = "color" | "emissive" | "normal" | "data";
export type KtxCodec = "etc1s" | "uastc";

export function ktxPath(): string {
  const fromEnv = process.env["KTX_PATH"];
  if (fromEnv) return fromEnv;
  return existsSync(DEFAULT_KTX_PATH) ? DEFAULT_KTX_PATH : "ktx";
}

export function detectKtx(): KtxStatus {
  const path = ktxPath();
  const result = spawnSync(path, ["--version"], { encoding: "utf8", shell: false });
  if (result.error || result.status !== 0) {
    return {
      available: false,
      path,
      detail: "ktx CLI not found (set KTX_PATH or install to tools/.bin/ktx); KTX2 encode skipped, textures stay PNG",
    };
  }
  return { available: true, path, detail: `${(result.stdout || result.stderr).trim()} (${path}); KTX2 encode enabled` };
}

/** Codec per texture class: bulk colour is ETC1S, everything where block artefacts show (normals, ORM) is UASTC. */
export function codecFor(textureClass: TextureClass): KtxCodec {
  return textureClass === "normal" || textureClass === "data" ? "uastc" : "etc1s";
}

/** Classifies a texture by the material slots that reference it (ORM shares occlusion + metallicRoughness). */
export function classifyTexture(slots: readonly string[]): TextureClass {
  if (slots.includes("normalTexture")) return "normal";
  if (slots.includes("baseColorTexture")) return "color";
  if (slots.includes("emissiveTexture")) return "emissive";
  return "data";
}

/** `ktx create` format enum from the PNG header (colour type byte 25: 0 grey, 2 RGB, 4 grey+alpha, 6 RGBA; 8-bit). */
export function formatFor(png: Uint8Array, textureClass: TextureClass): string {
  const colourType = png[25];
  const bitDepth = png[24];
  if (bitDepth !== 8) throw new Error(`only 8-bit PNG textures are supported, got ${String(bitDepth)}-bit`);
  const srgb = textureClass === "color" || textureClass === "emissive";
  const channels = colourType === 6 ? "R8G8B8A8" : colourType === 2 ? "R8G8B8" : colourType === 0 ? "R8" : null;
  if (channels === null) throw new Error(`unsupported PNG colour type ${String(colourType)}`);
  return `${channels}_${srgb ? "SRGB" : "UNORM"}`;
}

export function encodeArgs(codec: KtxCodec, format: string, input: string, output: string): string[] {
  const base = ["create", "--format", format, "--generate-mipmap"];
  const codecArgs =
    codec === "etc1s"
      ? ["--encode", "basis-lz", "--clevel", "3", "--qlevel", "160"]
      : ["--encode", "uastc", "--uastc-quality", "2", "--zstd", "18"];
  return [...base, ...codecArgs, input, output];
}

export interface EncodedTexture {
  readonly name: string;
  readonly textureClass: TextureClass;
  readonly codec: KtxCodec;
  readonly width: number;
  readonly height: number;
  readonly pngBytes: number;
  readonly ktx2Bytes: number;
}

/** Re-encodes every PNG texture in the document to KTX2 in place and registers KHR_texture_basisu. */
export async function encodeTextures(document: Document, ktx: KtxStatus): Promise<EncodedTexture[]> {
  if (!ktx.available) throw new Error(ktx.detail);
  const root = document.getRoot();
  const results: EncodedTexture[] = [];
  const workDir = await mkdtemp(join(tmpdir(), "ctm-ktx-"));
  try {
    for (const [index, texture] of root.listTextures().entries()) {
      if (texture.getMimeType() === "image/ktx2") continue;
      const image = texture.getImage();
      if (!image) continue;
      const textureClass = classifyTexture(slotNames(document, texture));
      const codec = codecFor(textureClass);
      const input = join(workDir, `${index}.png`);
      const output = join(workDir, `${index}.ktx2`);
      await writeFile(input, image);
      const run = spawnSync(ktx.path, encodeArgs(codec, formatFor(image, textureClass), input, output), {
        encoding: "utf8",
        shell: false,
      });
      if (run.error || run.status !== 0) {
        throw new Error(
          `ktx create failed for ${texture.getName()}: ${run.stderr || run.error?.message || run.status}`,
        );
      }
      const encoded = new Uint8Array(await readFile(output));
      const size = texture.getSize() ?? [0, 0];
      texture
        .setImage(encoded)
        .setMimeType("image/ktx2")
        .setURI(`${texture.getName() || `texture${index}`}.ktx2`);
      results.push({
        name: texture.getName() || `texture${index}`,
        textureClass,
        codec,
        width: size[0],
        height: size[1],
        pngBytes: image.byteLength,
        ktx2Bytes: encoded.byteLength,
      });
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
  if (results.length > 0) document.createExtension(KHRTextureBasisu).setRequired(true);
  return results;
}

const SLOT_EDGES = new Set([
  "baseColorTexture",
  "normalTexture",
  "occlusionTexture",
  "metallicRoughnessTexture",
  "emissiveTexture",
]);

function slotNames(document: Document, texture: Texture): string[] {
  const names: string[] = [];
  for (const material of document.getRoot().listMaterials()) {
    if (material.getBaseColorTexture() === texture) names.push("baseColorTexture");
    if (material.getNormalTexture() === texture) names.push("normalTexture");
    if (material.getOcclusionTexture() === texture) names.push("occlusionTexture");
    if (material.getMetallicRoughnessTexture() === texture) names.push("metallicRoughnessTexture");
    if (material.getEmissiveTexture() === texture) names.push("emissiveTexture");
  }
  return names.filter((name) => SLOT_EDGES.has(name));
}

/** GPU memory of a block-compressed texture after transcoding, bytes (mips add 1/3). BC7/ASTC 4x4 = 1 byte/texel. */
export function gpuBytesCompressed(width: number, height: number): number {
  return Math.ceil(width * height * (4 / 3));
}

/** GPU memory of an uncompressed RGBA8 texture with mips, bytes. */
export function gpuBytesRgba8(width: number, height: number): number {
  return Math.ceil(width * height * 4 * (4 / 3));
}
