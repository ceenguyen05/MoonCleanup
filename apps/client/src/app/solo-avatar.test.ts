import { describe, expect, it } from "vitest";
import type { FrameInfo, RoomHost } from "@moon-cleanup/shared";
import { AnimationModule, AvatarAnimInput, TOOL_CLASS } from "../animation";
import type { GameplayModule } from "../gameplay";
import { FLAT_AVATAR_GROUND, SOLO_AVATAR_SLOT, SoloAvatarFeed, soloRestoringBinder } from "./solo-avatar";

function setup() {
  const state = {
    vx: 1,
    vy: 2,
    vz: 3,
    fx: 0,
    fy: 0,
    fz: 1,
    moveState: 0,
    heightAboveGround: 0,
    lastImpactMps: 4,
    jumped: false,
  };
  const gameplay = {
    predictor: { ready: true, state },
    rig: { feet: new Float64Array([2001, 0, 0]) },
    drive: { isActive: false },
    pump: { cmd: { seq: 10 } },
  };
  let host = { kind: "local" } as RoomHost | null;
  const feed = new SoloAvatarFeed(gameplay as unknown as GameplayModule, () => host, [
    "tool.desk_duster",
    "tool.lane_broom",
  ]);
  return {
    state,
    gameplay,
    feed,
    setHost: (h: RoomHost | null) => {
      host = h;
    },
  };
}

const frame = { dt: 1 / 60 } as FrameInfo;

describe("Solo custodian input", () => {
  it("uses the presented predicted feet and physical velocity/facing, with true airborne/landing data", () => {
    const { feed, state } = setup();
    const input = new AvatarAnimInput();
    expect(feed.provider(0, frame, input)).toBe(false);
    state.moveState = 1;
    state.heightAboveGround = 2.5;
    expect(feed.provider(SOLO_AVATAR_SLOT, frame, input)).toBe(true);
    expect([...input.pos]).toEqual([2001, 0, 0]);
    expect([...input.vel]).toEqual([1, 2, 3]);
    expect([...input.facing]).toEqual([0, 0, 1]);
    expect(input.grounded).toBe(false);
    expect(input.heightAboveGround).toBe(2.5);
    expect(input.impactMps).toBe(4);
  });

  it("consumes jump once per predicted input and waits for an actual Solo player", () => {
    const { feed, state, gameplay, setHost } = setup();
    const input = new AvatarAnimInput();
    state.jumped = true;
    feed.provider(SOLO_AVATAR_SLOT, frame, input);
    expect(input.jumped).toBe(true);
    feed.provider(SOLO_AVATAR_SLOT, frame, input);
    expect(input.jumped).toBe(false);
    gameplay.drive.isActive = true;
    expect(feed.provider(SOLO_AVATAR_SLOT, frame, input)).toBe(false);
    gameplay.drive.isActive = false;
    setHost(null);
    expect(feed.provider(SOLO_AVATAR_SLOT, frame, input)).toBe(false);
    setHost({ kind: "remote" } as RoomHost);
    expect(feed.provider(SOLO_AVATAR_SLOT, frame, input)).toBe(false);
  });

  it("holds only the equipped model and never fabricates work/contact left over from an online slot", () => {
    const { feed } = setup();
    const input = new AvatarAnimInput();
    input.toolActive = input.toolInContact = input.headValid = true;
    feed.setTool(0);
    feed.provider(SOLO_AVATAR_SLOT, frame, input);
    expect(input.toolClass).toBe(TOOL_CLASS.palm);
    expect(input.toolActive || input.toolInContact || input.headValid).toBe(false);
    feed.setTool(1);
    feed.provider(SOLO_AVATAR_SLOT, frame, input);
    expect(input.toolClass).toBe(TOOL_CLASS.bar);
    feed.reset();
    feed.provider(SOLO_AVATAR_SLOT, frame, input);
    expect(input.toolClass).toBe(TOOL_CLASS.none);
  });

  it("drives scrub/work from authoritative telemetry only, for the equipped tool", () => {
    const { feed, setHost } = setup();
    const tooled = new SoloAvatarFeed(
      (feed as unknown as { gameplay: GameplayModule }).gameplay,
      () => host,
      ["tool.desk_duster", "tool.lane_broom"],
    );
    const toolAnim = {
      valid: true,
      sweeping: true,
      detailing: false,
      inContact: true,
      headValid: true,
      toolCode: 1,
      phase01: 0.25,
      periodMs: 900,
      headX: 2010,
      headY: 1,
      headZ: 2,
      serial: 1,
    };
    const host = { kind: "local", toolAnim } as unknown as RoomHost;
    setHost(host);
    const input = new AvatarAnimInput();
    tooled.setTool(1);
    tooled.provider(SOLO_AVATAR_SLOT, frame, input);
    expect(input.toolActive && input.toolInContact && input.headValid).toBe(true);
    expect(input.toolPhase).toBeCloseTo(0.25, 6);
    expect(input.toolPeriodS).toBeCloseTo(0.9, 6);
    // Moon-centred metres, the frame of input.pos (never render space).
    expect([...input.headTarget]).toEqual([2010, 1, 2]);
    // same serial: advances by render dt; wrong equipped tool or invalid data: no work.
    tooled.provider(SOLO_AVATAR_SLOT, frame, input);
    expect(input.toolPhase).toBeCloseTo(0.25 + 1 / 60 / 0.9, 6);
    tooled.setTool(0);
    tooled.provider(SOLO_AVATAR_SLOT, frame, input);
    expect(input.toolActive || input.toolInContact || input.headValid).toBe(false);
    tooled.setTool(1);
    toolAnim.valid = false;
    tooled.provider(SOLO_AVATAR_SLOT, frame, input);
    expect(input.toolActive).toBe(false);
  });

  it("carries the sim head to render time along the sim stroke curve; centre is mid-stroke (moon-centred)", () => {
    const { state, gameplay, setHost } = setup();
    state.vx = state.vy = state.vz = 0; // scrubbing in place, facing +z
    const toolAnim = {
      valid: true,
      sweeping: true,
      detailing: false,
      inContact: true,
      headValid: true,
      toolCode: 0,
      phase01: 0,
      periodMs: 450,
      headX: 2001,
      headY: 0,
      headZ: 0.45, // aim 0.9 - L at phase 0
      serial: 1,
    };
    setHost({ kind: "local", toolAnim } as unknown as RoomHost);
    const feed = new SoloAvatarFeed(gameplay as unknown as GameplayModule, () => ({ kind: "local", toolAnim }) as never, [
      "tool.desk_duster",
    ]);
    feed.setToolStrokes([{ pushM: 0.45, contactMs: 315, periodMs: 450 }]);
    feed.setTool(0);
    const input = new AvatarAnimInput();
    feed.provider(SOLO_AVATAR_SLOT, frame, input); // new serial: tick head as is
    expect(input.headTarget[2]).toBeCloseTo(0.45, 9);
    expect(input.headCentre[2]).toBeCloseTo(0.45 + 0.225, 9);
    expect(input.toolContactFrac).toBeCloseTo(0.7, 9);
    const dt = 1 / 60;
    feed.provider(SOLO_AVATAR_SLOT, frame, input); // same serial, one frame later
    const u = dt / 0.45 / 0.7;
    expect(input.headTarget[2]).toBeCloseTo(0.45 + 0.45 * u * u * (3 - 2 * u), 9);
    expect(input.headCentre[2]).toBeCloseTo(0.675, 9);
    expect(input.headTarget[0]).toBe(2001);
  });

  it("does not drop a jump on a frame where seq did not advance, nor replay a held flag", () => {
    const { feed, state, gameplay } = setup();
    const input = new AvatarAnimInput();
    feed.provider(SOLO_AVATAR_SLOT, frame, input);
    state.jumped = true; // rising edge, same seq
    feed.provider(SOLO_AVATAR_SLOT, frame, input);
    expect(input.jumped).toBe(true);
    feed.provider(SOLO_AVATAR_SLOT, frame, input);
    expect(input.jumped).toBe(false);
    gameplay.pump.cmd.seq += 3; // several predicted ticks in one frame, flag still set
    feed.provider(SOLO_AVATAR_SLOT, frame, input);
    expect(input.jumped).toBe(true);
  });

  it("seeds the held tool from the host's last shift state on rebind", () => {
    const { feed } = setup();
    const input = new AvatarAnimInput();
    feed.resetFrom({
      kind: "local",
      shiftState: { players: [{ slot: 1, equippedTool: 0 }, { slot: 0, equippedTool: 1 }] },
    } as unknown as RoomHost);
    feed.provider(SOLO_AVATAR_SLOT, frame, input);
    expect(input.toolClass).toBe(TOOL_CLASS.bar);
    feed.resetFrom({ kind: "local", shiftState: null } as unknown as RoomHost);
    feed.provider(SOLO_AVATAR_SLOT, frame, input);
    expect(input.toolClass).toBe(TOOL_CLASS.none);
  });

  describe("work animation lifecycle", () => {
    function rig() {
      const base = setup();
      const toolAnim = {
        valid: true,
        sweeping: true,
        detailing: false,
        inContact: true,
        headValid: false,
        toolCode: 1,
        phase01: 0.5,
        periodMs: 800,
        headX: 0,
        headY: 0,
        headZ: 0,
        serial: 1,
      };
      base.setHost({ kind: "local", toolAnim } as unknown as RoomHost);
      base.feed.setTool(1);
      return { ...base, toolAnim, input: new AvatarAnimInput() };
    }
    const run = (r: ReturnType<typeof rig>) => r.feed.provider(SOLO_AVATAR_SLOT, frame, r.input);

    it("starts work from valid authoritative telemetry when shift state was never delivered", () => {
      const r = rig();
      r.feed.resetFrom({ kind: "local", shiftState: null } as unknown as RoomHost);
      run(r);
      expect(r.input.toolClass).toBe(TOOL_CLASS.bar);
      expect(r.input.toolActive).toBe(true);
      r.feed.setTool(0);
      run(r);
      expect(r.input.toolActive).toBe(false);
    });

    it("works on fresh telemetry for the current tool", () => {
      const r = rig();
      run(r);
      expect(r.input.toolActive).toBe(true);
    });

    it("stops when the serial stalls and resumes only on a new serial", () => {
      const r = rig();
      run(r);
      for (let i = 0; i < 30; i++) run(r); // 0.5 s at 60 fps with no new serial
      expect(r.input.toolActive).toBe(false);
      expect(r.input.toolPhase).toBe(0);
      run(r);
      expect(r.input.toolActive).toBe(false); // same stale serial cannot restart
      r.toolAnim.serial = 2;
      run(r);
      expect(r.input.toolActive).toBe(true);
    });

    it("stops when telemetry is absent or invalid", () => {
      const r = rig();
      run(r);
      r.setHost({ kind: "local" } as unknown as RoomHost);
      run(r);
      expect(r.input.toolActive).toBe(false);
      r.setHost({ kind: "local", toolAnim: { ...r.toolAnim, valid: false } } as unknown as RoomHost);
      run(r);
      expect(r.input.toolActive).toBe(false);
    });

    it("stops on tool switch and does not resume until telemetry matches the new tool", () => {
      const r = rig();
      run(r);
      r.feed.setTool(0);
      run(r);
      expect(r.input.toolActive).toBe(false);
      r.toolAnim.toolCode = 0;
      r.toolAnim.serial = 2;
      run(r);
      expect(r.input.toolActive).toBe(true);
    });

    it("stops on vehicle entry and restarts phase tracking after exit", () => {
      const r = rig();
      run(r);
      r.gameplay.drive.isActive = true;
      expect(run(r)).toBe(false);
      r.gameplay.drive.isActive = false;
      run(r);
      expect(r.input.toolActive).toBe(true);
      expect(r.input.toolPhase).toBeCloseTo(0.5, 6); // re-anchored to the sim phase, no accumulated advance
    });

    it("allocates nothing per frame", () => {
      const r = rig();
      run(r);
      const before = process.memoryUsage().heapUsed;
      for (let i = 0; i < 20000; i++) {
        if (i % 10 === 0) r.toolAnim.serial++;
        run(r);
      }
      expect(process.memoryUsage().heapUsed - before).toBeLessThan(2_000_000);
    });
  });

  it("restores the Solo provider and local LOD slot after online unbind", () => {
    const { feed } = setup();
    const animation = new AnimationModule();
    let local = -1;
    const binder = soloRestoringBinder(animation, feed, FLAT_AVATAR_GROUND, 2000, (slot) => {
      local = slot;
    });
    binder.bind(() => false, FLAT_AVATAR_GROUND, 2000);
    animation.update(frame);
    expect(animation.animatorFor(SOLO_AVATAR_SLOT)).toBeNull();
    binder.bind(null, null, 0);
    binder.setLocalSlot(-1);
    animation.update(frame);
    expect(local).toBe(SOLO_AVATAR_SLOT);
    expect(animation.animatorFor(SOLO_AVATAR_SLOT)).not.toBeNull();
    animation.dispose();
  });
});
