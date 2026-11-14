// PCF kernels for the cascades (M0-W3-T08), plugged into three r187's per-shadow `LightShadow.filterNode` hook
// (`ShadowNode.setupShadow`: `shadow.filterNode || getShadowFilterFn(renderer.shadowMap.type)`).
//
//   vogel5  three's own `PCFShadowFilter`: 5 hardware comparisons on a Vogel disk rotated per pixel by interleaved gradient
//           noise. Per pixel and cascade: 1 IGN + 5 x (sqrt, sin, cos) + 5 comparisons; the rotation shows as dither without a
//           temporal resolve (M0-W2-T07 finding 3). `shadowFilterFor` returns null for it (the renderer's default).
//   pcf3    the EXACT 3x3 tent from 4 hardware comparisons (M0 look-polish r2; the optimised PCF of Castano / "The Witness"):
//           tap positions and weights come from the sub-texel position of the lookup, so the result is a continuous,
//           hole-free tent over 4 x 4 texels (weights 2 - |d| per axis; 10-90 % edge width 2.2 texels, computed in
//           `shadow-filter.test.ts`; `tent4` at radius 2: 2.6 with a flat step in the middle). No trigonometry, no dither,
//           4 taps. Default of the SMAA presets. `shadow.radius` is not used.
//   pcf5    the exact 5x5 kernel from 9 hardware comparisons (6 x 6 texels, 10-90 % edge width 2.9 texels): softer, 5
//           taps more. Selectable per knob (all cascades, or cascade 0 only with `shadowfilter0=pcf5`).
//   tent4   4 hardware comparisons at fixed (+-0.5, +-0.5) x radius texel offsets. A hardware comparison is a bilinear 2x2,
//           i.e. a 1-texel box; at radius 1 the four boxes tile a 2-texel box, but at the Medium / Low radius of 2 they sit
//           2 texels apart and leave a 1-texel HOLE in the middle of the kernel: an edge becomes ramp / flat 50 % plateau /
//           ramp, which read as doubled, stair-stepped shadow edges (M0-visual-checks). Kept for A/B only.
//   hard    one hardware comparison (bilinear 2x2): the cheapest kernel that is not aliased to single texels.
//
// A filter function receives `{ depthTexture, shadowCoord, shadow, depthLayer }` and returns the lit fraction 0..1.

import {
  Fn,
  add,
  clamp,
  dot,
  float,
  floor,
  mix,
  normalWorldGeometry,
  reference,
  renderGroup,
  texture,
  uniform,
  vec2,
} from "three/tsl";
import type { LightShadow, Node, Texture } from "three/webgpu";
import type { ShadowFilterId } from "../look-knobs";
import { keyDirectionUniform } from "./key-direction";

// The filter inputs are three's internal node shapes (not in @types/three); the graph is built once per material.
/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

interface FilterInputs {
  readonly depthTexture: Texture & { readonly isArrayTexture?: boolean };
  readonly shadowCoord: TslNode;
  readonly shadow: LightShadow;
  readonly depthLayer?: TslNode;
}

export type ShadowFilterFn = (inputs: FilterInputs) => Node;

/** Offsets of the 4-tap tent in units of the PCF radius (texels). */
export const TENT4_OFFSETS: readonly (readonly [number, number])[] = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [-0.5, 0.5],
  [0.5, 0.5],
];

// One uniform pair per shadow, shared by every material that receives it (same rule as three's own filters).
const shadowUniforms = new WeakMap<LightShadow, { mapSize: TslNode; radius: TslNode }>();

function uniformsOf(shadow: LightShadow): { mapSize: TslNode; radius: TslNode } {
  let uniforms = shadowUniforms.get(shadow);
  if (uniforms === undefined) {
    uniforms = {
      mapSize: (reference("mapSize", "vec2", shadow) as TslNode).setGroup(renderGroup),
      radius: (reference("radius", "float", shadow) as TslNode).setGroup(renderGroup),
    };
    shadowUniforms.set(shadow, uniforms);
  }
  return uniforms;
}

function compareAt(inputs: FilterInputs, uv: TslNode): TslNode {
  let depth: TslNode = texture(inputs.depthTexture, uv);
  if (inputs.depthTexture.isArrayTexture === true) depth = depth.depth(inputs.depthLayer);
  return depth.compare(inputs.shadowCoord.z);
}

// three calls a filter with one plain object; `Fn` types that as a string-keyed record.
type RawInputs = { readonly [key: string]: unknown };

const tent4Filter = Fn((raw: RawInputs) => {
  const inputs = raw as unknown as FilterInputs;
  const { mapSize, radius } = uniformsOf(inputs.shadow);
  const step: TslNode = radius.div(mapSize);
  const taps = TENT4_OFFSETS.map(([x, y]) => compareAt(inputs, inputs.shadowCoord.xy.add(vec2(x, y).mul(step))));
  return (add as (...nodes: TslNode[]) => TslNode)(...taps).mul(1 / TENT4_OFFSETS.length);
}) as unknown as ShadowFilterFn;

/**
 * Tap layout of the exact tents along one axis for a sub-texel position `s` in [0, 1): offsets in texels from the base texel
 * corner and their weights (the weights of an axis sum to `norm`). Pure mirror of the shader maths, for the unit test.
 */
export function tentTaps1d(size: 3 | 5, s: number): { offsets: number[]; weights: number[]; norm: number } {
  if (size === 3) {
    const w0 = 3 - 2 * s;
    const w1 = 1 + 2 * s;
    return { offsets: [(2 - s) / w0 - 1, s / w1 + 1], weights: [w0, w1], norm: 4 };
  }
  const w0 = 4 - 3 * s;
  const w1 = 7;
  const w2 = 1 + 3 * s;
  return { offsets: [(3 - 2 * s) / w0 - 2, (3 + s) / w1, s / w2 + 2], weights: [w0, w1, w2], norm: 12 };
}

/**
 * Receiver-aware kernel size (M0 look-polish round 4), for the KEY LIGHT's cascades only.
 *
 * A PCF kernel is square in shadow-map texels, but on a receiver the light grazes, one texel of the map's vertical axis
 * (the light's "up", which on the ground runs along the light direction) covers texel / sin(angle to the surface) of the
 * surface: 10.5 m of ground per 18.4 cm texel at a 1 degree sun (Low cascade 1). A kernel 4 or 6 texels tall then averages
 * the shadow over tens of metres along the light: a 0.38 m rock is 2 texels tall in that map, so its 22 m shadow never got
 * darker than 58 % and dropped to a faint streak at the first cascade split (VT-M0-04b on Low).
 *
 * The offsets of the taps from the lookup point are therefore scaled by s = clamp(K * N_geometry . L, 0, 1) on BOTH axes:
 * 1 where the light meets the receiver at more than asin(1 / K) = 19.5 degrees (the kernel is unchanged there, so the
 * far-cascade comb fix at a high sun stays), shrinking to one hardware comparison (a bilinear 1-texel box) at a grazing sun.
 * Horizontal too, because at a low sun the edges of upright casters are vertical lines in the map (no staircase to hide),
 * and a wide kernel only dilutes the thin shadows of legs, masts and posts (captures: round-4 report). Surfaces that face
 * the light keep the full kernel at any sun elevation. `receiverKernelK` is a uniform so a capture driver can A/B it at
 * run time (a huge value = the old square kernel).
 */
export const RECEIVER_KERNEL_K = 3;
export const receiverKernelK = uniform(RECEIVER_KERNEL_K);

/** Pure mirror of the kernel scale of the shader, for tests: `nDotL` = cos(angle between receiver normal and light). */
export function receiverKernelScale(nDotL: number, k: number = RECEIVER_KERNEL_K): number {
  return Math.min(1, Math.max(0, k * nDotL));
}

/** Kernel scale at the fragment (`null` when the filter is not receiver-aware). */
function kernelScaleNode(receiverAware: boolean): TslNode {
  if (!receiverAware) return null;
  return clamp(dot(normalWorldGeometry, keyDirectionUniform).mul(receiverKernelK), 0, 1).toVar();
}

/** Tap position on one axis: the kernel's own coordinate, pulled toward the lookup coordinate by the scale. */
function tapAt(position: TslNode, lookup: TslNode, scale: TslNode): TslNode {
  return scale === null ? position : mix(lookup, position, scale).toVar();
}

/** Sub-texel position (0..1 on both axes) and the uv of the base texel corner for the exact tents. */
function tentBase(inputs: FilterInputs, mapSize: TslNode): { st: TslNode; baseUv: TslNode; texel: TslNode } {
  const uv: TslNode = inputs.shadowCoord.xy.mul(mapSize);
  const base: TslNode = floor(uv.add(0.5));
  const st: TslNode = uv.add(0.5).sub(base).toVar();
  const texel: TslNode = vec2(1).div(mapSize).toVar();
  const baseUv: TslNode = base.sub(0.5).mul(texel).toVar();
  return { st, baseUv, texel };
}

const makePcf3 = (receiverAware: boolean): ShadowFilterFn =>
  Fn((raw: RawInputs) => {
    const inputs = raw as unknown as FilterInputs;
    const { mapSize } = uniformsOf(inputs.shadow);
    const { st, baseUv, texel } = tentBase(inputs, mapSize);
    const scale = kernelScaleNode(receiverAware);
    const lookupY: TslNode = inputs.shadowCoord.y;
    const lookupX: TslNode = inputs.shadowCoord.x;
    // Per axis: two taps, weights (3 - 2s) and (1 + 2s), offsets chosen so each bilinear tap reproduces two tent weights.
    const w0: TslNode = st.mul(-2).add(3).toVar();
    const w1: TslNode = st.mul(2).add(1).toVar();
    const o0: TslNode = st.negate().add(2).div(w0).sub(1).mul(texel).toVar();
    const o1: TslNode = st.div(w1).add(1).mul(texel).toVar();
    const y0: TslNode = tapAt(baseUv.y.add(o0.y), lookupY, scale);
    const y1: TslNode = tapAt(baseUv.y.add(o1.y), lookupY, scale);
    const x0: TslNode = tapAt(baseUv.x.add(o0.x), lookupX, scale);
    const x1: TslNode = tapAt(baseUv.x.add(o1.x), lookupX, scale);
    const tap = (x: TslNode, y: TslNode, wx: TslNode, wy: TslNode): TslNode =>
      compareAt(inputs, vec2(x, y)).mul(wx.mul(wy));
    return (add as (...nodes: TslNode[]) => TslNode)(
      tap(x0, y0, w0.x, w0.y),
      tap(x1, y0, w1.x, w0.y),
      tap(x0, y1, w0.x, w1.y),
      tap(x1, y1, w1.x, w1.y),
    ).mul(1 / 16);
  }) as unknown as ShadowFilterFn;

const makePcf5 = (receiverAware: boolean): ShadowFilterFn =>
  Fn((raw: RawInputs) => {
    const inputs = raw as unknown as FilterInputs;
    const { mapSize } = uniformsOf(inputs.shadow);
    const { st, baseUv, texel } = tentBase(inputs, mapSize);
    const scale = kernelScaleNode(receiverAware);
    const lookupY: TslNode = inputs.shadowCoord.y;
    const lookupX: TslNode = inputs.shadowCoord.x;
    const w0: TslNode = st.mul(-3).add(4).toVar();
    const w2: TslNode = st.mul(3).add(1).toVar();
    const o0: TslNode = st.mul(-2).add(3).div(w0).sub(2).mul(texel).toVar();
    const o1: TslNode = st.add(3).div(7).mul(texel).toVar();
    const o2: TslNode = st.div(w2).add(2).mul(texel).toVar();
    const seven: TslNode = float(7);
    const columns: TslNode[] = [o0.x, o1.x, o2.x].map((ox) => tapAt(baseUv.x.add(ox), lookupX, scale));
    const rows: TslNode[] = [o0.y, o1.y, o2.y].map((oy) => tapAt(baseUv.y.add(oy), lookupY, scale));
    const wx: TslNode[] = [w0.x, seven, w2.x];
    const wy: TslNode[] = [w0.y, seven, w2.y];
    const taps: TslNode[] = [];
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        taps.push(compareAt(inputs, vec2(columns[i], rows[j])).mul(wx[i].mul(wy[j])));
      }
    }
    return (add as (...nodes: TslNode[]) => TslNode)(...taps).mul(1 / 144);
  }) as unknown as ShadowFilterFn;

const hardFilter = Fn((raw: RawInputs) => {
  const inputs = raw as unknown as FilterInputs;
  return compareAt(inputs, inputs.shadowCoord.xy);
}) as unknown as ShadowFilterFn;

const pcf3Filter = makePcf3(false);
const pcf5Filter = makePcf5(false);
const pcf3KeyFilter = makePcf3(true);
const pcf5KeyFilter = makePcf5(true);

/**
 * The filter function of a kernel id; `null` = leave three's default for `renderer.shadowMap.type` in place.
 * `receiverAware`: the exact tents scale their height by the key light's angle to the receiver (see `RECEIVER_KERNEL_K`);
 * only for shadows of the key light (it reads `keyDirectionUniform`), never for a local lamp.
 */
export function shadowFilterFor(id: ShadowFilterId, receiverAware = false): ShadowFilterFn | null {
  if (id === "pcf3") return receiverAware ? pcf3KeyFilter : pcf3Filter;
  if (id === "pcf5") return receiverAware ? pcf5KeyFilter : pcf5Filter;
  if (id === "tent4") return tent4Filter;
  if (id === "hard") return hardFilter;
  return null;
}
