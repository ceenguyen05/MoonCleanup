import { describe, expect, it } from "vitest";
import { INPUT_BUTTON_MASK } from "@moon-cleanup/shared";
import { InputState, PAD_NAV_CONFIRM, PAD_NAV_DOWN, createInputCommand } from "./input-state";

describe("InputState menu suspension", () => {
  it("drops move / jump / interact / tool / slot while a menu is open; look and pad nav still work", () => {
    const s = new InputState();
    const cmd = createInputCommand();
    s.keyDown("KeyW");
    s.setSuspended(true);
    // Held before the menu opened: released at once.
    expect(s.sample(cmd).moveY).toBe(0);
    s.keyDown("Space");
    s.keyDown("KeyE");
    s.keyDown("Digit2");
    s.mouseButton(0, true);
    s.setGamepad(0, -1, 0, 0, (1 << 0) | (1 << 13)); // stick forward, A, D-pad down
    s.sample(cmd);
    expect(cmd.moveX).toBe(0);
    expect(cmd.moveY).toBe(0);
    expect(cmd.buttons).toBe(0);
    expect(s.takeSlot()).toBe(-1);
    expect(s.takeInteractPresses()).toBe(0);
    expect(s.takeNav()).toBe(PAD_NAV_CONFIRM | PAD_NAV_DOWN);
    const yaw = s.yawRad;
    s.lookBy({ movementX: 50, movementY: 0 });
    expect(s.yawRad).not.toBe(yaw);
  });

  it("closing the menu restores input with no stuck keys", () => {
    const s = new InputState();
    const cmd = createInputCommand();
    s.setSuspended(true);
    s.keyDown("KeyW"); // pressed inside the menu, still down when it closes
    s.mouseButton(0, true);
    s.setSuspended(false);
    s.setGamepad(0, 0, 0, 0, 0);
    s.sample(cmd);
    expect(cmd.moveY).toBe(0);
    expect(cmd.buttons).toBe(0);
    s.keyUp("KeyW");
    s.mouseButton(0, false);
    // Fresh presses after the close act normally.
    s.keyDown("KeyW");
    s.keyDown("KeyE");
    s.sample(cmd);
    expect(cmd.moveY).toBeGreaterThan(0);
    expect(cmd.buttons & INPUT_BUTTON_MASK.interact).not.toBe(0);
    expect(s.takeInteractPresses()).toBe(1);
    s.keyUp("KeyW");
    s.keyUp("KeyE");
    expect(s.sample(cmd).moveY).toBe(0);
    expect(cmd.buttons).toBe(0);
  });
});
