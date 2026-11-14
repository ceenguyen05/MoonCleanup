import { describe, expect, it, vi } from "vitest";
import {
  describeAdapter,
  detectBackend,
  matchBlocklist,
  readStartedBackend,
  type BackendDetectionInput,
  type GpuAdapterLike,
  type GpuLike,
  type GpuRequestAdapterOptionsLike,
} from "./backend";

const HARDWARE: GpuAdapterLike = {
  info: { vendor: "nvidia", architecture: "lovelace", device: "", description: "NVIDIA GeForce RTX 4060 Laptop GPU" },
};
const SOFTWARE: GpuAdapterLike = {
  info: { vendor: "google", architecture: "swiftshader", description: "SwiftShader", isFallbackAdapter: true },
};

/** A mocked `navigator.gpu`: `core` answers plain requests, `compat` answers `featureLevel: "compatibility"`. */
function mockGpu(core: GpuAdapterLike | null | Error, compat: GpuAdapterLike | null | Error = null) {
  const requestAdapter = vi.fn((options?: GpuRequestAdapterOptionsLike) => {
    const answer = options?.featureLevel === "compatibility" ? compat : core;
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  });
  const gpu: GpuLike = { requestAdapter };
  return { gpu, requestAdapter };
}

function input(overrides: Partial<BackendDetectionInput>): BackendDetectionInput {
  return { override: null, gpu: null, webgl2Supported: true, blocklist: [], ...overrides };
}

describe("detectBackend (rendering-pipeline 2.1)", () => {
  it("step 1: ?backend=webgl2 wins over a working WebGPU adapter and never asks for one", async () => {
    const { gpu, requestAdapter } = mockGpu(HARDWARE);
    const decision = await detectBackend(input({ override: "webgl2", gpu }));
    expect(decision).toMatchObject({ request: "webgl2", expected: "webgl2", forced: true, reason: "override" });
    expect(requestAdapter).not.toHaveBeenCalled();
  });

  it("step 1: ?backend=webgpu skips the software-adapter and blocklist checks", async () => {
    const { gpu } = mockGpu(SOFTWARE);
    const decision = await detectBackend(
      input({ override: "webgpu", gpu, blocklist: [{ pattern: "swiftshader", reason: "software" }] }),
    );
    expect(decision).toMatchObject({ request: "webgpu", expected: "webgpu", forced: true, reason: "override" });
  });

  it("step 1: ?backend=webgpu without navigator.gpu reports the WebGL2 it will really get", async () => {
    const decision = await detectBackend(input({ override: "webgpu", gpu: undefined }));
    expect(decision).toMatchObject({ request: "webgl2", expected: "webgl2", forced: true, reason: "no-webgpu" });
  });

  it("step 2: no navigator.gpu -> webgl2", async () => {
    const decision = await detectBackend(input({ gpu: null }));
    expect(decision).toMatchObject({ request: "webgl2", expected: "webgl2", forced: false, reason: "no-webgpu" });
  });

  it("step 3: a core adapter -> webgpu, requested with high-performance", async () => {
    const { gpu, requestAdapter } = mockGpu(HARDWARE);
    const decision = await detectBackend(input({ gpu }));
    expect(decision).toMatchObject({ request: "webgpu", expected: "webgpu", forced: false, reason: "core-adapter" });
    expect(decision.adapterVendor).toBe("nvidia");
    expect(decision.adapterDescription).toContain("RTX 4060 Laptop");
    expect(requestAdapter).toHaveBeenCalledTimes(1);
    expect(requestAdapter).toHaveBeenCalledWith({ powerPreference: "high-performance" });
  });

  it("step 3: no core adapter but a compatibility adapter -> webgpu-compat", async () => {
    const { gpu, requestAdapter } = mockGpu(null, { info: { vendor: "arm", description: "Mali-G78" } });
    const decision = await detectBackend(input({ gpu }));
    expect(decision).toMatchObject({ request: "webgpu", expected: "webgpu-compat", reason: "compat-adapter" });
    expect(requestAdapter).toHaveBeenLastCalledWith({
      powerPreference: "high-performance",
      featureLevel: "compatibility",
    });
  });

  it("step 3: no adapter at all -> webgl2", async () => {
    const { gpu } = mockGpu(null, null);
    expect(await detectBackend(input({ gpu }))).toMatchObject({ request: "webgl2", reason: "no-adapter" });
  });

  it("step 3: requestAdapter rejecting is treated as no adapter", async () => {
    const { gpu } = mockGpu(new Error("gpu process crashed"), new Error("gpu process crashed"));
    expect(await detectBackend(input({ gpu }))).toMatchObject({ request: "webgl2", reason: "adapter-error" });
  });

  it("step 4: a fallback (software) adapter -> webgl2", async () => {
    const { gpu } = mockGpu(SOFTWARE);
    expect(await detectBackend(input({ gpu }))).toMatchObject({ request: "webgl2", reason: "fallback-adapter" });
    const legacyFlag = mockGpu({ isFallbackAdapter: true });
    expect(await detectBackend(input({ gpu: legacyFlag.gpu }))).toMatchObject({ request: "webgl2" });
  });

  it("step 4: a software adapter is kept when there is no WebGL2 to prefer", async () => {
    const { gpu } = mockGpu(SOFTWARE);
    const decision = await detectBackend(input({ gpu, webgl2Supported: false }));
    expect(decision).toMatchObject({ request: "webgpu", reason: "fallback-adapter" });
  });

  it("step 5: a blocklisted driver -> webgl2, with the entry's reason", async () => {
    const { gpu } = mockGpu(HARDWARE);
    const decision = await detectBackend(
      input({ gpu, blocklist: [{ pattern: "rtx 4060 laptop", reason: "driver 555.x corrupts shadows" }] }),
    );
    expect(decision).toMatchObject({
      request: "webgl2",
      reason: "blocklisted",
      detail: "driver 555.x corrupts shadows",
    });
  });

  it("step 8: neither WebGPU nor WebGL2 -> unsupported", async () => {
    expect(await detectBackend(input({ gpu: null, webgl2Supported: false }))).toMatchObject({
      request: "unsupported",
      expected: null,
    });
    expect(await detectBackend(input({ override: "webgl2", webgl2Supported: false }))).toMatchObject({
      request: "unsupported",
      forced: true,
    });
    const { gpu } = mockGpu(null, null);
    expect(await detectBackend(input({ gpu, webgl2Supported: false }))).toMatchObject({ request: "unsupported" });
  });
});

describe("adapter helpers", () => {
  it("describeAdapter joins the non-empty parts", () => {
    expect(
      describeAdapter({ vendor: "intel", architecture: " gen-12lp ", device: "", description: "Intel(R) Iris(R) Xe" }),
    ).toBe("intel gen-12lp Intel(R) Iris(R) Xe");
    expect(describeAdapter(undefined)).toBe("");
  });

  it("matchBlocklist is case-insensitive and ignores invalid patterns and empty descriptions", () => {
    const list = [
      { pattern: "(", reason: "broken" },
      { pattern: "adreno.*6\\d\\d", reason: "old driver" },
    ];
    expect(matchBlocklist("Qualcomm Adreno (TM) 650", list)?.reason).toBe("old driver");
    expect(matchBlocklist("NVIDIA RTX 4060", list)).toBeNull();
    expect(matchBlocklist("", [{ pattern: ".*", reason: "all" }])).toBeNull();
  });

  it("readStartedBackend reads three's backend flags", () => {
    expect(readStartedBackend({ isWebGPUBackend: true, compatibilityMode: false })).toBe("webgpu");
    expect(readStartedBackend({ isWebGPUBackend: true, compatibilityMode: true })).toBe("webgpu-compat");
    expect(readStartedBackend({ isWebGLBackend: true })).toBe("webgl2");
    expect(readStartedBackend({})).toBe("webgl2");
  });
});
