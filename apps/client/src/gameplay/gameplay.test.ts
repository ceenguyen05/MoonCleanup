import { describe, expect, it } from "vitest";
import { INPUT_BUTTON_MASK, SimInputCommandSchema, type SimInputCommand } from "@moon-cleanup/shared";
import { AvatarState, headingBasis } from "@moon-cleanup/sim";
import {
  CameraRig,
  GameplayModule,
  DEFAULT_BINDINGS,
  DomInput,
  InputPump,
  InputState,
  TangentPlaneMapper,
  aimDistanceM,
  compileBindings,
  createInputCommand,
  pitchToCode,
  rebind,
  toolParamFor,
  yawToCode,
  type DomInputHost,
  type GameplayDebugHost,
  type InputSink,
  type PointerLockTarget,
} from "./index";

function recordingSink(state = "running"): InputSink & { cmds: SimInputCommand[] } {
  const cmds: SimInputCommand[] = [];
  return { state, cmds, sendInput: (c) => cmds.push({ ...c }) };
}

describe("bindings", () => {
  it("compiles the defaults and rejects unknown actions / pad buttons", () => {
    const c = compileBindings(DEFAULT_BINDINGS);
    expect(c.keys.get("Space")).toBe(0);
    expect(c.mouse[0]).toBe(3); // toolPrimary bit
    expect(c.pad[7]).toBe(3);
    expect(() => compileBindings({ KeyZ: "fly" as never })).toThrow(/unknown action/);
    expect(() => compileBindings({ Pad40: "jump" })).toThrow(/out of range/);
  });

  it("rebinds keys data-driven (old key unbound, new key live)", () => {
    const s = new InputState(rebind(rebind(DEFAULT_BINDINGS, "Space", null), "KeyJ", "jump"));
    expect(s.keyDown("Space")).toBe(false);
    expect(s.keyDown("KeyJ")).toBe(true);
    expect(s.sample(createInputCommand()).buttons & INPUT_BUTTON_MASK.jump).toBeTruthy();
  });
});

describe("InputState", () => {
  it("maps WASD to a normalised stick and yields contract-valid inputs", () => {
    const s = new InputState();
    s.keyDown("KeyW");
    s.keyDown("KeyD");
    const cmd = s.sample(createInputCommand());
    expect(cmd.moveX).toBe(90);
    expect(cmd.moveY).toBe(90);
    expect(SimInputCommandSchema.safeParse(cmd).success).toBe(true);
    s.keyUp("KeyD");
    expect(s.sample(cmd).moveX).toBe(0);
    expect(cmd.moveY).toBe(127);
  });

  it("latches a tap shorter than one tick, then drops it", () => {
    const s = new InputState();
    s.mouseButton(0, true);
    s.mouseButton(0, false);
    const cmd = createInputCommand();
    expect(s.sample(cmd).buttons).toBe(INPUT_BUTTON_MASK.toolPrimary);
    expect(s.sample(cmd).buttons).toBe(0);
  });

  it("holds levels while held and ignores auto-repeat; blur clears", () => {
    const s = new InputState();
    s.mouseButton(0, true);
    s.keyDown("ShiftLeft");
    s.keyDown("ShiftLeft");
    const cmd = createInputCommand();
    s.sample(cmd);
    expect(s.sample(cmd).buttons).toBe(INPUT_BUTTON_MASK.toolPrimary | INPUT_BUTTON_MASK.lope);
    s.keyUp("ShiftLeft");
    expect(s.sample(cmd).buttons).toBe(INPUT_BUTTON_MASK.toolPrimary);
    s.clear();
    expect(s.sample(cmd).buttons).toBe(0);
  });

  it("a jump press while airborne also asks for the Hop Pack", () => {
    const s = new InputState();
    s.airborne = true;
    s.keyDown("Space");
    expect(s.sample(createInputCommand()).buttons).toBe(INPUT_BUTTON_MASK.jump | INPUT_BUTTON_MASK.hopPack);
  });

  it("mouse look turns right on +x, looks down on +y and clamps pitch", () => {
    const s = new InputState();
    s.pitchRad = 0;
    s.lookBy({ movementX: 100, movementY: 0 });
    expect(s.yawRad).toBeCloseTo(0.22, 6);
    s.lookBy({ movementX: -1000, movementY: 0 });
    expect(s.yawRad).toBeGreaterThan(Math.PI); // wrapped into [0, 2 pi)
    s.lookBy({ movementX: 0, movementY: 10_000 });
    expect(pitchToCode(s.pitchRad)).toBe(-120); // -85 degrees
  });

  it("quantises yaw and pitch to the contract ranges", () => {
    expect(yawToCode(0)).toBe(0);
    expect(yawToCode(Math.PI)).toBe(32768);
    expect(yawToCode(-Math.PI / 2)).toBe(49152);
    expect(yawToCode(2 * Math.PI)).toBe(0);
    expect(pitchToCode(Math.PI / 2)).toBe(127);
    expect(pitchToCode(-3)).toBe(-127);
  });

  it("gamepad: dead zone, stick move, RT sweeps, button edges and slot / wheel taps", () => {
    const s = new InputState();
    s.setGamepad(0.1, -0.1, 0, 0, 0);
    const cmd = s.sample(createInputCommand());
    expect(cmd.moveX).toBe(0);
    expect(cmd.moveY).toBe(0);
    s.setGamepad(0, -1, 0, 0, 1 << 7);
    s.sample(cmd);
    expect(cmd.moveY).toBe(127);
    expect(cmd.buttons).toBe(INPUT_BUTTON_MASK.toolPrimary);
    s.setGamepad(0, 0, 1, 0, 0);
    s.advance({ dt: 0.5, nowMs: 0 });
    expect(s.yawRad).toBeCloseTo(1.3, 6);
    s.keyDown("Digit3");
    expect(s.takeSlot()).toBe(2);
    expect(s.takeSlot()).toBe(-1);
    s.wheel(120);
    expect(s.sample(cmd).buttons).toBe(INPUT_BUTTON_MASK.holsterNext);
  });
});

describe("InputPump", () => {
  it("sends one input per sim tick with wrapping seq, at once when a sink appears", () => {
    const s = new InputState();
    const pump = new InputPump(s, 20);
    const sink = recordingSink();
    pump.setSink(sink);
    const f144 = { dt: 1 / 144, nowMs: 0 };
    expect(pump.update(f144)).toBe(2); // first frame: no wait, plus the one-input prefill (INPUT_PREFILL)
    let total = 2;
    for (let f = 0; f < 144; f++) total += pump.update(f144);
    expect(total).toBeGreaterThanOrEqual(21);
    expect(total).toBeLessThanOrEqual(23);
    expect(sink.cmds.map((c) => c.seq).slice(0, 3)).toEqual([1, 2, 3]);
    pump.cmd.seq = 0xffff;
    pump.update({ dt: 0.05, nowMs: 0 });
    expect(sink.cmds.at(-1)?.seq).toBe(0);
  });

  it("caps a hitch at three inputs and sends nothing to a paused host", () => {
    const pump = new InputPump(new InputState(), 20);
    const sink = recordingSink();
    pump.setSink(sink);
    expect(pump.update({ dt: 1, nowMs: 0 })).toBe(3);
    expect(pump.update({ dt: 0.05, nowMs: 0 })).toBe(1);
    const paused = recordingSink("paused");
    pump.setSink(paused);
    expect(pump.update({ dt: 0.2, nowMs: 0 })).toBe(0);
    expect(paused.cmds.length).toBe(0);
  });
});

describe("camera rig and tool aim", () => {
  const R = 1_737_400;

  it("aims on flat ground and clamps to reach", () => {
    expect(aimDistanceM(-Math.PI / 4, 1.5, 3)).toBeCloseTo(1.5, 9);
    expect(aimDistanceM(-0.1, 1.5, 2.2)).toBe(2.2);
    expect(aimDistanceM(0.3, 1.5, 2.2)).toBe(2.2);
    expect(toolParamFor(1.1, 2.2)).toBe(128);
    expect(toolParamFor(5, 2.2)).toBe(255);
  });

  it("forward at yaw 0 / pi/2 is the sim heading frame's north / east; eye sits above the feet", () => {
    const rig = new CameraRig();
    const feet = new Float64Array([0.3 * R, 0.2 * R, Math.sqrt(1 - 0.13) * R]);
    rig.update(feet, { yawRad: 0, pitchRad: 0 }, { dt: 1 / 60 });
    const a = new AvatarState();
    a.px = feet[0]!;
    a.py = feet[1]!;
    a.pz = feet[2]!;
    const b = new Float64Array(9);
    headingBasis(a, b);
    for (let i = 0; i < 3; i++) expect(rig.forward[i]).toBeCloseTo(b[3 + i]!, 9);
    rig.update(feet, { yawRad: Math.PI / 2, pitchRad: 0 }, { dt: 1 / 60 });
    for (let i = 0; i < 3; i++) expect(rig.forward[i]).toBeCloseTo(b[6 + i]!, 9);
    const h = Math.hypot(rig.eye[0]!, rig.eye[1]!, rig.eye[2]!) - Math.hypot(feet[0]!, feet[1]!, feet[2]!);
    expect(h).toBeCloseTo(1.55, 6);
  });

  it("follows smoothly under variable frame time, snaps on a teleport", () => {
    const rig = new CameraRig();
    const p = new Float64Array([0, 0, R]);
    rig.update(p, { yawRad: 0, pitchRad: -0.5 }, { dt: 1 / 60 });
    p[0] = 1; // 1 m step of an authoritative tick
    rig.update(p, { yawRad: 0, pitchRad: -0.5 }, { dt: 1 / 60 });
    expect(rig.feet[0]).toBeGreaterThan(0.3);
    expect(rig.feet[0]).toBeLessThan(0.5);
    for (let i = 0; i < 30; i++) rig.update(p, { yawRad: 0, pitchRad: -0.5 }, { dt: 1 / 30 });
    expect(rig.feet[0]).toBeCloseTo(1, 4);
    p[0] = 100;
    rig.update(p, { yawRad: 0, pitchRad: -0.5 }, { dt: 1 / 60 });
    expect(rig.feet[0]).toBe(100);
  });

  it("tangent mapper: up is +y, north is -z, east is +x", () => {
    const m = new TangentPlaneMapper([0, 0, R]);
    const out = new Float64Array(3);
    m.point(new Float64Array([0, 0, R + 2]), 0, out, 0);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(2, 6);
    expect(out[2]).toBeCloseTo(0, 6);
    const a = m.axes;
    m.direction(a, 6, out, 0);
    expect(out[2]).toBeCloseTo(-1, 9);
    m.direction(a, 0, out, 0);
    expect(out[0]).toBeCloseTo(1, 9);
  });
});

describe("DomInput", () => {
  type L = (e: never) => void;
  function fakeHost(): { host: DomInputHost; target: PointerLockTarget; fire: (t: string, e: object) => void } {
    const ls = new Map<string, L>();
    const doc = {
      pointerLockElement: null as unknown,
      hidden: false,
      addEventListener: (t: string, l: L) => ls.set(`doc:${t}`, l),
      removeEventListener: (t: string) => ls.delete(`doc:${t}`),
    };
    const target: PointerLockTarget = {
      addEventListener: (t, l) => ls.set(`el:${t}`, l),
      removeEventListener: (t) => ls.delete(`el:${t}`),
      requestPointerLock: () => {
        doc.pointerLockElement = target;
        ls.get("doc:pointerlockchange")?.({} as never);
      },
    };
    const host: DomInputHost = {
      addEventListener: (t, l) => ls.set(`win:${t}`, l),
      removeEventListener: (t) => ls.delete(`win:${t}`),
      document: doc,
    };
    const fire = (t: string, e: object): void =>
      ls.get(t)?.({ preventDefault: () => undefined, target: null, repeat: false, ...e } as never);
    return { host, target, fire };
  }

  it("first click locks the pointer without swinging; then look and tool work; text fields keep keys", () => {
    const { host, target, fire } = fakeHost();
    const s = new InputState();
    const dom = new DomInput(host, target, s);
    dom.attach();
    fire("el:mousedown", { button: 0 });
    expect(dom.locked).toBe(true);
    expect(s.heldButtons()).toBe(0);
    fire("el:mousedown", { button: 0 });
    expect(s.heldButtons()).toBe(INPUT_BUTTON_MASK.toolPrimary);
    s.pitchRad = 0;
    fire("win:mousemove", { movementX: 10, movementY: 0 });
    expect(s.yawRad).toBeCloseTo(0.022, 9);
    fire("win:keydown", { code: "Space", target: { tagName: "INPUT" } });
    expect(s.heldButtons() & INPUT_BUTTON_MASK.jump).toBe(0);
    fire("win:blur", {});
    expect(s.heldButtons()).toBe(0);
    dom.detach();
  });
});

describe("zero allocation", () => {
  it("input sample + pump + camera rig stay flat on the heap", () => {
    const s = new InputState();
    const pump = new InputPump(s, 20);
    let sum = 0;
    pump.setSink({ state: "running", sendInput: (c) => (sum += c.seq) });
    const rig = new CameraRig();
    const feet = new Float64Array([0.3 * 1_737_400, 0.2 * 1_737_400, 0.93 * 1_737_400]);
    const m = new TangentPlaneMapper(feet);
    const out = new Float64Array(3);
    s.keyDown("KeyW");
    s.mouseButton(0, true);
    const clock = { dt: 1 / 60, nowMs: 0 };
    const mouse = { movementX: 1, movementY: 0.5 };
    const frame = (i: number): void => {
      mouse.movementY = (i & 1) - 0.5;
      s.lookBy(mouse);
      s.advance(clock);
      clock.nowMs += 16;
      feet[0] = feet[0]! + 0.02;
      rig.update(feet, s, clock);
      s.toolParam = rig.toolParam;
      pump.update(clock);
      m.point(rig.eye, 0, out, 0);
    };
    for (let i = 0; i < 20_000; i++) frame(i); // warm up (JIT)
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 200_000; i++) frame(i);
    const delta = process.memoryUsage().heapUsed - before;
    expect(sum).toBeGreaterThan(0);
    // One boxed double per frame (16 B) would be 3.2 MB over 200k frames; the bound (< 8 B/frame) leaves room for
    // heapUsed noise (0.7 MB seen once). Measured before the fix: 7.0 MB (rig.update took doubles).
    expect(delta).toBeLessThan(1.5 * 1024 * 1024);
  });
});

describe("GameplayModule dev readout (QA D2)", () => {
  function ctx(): Parameters<GameplayModule["init"]>[0] {
    const roots = { camera: null, world: { add: () => undefined } };
    const services = {
      get: (k: string) => (k === "sceneRoots" ? roots : { current: null, onChange: () => () => undefined }),
    };
    return { services, events: {} } as never;
  }

  it("installs __mcGameplay only when a debug host is given, and removes it on dispose", () => {
    const host: GameplayDebugHost = {};
    const m = new GameplayModule({
      win: null,
      cameraControl: false,
      placeholder: false,
      debugHost: host,
      prediction: false,
    });
    m.init(ctx());
    const snap = host.__mcGameplay!();
    expect(snap.input.sent).toBe(0);
    expect(snap.strokes.chainsAcked).toBe(0);
    expect(snap.pose).toBeNull();
    m.dispose();
    expect(host.__mcGameplay).toBeUndefined();

    const prod: { __mcGameplay?: () => unknown } = {};
    const p = new GameplayModule({
      win: null,
      cameraControl: false,
      placeholder: false,
      debugHost: null,
      prediction: false,
    });
    p.init(ctx());
    expect(prod.__mcGameplay).toBeUndefined();
    p.dispose();
  });

  it("counts inputs sent with a tool held", () => {
    const s = new InputState();
    const pump = new InputPump(s, 20);
    pump.setSink({ sendInput: () => undefined });
    s.mouseButton(0, true);
    pump.update({ dt: 0.05, nowMs: 0 });
    pump.update({ dt: 0.05, nowMs: 50 });
    expect(pump.toolInputs).toBe(4); // first frame: at once + prefill + this tick, then one per tick
  });
});
