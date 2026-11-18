import { existsSync } from "node:fs";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MANIFEST_FILE, readManifest } from "../manifest.js";
import { PROOF_OUT_DIR, REPO_ROOT } from "../paths.js";
import { CLASS_BUDGETS } from "./budgets.js";
import { checkDirectory, checkStats, type FindingCode } from "./check.js";
import { OVERSIZE_ROCK, PASSING_ROCK, writeFixtures } from "./fixtures.js";

const TIMEOUT_MS = 60_000;

function errorCodes(findings: readonly { level: string; code: FindingCode }[]): FindingCode[] {
  return findings.filter((finding) => finding.level === "error").map((finding) => finding.code);
}

describe("asset budget checker", () => {
  let passDir = "";
  let failDir = "";

  beforeAll(async () => {
    passDir = await mkdtemp(join(tmpdir(), "ctm-assets-pass-"));
    failDir = await mkdtemp(join(tmpdir(), "ctm-assets-fail-"));
    await writeFixtures(passDir, [PASSING_ROCK]);
    await writeFixtures(failDir, [OVERSIZE_ROCK]);
  }, TIMEOUT_MS);

  afterAll(async () => {
    await rm(passDir, { recursive: true, force: true });
    await rm(failDir, { recursive: true, force: true });
  });

  it("passes an in-budget rock and reads its real LOD triangle counts and texture size", async () => {
    const result = await checkDirectory(passDir);
    expect(errorCodes(result.findings)).toEqual([]);
    expect(result.ok).toBe(true);
    const stats = result.assets[0]?.stats;
    expect(stats?.lodTriangles).toEqual([2000, 300, 60]);
    expect(stats?.textures.map((texture) => [texture.width, texture.height])).toEqual([[1024, 1024]]);
    expect(stats?.extensionsUsed).toContain("EXT_meshopt_compression");
    // PNG instead of KTX2 is reported, but only as a warning while the ktx CLI is unavailable.
    expect(result.findings.map((finding) => `${finding.level}:${finding.code}`)).toContain("warning:TEXTURE_NOT_KTX2");
  });

  it("fails the deliberately oversize fixture on triangles, LOD chain, texture size and materials", async () => {
    const result = await checkDirectory(failDir);
    expect(result.ok).toBe(false);
    const codes = errorCodes(result.findings);
    expect(codes).toContain("TRIANGLES_OVER_BUDGET");
    expect(codes).toContain("LOD_CHAIN_INCOMPLETE");
    expect(codes).toContain("TEXTURE_TOO_LARGE");
    expect(codes).toContain("MATERIALS_OVER_BUDGET");
  });

  it("fails on the per-file and per-asset byte limits", async () => {
    const tiny = await checkDirectory(passDir, { maxFileBytes: 1024 });
    expect(errorCodes(tiny.findings)).toEqual(["FILE_TOO_LARGE"]);
    const rock = CLASS_BUDGETS["rock"];
    if (!rock) throw new Error("rock budget missing");
    const squeezed = await checkDirectory(passDir, { budgets: { rock: { ...rock, maxAssetBytes: 1024 } } });
    expect(errorCodes(squeezed.findings)).toEqual(["ASSET_BYTES_OVER_BUDGET"]);
  });

  it(
    "enforces the content-hash naming contract and manifest integrity",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "ctm-assets-hash-"));
      try {
        const manifest = await writeFixtures(directory, [PASSING_ROCK]);
        const entry = manifest.assets[PASSING_ROCK.id];
        if (!entry) throw new Error("fixture entry missing");

        // A file the manifest does not know about (an unhashed stray) is an error.
        await writeFile(join(directory, "stray.glb"), new Uint8Array([1, 2, 3]));
        expect(errorCodes((await checkDirectory(directory)).findings)).toEqual(["UNLISTED_FILE"]);
        await rm(join(directory, "stray.glb"));

        // Content changed after hashing: the name and the manifest digest no longer match.
        const original = await readFile(join(directory, entry.file));
        await writeFile(join(directory, entry.file), new Uint8Array([...original, 0, 0, 0, 0]));
        const tampered = errorCodes((await checkDirectory(directory)).findings);
        expect(tampered).toContain("HASH_MISMATCH");
        expect(tampered).toContain("BYTES_MISMATCH");
        await writeFile(join(directory, entry.file), original);

        // An unhashed name in the manifest breaks the CI contract (name.<8+ hex>.ext).
        await rename(join(directory, entry.file), join(directory, "fixture_rock_ok.glb"));
        const text = await readFile(join(directory, MANIFEST_FILE), "utf8");
        await writeFile(join(directory, MANIFEST_FILE), text.replace(entry.file, "fixture_rock_ok.glb"));
        expect(errorCodes((await checkDirectory(directory)).findings)).toEqual(["NAME_NOT_HASHED"]);

        // A manifest entry whose file is gone.
        await rm(join(directory, "fixture_rock_ok.glb"));
        expect(errorCodes((await checkDirectory(directory)).findings)).toEqual(["FILE_MISSING"]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    TIMEOUT_MS,
  );

  it("reports a missing manifest instead of passing an empty folder", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ctm-assets-empty-"));
    try {
      const result = await checkDirectory(directory);
      expect(result.ok).toBe(false);
      expect(errorCodes(result.findings)).toEqual(["MANIFEST_UNREADABLE"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("warns, without failing, when LOD0 is far below the class range", () => {
    const rock = CLASS_BUDGETS["rock"];
    if (!rock) throw new Error("rock budget missing");
    const findings = checkStats(
      "thin_rock",
      1000,
      {
        lodTriangles: [400, 200, 40],
        pieceLodTriangles: { thin_rock: [400, 200, 40] },
        unassignedTriangles: 0,
        textures: [],
        materials: 1,
        extensionsUsed: ["EXT_meshopt_compression"],
      },
      rock,
    );
    expect(findings.map((finding) => `${finding.level}:${finding.code}`)).toEqual(["warning:TRIANGLES_BELOW_RANGE"]);
  });
});

// M1-W5-T03: the committed Outpost Boreal hero kit stays inside its kit and per-piece budgets.
const OUTPOST_DIR = join(REPO_ROOT, "apps", "client", "public", "assets", "outpost");
describe.skipIf(!existsSync(join(OUTPOST_DIR, MANIFEST_FILE)))("committed outpost hero kit (M1-W5-T03)", () => {
  it(
    "boreal_hero_kit passes assets:check with all four pieces, KTX2 textures and one material",
    async () => {
      const result = await checkDirectory(OUTPOST_DIR);
      expect(errorCodes(result.findings)).toEqual([]);
      const stats = result.assets.find((asset) => asset.id === "boreal_hero_kit")?.stats;
      expect(Object.keys(stats?.pieceLodTriangles ?? {}).sort()).toEqual([
        "assay_counter",
        "dump_plate",
        "flood_mast",
        "receiving_gate",
      ]);
      expect(stats?.materials).toBe(1);
      expect(stats?.textures.every((texture) => texture.mimeType === "image/ktx2")).toBe(true);
    },
    TIMEOUT_MS,
  );

  it("rejects a kit with a missing piece", () => {
    const kit = CLASS_BUDGETS["outpostHeroKit"];
    if (!kit) throw new Error("outpostHeroKit budget missing");
    const findings = checkStats(
      "kit",
      1000,
      {
        lodTriangles: [9000, 4000, 1000],
        pieceLodTriangles: { assay_counter: [16000, 4000, 1000] },
        unassignedTriangles: 0,
        textures: [],
        materials: 1,
        extensionsUsed: ["EXT_meshopt_compression"],
      },
      kit,
    );
    const codes = errorCodes(findings);
    expect(codes.filter((code) => code === "PIECE_MISSING")).toHaveLength(3);
    expect(codes).toContain("TRIANGLES_OVER_BUDGET");
  });
});

// The committed proof assets must stay inside their budgets (runs in CI without Blender).
describe.skipIf(!existsSync(join(PROOF_OUT_DIR, MANIFEST_FILE)))("committed proof assets (M0-W0-T06)", () => {
  it(
    "rock_boulder_a and boreal_hab_module pass assets:check",
    async () => {
      const manifest = await readManifest(PROOF_OUT_DIR);
      expect(Object.keys(manifest.assets).sort()).toEqual(["boreal_hab_module", "rock_boulder_a"]);
      const result = await checkDirectory(PROOF_OUT_DIR);
      expect(errorCodes(result.findings)).toEqual([]);
      expect(result.ok).toBe(true);
    },
    TIMEOUT_MS,
  );
});
