import { describe, expect, it, vi } from "vitest";
import type { ClientModule, ModuleContext } from "@moon-cleanup/shared";
import type { ClientServices } from "./services";
const mocks = vi.hoisted(() => ({ load: vi.fn(), dispose: vi.fn(), viewDispose: vi.fn(), viewUpdate: vi.fn() }));
vi.mock("../visuals/outpost", () => ({
  loadOutpostKit: mocks.load,
  disposeOutpostKit: mocks.dispose,
  OutpostView: class {
    root = {};
    dispose = mocks.viewDispose;
    update = mocks.viewUpdate;
  },
}));
import { withOutpost } from "./outpost";

describe("outpost asynchronous lifecycle", () => {
  it("disposes a kit arriving after shutdown without attaching it to the scene", async () => {
    let resolve!: (kit: object) => void;
    mocks.load.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const add = vi.fn();
    const unsubscribe = vi.fn();
    const services = {
      renderer: { renderer: {}, onRecreated: () => unsubscribe },
      sceneRoots: { world: { add }, camera: {} },
    };
    const ctx = {
      services: { get: (key: keyof typeof services) => services[key] },
    } as unknown as ModuleContext<ClientServices>;
    const visuals = {
      id: "visuals",
      init: vi.fn(),
      update: vi.fn(),
      dispose: vi.fn(),
    } as unknown as ClientModule<ClientServices>;
    const wrapper = withOutpost(visuals, { point() {}, direction() {} }, 2000, true, vi.fn());
    await wrapper.init(ctx);
    wrapper.dispose();
    const kit = {};
    resolve(kit);
    await Promise.resolve();
    expect(add).not.toHaveBeenCalled();
    expect(mocks.dispose).toHaveBeenCalledWith(kit);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(visuals.dispose).toHaveBeenCalledOnce();
  });
});
