// M0 look-polish round 3: range-culled local lights and the lamp shadow setup (the parts that need no GPU).
import { Group, Mesh, PointLight, SpotLight } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { capResolution } from "../lookdev/scene-base";
import { s06Off } from "../lookdev/s06-night";
import {
  LAMP_CASTER_LAYER,
  LocalPointLight,
  LocalSpotLight,
  RangeCulledPointLightNode,
  RangeCulledSpotLightNode,
  configureLampShadow,
  isRangeCulled,
  markLampCasters,
} from "./local-lights";

describe("range-culled local lights", () => {
  it("are three's lights with their own light node; three's own classes keep theirs", () => {
    const spot = new LocalSpotLight(0xffffff, 3, 24, 0.5, 0.4, 2);
    const point = new LocalPointLight(0xffffff, 2, 9, 2);
    expect(spot.isSpotLight).toBe(true);
    expect(point.isPointLight).toBe(true);
    expect([spot.distance, spot.angle, spot.penumbra, spot.decay]).toEqual([24, 0.5, 0.4, 2]);
    expect(point.distance).toBe(9);
    expect(isRangeCulled(spot)).toBe(true);
    expect(isRangeCulled(point)).toBe(true);
    expect(isRangeCulled(new SpotLight())).toBe(false);
    expect(isRangeCulled(new PointLight())).toBe(false);
    expect(RangeCulledSpotLightNode.type).toBe("RangeCulledSpotLightNode");
    expect(RangeCulledPointLightNode.type).toBe("RangeCulledPointLightNode");
  });
});

describe("lamp shadow setup", () => {
  it("puts props on the lamp-caster layer and leaves the skipped ground off it", () => {
    const root = new Group();
    const ground = new Mesh();
    ground.name = "ground";
    const prop = new Group();
    const part = new Mesh();
    prop.add(part);
    root.add(ground, prop);
    markLampCasters(root, (object) => object.name === "ground");
    expect(ground.layers.isEnabled(LAMP_CASTER_LAYER)).toBe(false);
    expect(part.layers.isEnabled(LAMP_CASTER_LAYER)).toBe(true);
    expect(prop.layers.isEnabled(LAMP_CASTER_LAYER)).toBe(true);
    // Everything stays on layer 0: the view camera and the sun cascades still see it.
    for (const object of [ground, prop, part]) expect(object.layers.isEnabled(0)).toBe(true);
  });

  it("sizes the map, restricts the lamp's shadow camera to the caster layer and attaches the kernel", () => {
    const lamp = new LocalSpotLight();
    configureLampShadow(lamp, 512, "pcf3");
    expect([lamp.shadow.mapSize.x, lamp.shadow.mapSize.y]).toEqual([512, 512]);
    // A mask with any bit above layer 0 is what makes three r187 use the shadow camera's own layers.
    expect(lamp.shadow.camera.layers.mask).toBe(1 << LAMP_CASTER_LAYER);
    expect(lamp.shadow.camera.layers.mask & 0xfffffffe).not.toBe(0);
    expect(typeof (lamp.shadow as unknown as { filterNode?: unknown }).filterNode).toBe("function");

    const temporal = new LocalSpotLight();
    configureLampShadow(temporal, 1024, "vogel5");
    expect((temporal.shadow as unknown as { filterNode?: unknown }).filterNode ?? null).toBeNull();
  });
});

describe("look-scene switches", () => {
  it("parses the S06 cost-split list", () => {
    expect([...s06Off(new URLSearchParams("off=Lamp, flood"))]).toEqual(["lamp", "flood"]);
    expect(s06Off(new URLSearchParams("scene=s06")).size).toBe(0);
  });

  it("ground cap: 160 x 256 by default, the old 200 x 320 with cap=dense", () => {
    expect(capResolution(new URLSearchParams("scene=s01"))).toEqual([160, 256]);
    expect(capResolution(new URLSearchParams("scene=s01&cap=dense"))).toEqual([200, 320]);
  });
});
