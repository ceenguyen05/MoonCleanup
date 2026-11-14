import { PNG } from "pngjs";

/** Decoded 8-bit sRGB RGBA image. */
export interface Img {
  readonly width: number;
  readonly height: number;
  /** RGBA, row-major, length = width * height * 4. */
  readonly data: Uint8Array;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function decodePng(buf: Uint8Array): Img {
  const p = PNG.sync.read(Buffer.from(buf));
  return { width: p.width, height: p.height, data: new Uint8Array(p.data) };
}

export function encodePng(img: Img): Buffer {
  const p = new PNG({ width: img.width, height: img.height });
  p.data = Buffer.from(img.data);
  return PNG.sync.write(p);
}

/** Build an image from a per-pixel function (used by synthetic charts). */
export function makeImage(
  width: number,
  height: number,
  fn: (x: number, y: number) => readonly [number, number, number],
): Img {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

export function fullRect(img: Img): Rect {
  return { x: 0, y: 0, w: img.width, h: img.height };
}

export function clampRect(img: Img, r: Rect): Rect {
  const x = Math.max(0, Math.min(img.width, r.x));
  const y = Math.max(0, Math.min(img.height, r.y));
  return { x, y, w: Math.max(0, Math.min(img.width - x, r.w)), h: Math.max(0, Math.min(img.height - y, r.h)) };
}

/** Rec.709 luma of sRGB-encoded 8-bit values, 0..255 (display-referred, matches what a viewer sees). */
export function luma709(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Luma plane (Float32, 0..255) of a rect. */
export function lumaPlane(img: Img, rect: Rect): { plane: Float32Array; w: number; h: number } {
  const r = clampRect(img, rect);
  const plane = new Float32Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = ((r.y + y) * img.width + (r.x + x)) * 4;
      plane[y * r.w + x] = luma709(img.data[i]!, img.data[i + 1]!, img.data[i + 2]!);
    }
  }
  return { plane, w: r.w, h: r.h };
}
