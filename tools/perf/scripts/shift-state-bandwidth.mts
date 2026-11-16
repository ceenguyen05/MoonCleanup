/* eslint-disable @typescript-eslint/no-explicit-any -- harness: apps/server is loaded dynamically through its package context, so its types are not available here */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const serverDir = fileURLToPath(new URL("../../../apps/server/", import.meta.url));
const req = createRequire(serverDir + "package.json");
const { Encoder } = req("@colyseus/schema");
const shared = req("@moon-cleanup/shared");
const { loadGameData } = req("@moon-cleanup/game-data");
const { createPlotGrid } = req("@moon-cleanup/world");
const { encodeInput } = req("@moon-cleanup/protocol");
const S = serverDir + "src/net/shift/";
const { ShiftCore } = req(S + "shift-core.ts");
const st = req(S + "shift-state.ts");
const { STANDARD_GRID_PARAMS } = shared as any;
const data = loadGameData();
const world = { grid: createPlotGrid(STANDARD_GRID_PARAMS), ground: { heightAtXYZ: () => 0 } };
const pid = (i: number) => `00000000-0000-4000-8000-0000000000${(0xa0 + i).toString(16)}`;
function pct(a: Float64Array, p: number) {
  const s = Array.from(a).sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
function run(n: number) {
  const core = new ShiftCore(
    { data, world, contractId: "00000000-0000-4000-8000-0000000000c7", shiftType: "private", simTickHz: 20 } as any,
    0,
  );
  const state = new st.ShiftStateSchemaClass();
  state.contractId = "00000000-0000-4000-8000-0000000000c7";
  state.shiftType = "private";
  state.protocolVersion = 1;
  state.simTickHz = 20;
  state.snapshotHz = 10;
  state.walletLumens = 0;
  state.shinePolished = 0;
  state.plotCount = world.grid.count;
  state.visitedOutposts = 0;
  const beacons = new st.ArraySchema();
  for (let i = 0; i < 12; i++) {
    const b = new st.BeaconState();
    b.plotId = 0;
    b.active = false;
    beacons.push(b);
  }
  state.beacons = beacons;
  const perms = new st.PermissionsState();
  perms.tempCanBuild = perms.tempCanSpendShared = perms.tempCanDriveShared = false;
  state.permissions = perms;
  state.fulfilled = false;
  state.nearParcelsCollected = 0;
  const infos: any[] = [];
  for (let i = 0; i < n; i++) {
    core.addSeat({ playerId: pid(i), displayName: `Bot${i}`, role: i === 0 ? "holder" : "staff" } as any, 0);
    const p = new st.PlayerInfoState();
    p.playerId = pid(i);
    p.displayName = `Bot${i}`;
    p.slot = i;
    p.role = i ? "staff" : "holder";
    p.tenureLevel = 1;
    p.connected = true;
    p.afk = false;
    p.hidden = false;
    p.toolsOwned = 1;
    p.equippedTool = 0;
    state.players.set(`sess${i}`, p);
    infos.push(p);
  }
  const enc = new Encoder(state);
  const full = enc.encodeAll().length;
  enc.discardChanges();
  let frameBytes = 0,
    frames = 0,
    patchBytes = 0,
    patches = 0,
    patchEmpty = 0;
  const frameSizes: number[] = [];
  const sink = {
    frame(_s: number, b: Uint8Array) {
      frameBytes += b.byteLength + 1;
      frames++;
      frameSizes.push(b.byteLength + 1);
    },
    events() {},
  };
  const buf = new Uint8Array(32);
  const mk = (k: number, s: number) => {
    const m = {
      seq: (k + 1) & 0xffff,
      moveX: 0,
      moveY: 127,
      yaw: (k * 97 + s * 1000) & 0xffff,
      pitch: 0,
      buttons: k % 40 < 30 ? 8 : 1,
      toolParam: 128,
    };
    const len = encodeInput(buf, m as any);
    return buf.slice(1, len);
  };
  const bodies = Array.from({ length: n }, (_, s) => Array.from({ length: 4096 }, (_, k) => mk(k, s)));
  const W = 400,
    N = 1200;
  const ring = new Float64Array(N);
  const ringSchema = new Float64Array(N);
  for (let t = 0; t < W + N; t++) {
    const t0 = performance.now();
    for (let s = 0; s < n; s++) core.receiveInput(s, bodies[s][t], t * 50);
    core.step(sink);
    const t1 = performance.now();
    let patchLen = -1;
    if (core.lastWasFrameTick) {
      if (state.walletLumens !== core.sim.wallet) state.walletLumens = core.sim.wallet;
      if (state.shinePolished !== core.sim.shinePolished) state.shinePolished = core.sim.shinePolished;
      const m = st.nearParcelsMask(core.sim);
      if (state.nearParcelsCollected !== m) state.nearParcelsCollected = m;
      const b = enc.encode();
      enc.discardChanges();
      patchLen = b.length;
    }
    const t2 = performance.now();
    if (t >= W) {
      ring[t - W] = t2 - t0;
      ringSchema[t - W] = t2 - t1;
      if (patchLen >= 0) {
        patches++;
        patchBytes += patchLen;
        if (patchLen === 0) patchEmpty++;
      }
    }
  }
  // frame bytes counted over whole run (warmup incl.); rate from run seconds
  const secs = (W + N) / 20;
  const fps = frameBytes / secs / n; // per client B/s
  const patchPerClient = patchBytes / (N / 20);
  const overhead = 80 * 10; // 10 writes/s x 80 B (netcode.md 14 estimate)
  return {
    n,
    fullStateBytes: full,
    framePerClientBps: +fps.toFixed(0),
    frameAvg: +(frameBytes / frames).toFixed(1),
    frameMax: Math.max(...frameSizes),
    patchesInRun: patches,
    patchEmpty,
    patchBytesPerClientBps: +patchPerClient.toFixed(1),
    avgPatchBytes: +(patchBytes / Math.max(1, patches)).toFixed(2),
    totalPerClientBpsWithOverhead: +(fps + patchPerClient + overhead).toFixed(0),
    tickP50: +pct(ring, 0.5).toFixed(3),
    tickP95: +pct(ring, 0.95).toFixed(3),
    tickMax: +Math.max(...ring).toFixed(3),
    schemaEncodeP95: +pct(ringSchema, 0.95).toFixed(3),
  };
}
const out = [];
for (const n of [1, 6]) out.push(run(n));
console.log(JSON.stringify(out));
// Synthetic delta sizes (flat test world never changes wallet/mask, so force each change once)
function deltas(n: number) {
  const state = new st.ShiftStateSchemaClass();
  state.contractId = "00000000-0000-4000-8000-0000000000c7";
  state.shiftType = "private";
  state.protocolVersion = 1;
  state.simTickHz = 20;
  state.snapshotHz = 10;
  state.walletLumens = 0;
  state.shinePolished = 0;
  state.plotCount = 163841;
  state.nearParcelsCollected = 0;
  const infos: any[] = [];
  for (let i = 0; i < n; i++) {
    const p = new st.PlayerInfoState();
    p.playerId = pid(i);
    p.displayName = `Bot${i}`;
    p.slot = i;
    p.role = "staff";
    p.connected = true;
    p.toolsOwned = 1;
    state.players.set(`s${i}`, p);
    infos.push(p);
  }
  const enc = new Encoder(state);
  enc.encodeAll();
  enc.discardChanges();
  const one = (f: () => void) => {
    f();
    const l = enc.encode().length;
    enc.discardChanges();
    return l;
  };
  return {
    n,
    maskOnly: one(() => {
      state.nearParcelsCollected = 5;
    }),
    maskNoChange: one(() => {
      state.nearParcelsCollected = 5;
    }),
    walletOnly: one(() => {
      state.walletLumens = 1234.5;
    }),
    shineOnly: one(() => {
      state.shinePolished = 77;
    }),
    allThree: one(() => {
      state.nearParcelsCollected = 7;
      state.walletLumens = 2000;
      state.shinePolished = 80;
    }),
    toolEquip: one(() => {
      infos[0].equippedTool = 2;
      infos[0].toolsOwned = 3;
    }),
  };
}
console.log("DELTAS " + JSON.stringify([deltas(1), deltas(6)]));
