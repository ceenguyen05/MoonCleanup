// T06 GPU lane, Node side: records the draw stream of the CPU reference atlas (src/core/tiles.ts) so a browser page
// can replay it on the GPU and compare bytes. Files written by save(dir):
//   events.bin   Float32 records of EV floats: frame, kind, slot, su, sv, eu, ev, widthCm, depth16, level, x0, y0,
//                x1, y1, uploadIndex, 0   (kind 0 = live stroke, 1 = ledger-zero clear, 2 = rebuilt tile upload)
//   uploads.bin  px * px * 4 bytes per rebuilt tile, in uploadIndex order
//   final.bin    px * px * 4 bytes per slot listed in meta.finalSlots (the CPU reference result)
//   meta.json    sizes, counts, per-frame CPU ms of the reference
// Every value is an integer below 2^24 or a half-integer, so Float32 holds it exactly.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TileAtlasRef, TileRecorder } from "../src/core/tiles";

export const EV = 16;
export const KIND_DRAW = 0;
export const KIND_CLEAR = 1;
export const KIND_REBUILT = 2;

export class GpuRecorder implements TileRecorder {
  frame = 0;
  private ev = new Float32Array(EV * 4096);
  private evN = 0;
  private readonly uploads: Uint8Array[] = [];
  private readonly cpuMs: number[] = [];
  draws = 0;
  clears = 0;
  rebuilt = 0;

  private row(): number {
    if ((this.evN + 1) * EV > this.ev.length) {
      const g = new Float32Array(this.ev.length * 2);
      g.set(this.ev);
      this.ev = g;
    }
    return this.evN++ * EV;
  }

  onDraw(
    slot: number,
    su: number,
    sv: number,
    eu: number,
    ev: number,
    widthCm: number,
    depth16: number,
    level: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): void {
    const o = this.row();
    const e = this.ev;
    e[o] = this.frame;
    e[o + 1] = KIND_DRAW;
    e[o + 2] = slot;
    e[o + 3] = su;
    e[o + 4] = sv;
    e[o + 5] = eu;
    e[o + 6] = ev;
    e[o + 7] = widthCm;
    e[o + 8] = depth16;
    e[o + 9] = level;
    e[o + 10] = x0;
    e[o + 11] = y0;
    e[o + 12] = x1;
    e[o + 13] = y1;
    this.draws++;
  }

  onClear(slot: number, x0: number, y0: number, x1: number, y1: number): void {
    const o = this.row();
    const e = this.ev;
    e[o] = this.frame;
    e[o + 1] = KIND_CLEAR;
    e[o + 2] = slot;
    e[o + 10] = x0;
    e[o + 11] = y0;
    e[o + 12] = x1;
    e[o + 13] = y1;
    this.clears++;
  }

  onRebuilt(slot: number, data: Uint8Array, base: number, px: number): void {
    const o = this.row();
    const e = this.ev;
    e[o] = this.frame;
    e[o + 1] = KIND_REBUILT;
    e[o + 2] = slot;
    e[o + 14] = this.uploads.length;
    this.uploads.push(data.slice(base, base + px * px * 4));
    this.rebuilt++;
  }

  /** Call after every TileAtlasRef.frame(). */
  endFrame(cpuMs: number): void {
    this.cpuMs.push(Math.round(cpuMs * 1000) / 1000);
    this.frame++;
  }

  save(dir: string, tiles: TileAtlasRef, label: string, extra: Record<string, unknown> = {}): void {
    mkdirSync(dir, { recursive: true });
    const px = tiles.px;
    const tileBytes = px * px * 4;
    writeFileSync(path.join(dir, "events.bin"), new Uint8Array(this.ev.buffer, 0, this.evN * EV * 4));
    const up = new Uint8Array(this.uploads.length * tileBytes);
    this.uploads.forEach((u, i) => up.set(u, i * tileBytes));
    writeFileSync(path.join(dir, "uploads.bin"), up);
    const finalSlots: number[] = [];
    for (let s = 0; s < tiles.plotOfSlot.length; s++) if (tiles.plotOfSlot[s]! >= 0) finalSlots.push(s);
    const fin = new Uint8Array(finalSlots.length * tileBytes);
    finalSlots.forEach((s, i) => fin.set(tiles.data.subarray(s * tileBytes, (s + 1) * tileBytes), i * tileBytes));
    writeFileSync(path.join(dir, "final.bin"), fin);
    const sorted = [...this.cpuMs].sort((a, b) => a - b);
    const q = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
    writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify(
        {
          label,
          px,
          slots: tiles.plotOfSlot.length,
          frames: this.frame,
          events: this.evN,
          draws: this.draws,
          clears: this.clears,
          rebuilt: this.rebuilt,
          finalSlots,
          cpuRefMs: { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted[sorted.length - 1] ?? 0 },
          ...extra,
        },
        null,
        1,
      ),
    );
  }
}
