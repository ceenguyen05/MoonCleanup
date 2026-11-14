import { describe, expect, expectTypeOf, it } from "vitest";
import type { EventBus } from "../events";
import type { UiStore } from "../ui";
import {
  CLIENT_MODULE_IDS,
  SERVICE_KEYS,
  type ClientModule,
  type FrameInfo,
  type InputService,
  type ModuleContext,
  type RendererService,
  type ServiceKey,
  type ServiceRegistry,
  type ServiceTypes,
  type SimService,
} from "./module";

describe("client module contract v1", () => {
  it("lists the modules in the fixed order of module-boundaries section 4", () => {
    expect(CLIENT_MODULE_IDS).toEqual([
      "render",
      "visuals",
      "terrain",
      "animation",
      "gameplay",
      "net",
      "audio",
      "ui",
      "debug",
    ]);
  });

  it("lists exactly the service keys of ServiceTypes", () => {
    expectTypeOf<(typeof SERVICE_KEYS)[number]>().toEqualTypeOf<ServiceKey>();
    expect(new Set(SERVICE_KEYS).size).toBe(10);
    expectTypeOf<ServiceTypes["eventBus"]>().toEqualTypeOf<EventBus>();
    expectTypeOf<ServiceTypes["uiStore"]>().toEqualTypeOf<UiStore>();
  });

  it("keeps opaque services distinct while accepting concrete implementations", () => {
    expectTypeOf<InputService>().not.toExtend<SimService>();
    class ConcreteInput {
      readonly pressed = new Set<string>();
    }
    const input: InputService = new ConcreteInput();
    expect(input).toBeInstanceOf(ConcreteInput);
    expectTypeOf<FrameInfo>().toHaveProperty("alpha").toEqualTypeOf<number>();
  });

  it("lets the client narrow services by extending ServiceTypes", () => {
    interface FakeRenderer extends RendererService {
      draw(): number;
    }
    interface ClientServices extends ServiceTypes {
      renderer: FakeRenderer;
    }
    const module: ClientModule<ClientServices> = {
      id: "render",
      init(ctx: ModuleContext<ClientServices>) {
        expectTypeOf(ctx.services.get("renderer").draw).toEqualTypeOf<() => number>();
        expectTypeOf(ctx.services).toEqualTypeOf<ServiceRegistry<ClientServices>>();
      },
      update() {},
      dispose() {},
    };
    expect(module.id).toBe("render");
    // @ts-expect-error -- module ids come from CLIENT_MODULE_IDS
    const bad: ClientModule = { id: "physics", init() {}, update() {}, dispose() {} };
    expect(bad).toBeDefined();
  });
});
