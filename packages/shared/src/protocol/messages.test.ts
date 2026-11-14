import { describe, expect, expectTypeOf, it } from "vitest";
import { Channel, CHANNELS, Direction, DIRECTIONS } from "./channels";
import {
  BYTES_ID_RANGES,
  MESSAGE_CATALOG,
  MessageStatus,
  PROTOCOL_VERSION,
  type BytesMessageName,
  type ControlMessageName,
  type MessageDef,
  type MessageName,
} from "./messages";
import { PAYLOAD_SCHEMAS } from "./payloads";

const MVP_ACTIVE = [
  "INPUT",
  "PING",
  "DUST_REQUEST",
  "READY",
  "VISIBILITY",
  "DUST_INTEREST",
  "PURCHASE",
  "SELECT_TOOL",
  "SET_SHIFT_TYPE",
  "KICK",
  "FRAME",
  "DUST_SNAPSHOT",
  "DUST_LEDGER",
  "DUST_LOG",
  "DUST_CHECK",
  "PONG",
  "HELLO",
  "PURCHASE_RESULT",
  "ERROR",
  "SHUTDOWN_NOTICE",
  "KICK_NOTICE",
  "SHIFT_TYPE_CHANGED",
  "CAPACITY_NOTICE",
  "SIM_EVENTS",
] as const;
const POST_MVP_RESERVED = [
  "BUILD_PLACE",
  "BUILD_SHIFT",
  "BUILD_RECLAIM",
  "RELAY_TELEPORT",
  "BEACON_SET",
  "QUICK_CHAT",
  "PING_MARKER",
  "SET_PERMISSIONS",
  "APPOINT_ROLE",
  "BAN",
  "VOTE_KICK",
  "REPORT_PLAYER",
  "STRUCTURES_CHUNK",
  "ROSTER_MARKERS",
  "BUILD_RESULT",
  "TELEPORT_RESULT",
  "VOTE_KICK_STATE",
  "ROLE_CHANGED",
  "REPORT_ACK",
] as const;

const entries = Object.entries(MESSAGE_CATALOG) as [MessageName, MessageDef][];
const bytesEntries = entries.filter(([, def]) => def.channel === Channel.Bytes);
const controlEntries = entries.filter(([, def]) => def.channel === Channel.Control);

/**
 * The netcode.md tables (sections 4.1, 4.2, 4.3) copied by hand: name -> [channel, direction, id]. HELLO and the
 * three SPIKE_* rows are the additions of M0-W0-T01; SELECT_TOOL and SIM_EVENTS those of M1-W0-T02. A change to the catalog must be made here too, on purpose.
 */
const SPEC: Record<string, readonly [channel: string, direction: string, id: number | string]> = {
  // 4.1 client -> server, bytes
  INPUT: ["bytes", "c2s", 0x01],
  PING: ["bytes", "c2s", 0x02],
  DUST_REQUEST: ["bytes", "c2s", 0x03],
  // 4.1 client -> server, control
  READY: ["control", "c2s", "ready"],
  VISIBILITY: ["control", "c2s", "visibility"],
  DUST_INTEREST: ["control", "c2s", "dust_interest"],
  PURCHASE: ["control", "c2s", "purchase"],
  SELECT_TOOL: ["control", "c2s", "select_tool"],
  BUILD_PLACE: ["control", "c2s", "build_place"],
  BUILD_SHIFT: ["control", "c2s", "build_shift"],
  BUILD_RECLAIM: ["control", "c2s", "build_reclaim"],
  RELAY_TELEPORT: ["control", "c2s", "relay_teleport"],
  BEACON_SET: ["control", "c2s", "beacon_set"],
  QUICK_CHAT: ["control", "c2s", "quick_chat"],
  PING_MARKER: ["control", "c2s", "ping_marker"],
  SET_PERMISSIONS: ["control", "c2s", "set_permissions"],
  APPOINT_ROLE: ["control", "c2s", "appoint_role"],
  SET_SHIFT_TYPE: ["control", "c2s", "set_shift_type"],
  KICK: ["control", "c2s", "kick"],
  BAN: ["control", "c2s", "ban"],
  VOTE_KICK: ["control", "c2s", "vote_kick"],
  REPORT_PLAYER: ["control", "c2s", "report_player"],
  // 4.2 server -> client, bytes
  FRAME: ["bytes", "s2c", 0x20],
  DUST_SNAPSHOT: ["bytes", "s2c", 0x21],
  DUST_LEDGER: ["bytes", "s2c", 0x22],
  DUST_LOG: ["bytes", "s2c", 0x23],
  DUST_CHECK: ["bytes", "s2c", 0x24],
  STRUCTURES_CHUNK: ["bytes", "s2c", 0x25],
  ROSTER_MARKERS: ["bytes", "s2c", 0x26],
  PONG: ["bytes", "s2c", 0x27],
  // 4.3 server -> client, control
  HELLO: ["control", "s2c", "hello"],
  PURCHASE_RESULT: ["control", "s2c", "purchase_result"],
  BUILD_RESULT: ["control", "s2c", "build_result"],
  TELEPORT_RESULT: ["control", "s2c", "teleport_result"],
  ERROR: ["control", "s2c", "error"],
  SHUTDOWN_NOTICE: ["control", "s2c", "shutdown_notice"],
  KICK_NOTICE: ["control", "s2c", "kick_notice"],
  VOTE_KICK_STATE: ["control", "s2c", "vote_kick_state"],
  ROLE_CHANGED: ["control", "s2c", "role_changed"],
  SHIFT_TYPE_CHANGED: ["control", "s2c", "shift_type_changed"],
  REPORT_ACK: ["control", "s2c", "report_ack"],
  CAPACITY_NOTICE: ["control", "s2c", "capacity_notice"],
  SIM_EVENTS: ["control", "s2c", "sim_events"],
  // M0 spike
  SPIKE_INPUT: ["bytes", "c2s", 0x70],
  SPIKE_FRAME: ["bytes", "s2c", 0x71],
  SPIKE_DUST: ["bytes", "s2c", 0x72],
};

describe("protocol version and channels", () => {
  it("PROTOCOL_VERSION is 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expectTypeOf<typeof PROTOCOL_VERSION>().toEqualTypeOf<1>();
  });

  it("has the three channels of netcode section 2 and two directions", () => {
    expect(CHANNELS).toEqual(["schema", "bytes", "control"]);
    expect(Object.values(Channel).sort()).toEqual([...CHANNELS].sort());
    expect(DIRECTIONS).toEqual(["c2s", "s2c"]);
    expect(Object.values(Direction).sort()).toEqual([...DIRECTIONS].sort());
    expectTypeOf<Channel>().toEqualTypeOf<"schema" | "bytes" | "control">();
    expectTypeOf<Direction>().toEqualTypeOf<"c2s" | "s2c">();
  });
});

describe("message catalog", () => {
  it("matches the netcode tables id for id", () => {
    const actual = Object.fromEntries(entries.map(([name, def]) => [name, [def.channel, def.direction, def.id]]));
    expect(actual).toEqual(SPEC);
    expect(entries).toHaveLength(46);
  });

  it("gives every entry a direction, a message channel and a status", () => {
    for (const [name, def] of entries) {
      expect(DIRECTIONS, name).toContain(def.direction);
      // Schema state is not a message: catalog entries are bytes or control only.
      expect([Channel.Bytes, Channel.Control], name).toContain(def.channel);
      expect(Object.values(MessageStatus), name).toContain(def.status);
    }
  });

  it("uses UPPER_SNAKE_CASE names", () => {
    for (const [name] of entries) {
      expect(name).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/);
    }
  });

  it("has unique bytes ids that are non-zero u8 values", () => {
    const ids = bytesEntries.map(([, def]) => def.id);
    for (const id of ids) {
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(0x01);
      expect(id).toBeLessThanOrEqual(0xff);
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(bytesEntries).toHaveLength(14);
  });

  it("keeps every bytes id inside the block of its direction, and spike ids inside the spike block", () => {
    for (const [name, def] of bytesEntries) {
      const id = def.id as number;
      const range =
        def.status === MessageStatus.Spike
          ? BYTES_ID_RANGES.spike
          : def.direction === Direction.ClientToServer
            ? BYTES_ID_RANGES.clientToServer
            : BYTES_ID_RANGES.serverToClient;
      expect(id, name).toBeGreaterThanOrEqual(range.min);
      expect(id, name).toBeLessThanOrEqual(range.max);
    }
  });

  it("has non-overlapping bytes id blocks", () => {
    const blocks = Object.values(BYTES_ID_RANGES).sort((a, b) => a.min - b.min);
    let previousMax = 0x00;
    for (const block of blocks) {
      expect(block.min).toBeGreaterThan(previousMax);
      expect(block.max).toBeGreaterThanOrEqual(block.min);
      expect(block.max).toBeLessThanOrEqual(0xff);
      previousMax = block.max;
    }
  });

  it("has unique control ids equal to the lower-case catalog name", () => {
    const ids = controlEntries.map(([, def]) => def.id);
    for (const [name, def] of controlEntries) {
      expect(def.id).toBe(name.toLowerCase());
      expect(def.id).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(controlEntries).toHaveLength(32);
  });

  it("marks exactly the MVP entries as active, and each has a payload schema", () => {
    const active = entries.filter(([, def]) => def.status === MessageStatus.Active).map(([name]) => name);
    expect(active.sort()).toEqual([...MVP_ACTIVE].sort());
    expect(Object.keys(PAYLOAD_SCHEMAS).sort()).toEqual(active);
  });

  it("keeps post-MVP entries reserved", () => {
    const reserved = entries.filter(([, def]) => def.status === MessageStatus.Reserved).map(([name]) => name);
    expect(reserved.sort()).toEqual([...POST_MVP_RESERVED].sort());
  });

  it("gives every entry a rate, and limited rates are positive", () => {
    for (const [name, def] of entries) {
      expect(["tick", "snapshot", "interval", "limited", "reply", "event", "once"], name).toContain(def.rate.kind);
      if (def.rate.kind === "limited") {
        expect(def.rate.perSecond, name).toBeGreaterThan(0);
        expect(def.rate.burst, name).toBeGreaterThanOrEqual(1);
      }
    }
    expect(MESSAGE_CATALOG.INPUT.rate).toEqual({ kind: "tick" });
    expect(MESSAGE_CATALOG.FRAME.rate).toEqual({ kind: "snapshot" });
  });

  it("reserves exactly three spike ids", () => {
    const spike = entries.filter(([, def]) => def.status === MessageStatus.Spike).map(([name]) => name);
    expect(spike.sort()).toEqual(["SPIKE_DUST", "SPIKE_FRAME", "SPIKE_INPUT"]);
  });

  it("HELLO is a server -> client control message, PING / PONG are bytes", () => {
    expect(MESSAGE_CATALOG.HELLO).toEqual({
      channel: "control",
      direction: "s2c",
      id: "hello",
      status: "active",
      rate: { kind: "once" },
    });
    expect(MESSAGE_CATALOG.PING).toMatchObject({ channel: "bytes", direction: "c2s", id: 0x02, status: "active" });
    expect(MESSAGE_CATALOG.PONG).toMatchObject({ channel: "bytes", direction: "s2c", id: 0x27, status: "active" });
  });
});

describe("message catalog types", () => {
  it("keeps literal ids and splits names by channel", () => {
    expectTypeOf(MESSAGE_CATALOG.PING.id).toEqualTypeOf<2>();
    expectTypeOf(MESSAGE_CATALOG.DUST_REQUEST.id).toEqualTypeOf<3>();
    expectTypeOf(MESSAGE_CATALOG.HELLO.id).toEqualTypeOf<"hello">();
    expectTypeOf<"PING" | "PONG" | "FRAME" | "DUST_SNAPSHOT" | "SPIKE_INPUT">().toExtend<BytesMessageName>();
    expectTypeOf<"HELLO" | "READY" | "PURCHASE_RESULT">().toExtend<ControlMessageName>();
    expectTypeOf<"HELLO">().not.toExtend<BytesMessageName>();
    expectTypeOf<"PING">().not.toExtend<ControlMessageName>();
    expectTypeOf<BytesMessageName | ControlMessageName>().toEqualTypeOf<MessageName>();
    expectTypeOf(MESSAGE_CATALOG.PING).toExtend<MessageDef>();
  });

  it("rejects a bytes entry with a string id", () => {
    // @ts-expect-error -- a bytes message id must be a number
    const bad: MessageDef = {
      channel: "bytes",
      direction: "c2s",
      id: "ping",
      status: "active",
      rate: { kind: "tick" },
    };
    expect(bad).toBeDefined();
  });
});
