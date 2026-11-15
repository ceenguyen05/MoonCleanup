// GPU stroke replay into the dust tile atlas (M1-W3-T02): three r187 WebGPURenderer + TSL, one fragment path for the
// WebGPU and the WebGL2 backend (W1-T06 decision: no compute twin). Executes a `DustReplayBatch`:
//   pass 1 (atlas)    tile fills (no blending), then every stroke / clear instance in one instanced draw with
//                     RGB reverse-subtract and alpha max blending;
//   pass 2 (scratch)  only in a frame that finishes a tile rebuild: per 0.8 m ledger cell, mean R of the tile minus the
//                     ledger's remaining dust, written to a 32 x 32 block of a small scratch target;
//   pass 3 (atlas)    the scratch value subtracted from R of the rebuilt tile (same blending as strokes).
// A frame without strokes or rebuild work issues no pass at all. The arithmetic is the one of `CpuAtlas`
// (replay-batch.ts); the verify page compares the bytes.
// The instance attributes wrap the batch's own typed arrays, so `flush` copies nothing and allocates nothing itself.

import {
  BufferAttribute,
  ClampToEdgeWrapping,
  CustomBlending,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InterpolationSamplingType,
  LinearFilter,
  MaxEquation,
  Mesh,
  NearestFilter,
  NoBlending,
  NoColorSpace,
  NodeMaterial,
  OneFactor,
  OrthographicCamera,
  RenderTarget,
  ReverseSubtractEquation,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  type Node,
  type Texture,
  type WebGPURenderer,
} from "three/webgpu";
import {
  abs,
  attribute,
  float,
  floor,
  ivec2,
  max,
  min,
  mix,
  positionGeometry,
  select,
  sqrt,
  textureLoad,
  varying,
  vec2,
  vec4,
} from "three/tsl";
import {
  BATCH_MAX_RESIDUALS,
  CELLS,
  CELL_COUNT,
  FRAME_EDGE_MM,
  FRAME_HALF_MM,
  atlasHeight,
  atlasWidth,
  type AtlasLayout,
  type DustReplayBatch,
} from "./replay-batch";

type InstancedQuad = {
  readonly geometry: InstancedBufferGeometry;
  readonly attributes: InstancedBufferAttribute[];
};

function instancedQuad(arrays: Readonly<Record<string, Float32Array>>): InstancedQuad {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), 3));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  const attributes: InstancedBufferAttribute[] = [];
  for (const [name, array] of Object.entries(arrays)) {
    const a = new InstancedBufferAttribute(array, 4);
    a.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, a);
    attributes.push(a);
  }
  geometry.instanceCount = 0;
  return { geometry, attributes };
}

/**
 * Marks the instance arrays of a quad for upload. The whole array goes up (at most 4 x 32 KB): an update range for
 * the used part was tried and costs 108 B of heap per pass, because three empties `updateRanges` after every upload
 * and the range has to be pushed again.
 */
function upload(quad: InstancedQuad): void {
  for (const a of quad.attributes) a.needsUpdate = true;
}

function blendedMaterial(): NodeMaterial {
  const m = new NodeMaterial();
  m.blending = CustomBlending;
  m.blendEquation = ReverseSubtractEquation;
  m.blendSrc = OneFactor;
  m.blendDst = OneFactor;
  m.blendEquationAlpha = MaxEquation;
  m.blendSrcAlpha = OneFactor;
  m.blendDstAlpha = OneFactor;
  return plain(m);
}

function plain(m: NodeMaterial): NodeMaterial {
  m.depthTest = false;
  m.depthWrite = false;
  m.side = DoubleSide;
  m.toneMapped = false;
  m.fog = false;
  m.lights = false;
  return m;
}

function quadMesh(quad: InstancedQuad, material: NodeMaterial, order: number): Mesh {
  const mesh = new Mesh(quad.geometry, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = order;
  return mesh;
}

type F = Node<"float">;

/** Per-instance value handed to the fragment stage without interpolation (bit-exact on every fragment). */
function flat(node: Node<"vec4">): Node<"vec4"> {
  return varying(node).setInterpolation(InterpolationSamplingType.FLAT);
}

export class DustReplayPass {
  /** The atlas (RGBA8, linear filtering, raw bytes): R remaining dust, G unpolish, B untrampled, A berm height. */
  readonly target: RenderTarget;
  readonly scratch: RenderTarget;
  /** Passes issued so far (1 per frame with strokes, +2 in a frame that finishes a rebuild). */
  passes = 0;

  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly atlasScene = new Scene();
  private readonly meanScene = new Scene();
  private readonly residScene = new Scene();
  private readonly fill: InstancedQuad;
  private readonly stroke: InstancedQuad;
  private readonly mean: InstancedQuad;
  private readonly resid: InstancedQuad;
  private readonly fillMesh: Mesh;
  private readonly strokeMesh: Mesh;
  private readonly ledgerBytes = new Uint8Array(BATCH_MAX_RESIDUALS * CELL_COUNT * 4);
  private readonly ledgerTexture: DataTexture;

  constructor(
    readonly layout: AtlasLayout,
    private readonly batch: DustReplayBatch,
  ) {
    const w = atlasWidth(layout);
    const h = atlasHeight(layout);
    const px = layout.slotPx;
    const ts = FRAME_EDGE_MM / px;
    const cellPx = px / CELLS;
    const scratchH = CELLS * BATCH_MAX_RESIDUALS;

    this.target = new RenderTarget(w, h, {
      depthBuffer: false,
      format: RGBAFormat,
      type: UnsignedByteType,
      colorSpace: NoColorSpace,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
    });
    this.target.texture.name = "mc:dust-atlas";
    this.target.texture.wrapS = ClampToEdgeWrapping;
    this.target.texture.wrapT = ClampToEdgeWrapping;
    this.scratch = new RenderTarget(CELLS, scratchH, {
      depthBuffer: false,
      format: RGBAFormat,
      type: UnsignedByteType,
      colorSpace: NoColorSpace,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
    });
    this.scratch.texture.name = "mc:dust-residual";
    this.ledgerTexture = new DataTexture(this.ledgerBytes, CELLS, scratchH, RGBAFormat, UnsignedByteType);
    this.ledgerTexture.name = "mc:dust-ledger-cells";
    this.ledgerTexture.colorSpace = NoColorSpace;
    this.ledgerTexture.minFilter = NearestFilter;
    this.ledgerTexture.magFilter = NearestFilter;
    this.ledgerTexture.generateMipmaps = false;
    this.ledgerTexture.flipY = false;
    this.ledgerTexture.needsUpdate = true;

    const corner = positionGeometry.xy;
    /** Clip position of a quad corner whose rectangle is given in texels of a `tw` x `th` target (row 0 on top). */
    const place = (rect: Node<"vec4">, tw: number, th: number) => {
      const p = mix(rect.xy, rect.zw, corner);
      return { p, clip: vec4(p.x.div(tw).mul(2).sub(1), float(1).sub(p.y.div(th).mul(2)), 0, 1) };
    };
    // Texel fetches use the same row numbers on both backends: three maps the bottom-up storage of a WebGL2 render
    // target itself (measured: an explicit flip here breaks the WebGL2 bytes, see the W3-T02 report).

    // ---- fills ------------------------------------------------------------------------------------------------
    this.fill = instancedQuad({ aRect: batch.fillRect, aColor: batch.fillColor });
    const fillMat = plain(new NodeMaterial());
    fillMat.blending = NoBlending;
    fillMat.vertexNode = place(attribute("aRect", "vec4"), w, h).clip;
    fillMat.fragmentNode = flat(attribute("aColor", "vec4"));
    this.fillMesh = quadMesh(this.fill, fillMat, 0);
    this.atlasScene.add(this.fillMesh);

    // ---- strokes and clears -----------------------------------------------------------------------------------
    this.stroke = instancedQuad({
      aRect: batch.strokeRect,
      aSeg: batch.strokeSeg,
      aPar: batch.strokePar,
      aOrg: batch.strokeOrg,
    });
    const strokeMat = blendedMaterial();
    {
      const placed = place(attribute("aRect", "vec4"), w, h);
      strokeMat.vertexNode = placed.clip;
      const seg = flat(attribute("aSeg", "vec4"));
      const par = flat(attribute("aPar", "vec4"));
      // Tile texel of the fragment: the interpolated value is (integer + 0.5) at the pixel centre.
      const t = floor(varying(placed.p.sub(attribute("aOrg", "vec4").xy)));
      const hw = par.x;
      const band = par.y;
      const s = par.z;
      const wx = t.x.add(0.5).mul(ts).sub(FRAME_HALF_MM).sub(seg.x);
      const wy = t.y.add(0.5).mul(ts).sub(FRAME_HALF_MM).sub(seg.y);
      const dx = seg.z.sub(seg.x);
      const dy = seg.w.sub(seg.y);
      const len = sqrt(dx.mul(dx).add(dy.mul(dy)));
      const isDisc = len.equal(0);
      // Endpoints are integer millimetres, so a segment is at least 1 mm long and max(len, 1) is len itself.
      const safeLen = max(len, 1);
      const ax = dx.div(safeLen);
      const ay = dy.div(safeLen);
      const half = ts / 2;
      const discSide = sqrt(wx.mul(wx).add(wy.mul(wy)));
      const discC = min(float(1), float(0.5).add(hw.sub(discSide).div(ts)));
      const along = wx.mul(ax).add(wy.mul(ay));
      const segSide = abs(wy.mul(ax).sub(wx.mul(ay)));
      const w1 = min(segSide.add(half), hw);
      const w0 = max(segSide.sub(half), hw.negate());
      const l1 = min(along.add(half), len);
      const l0 = max(along.sub(half), 0);
      const inside = w1.greaterThan(w0).and(l1.greaterThan(l0));
      const segC = select(
        inside,
        w1
          .sub(w0)
          .mul(l1.sub(l0))
          .div(ts * ts),
        float(0),
      );
      const c: F = select(isDisc, discC, segC);
      const side: F = select(isDisc, discSide, select(l1.lessThanEqual(l0), float(-1), segSide));
      const covered = c.greaterThan(0);
      const r = select(covered, floor(s.mul(255).mul(c).add(0.5)), float(0));
      const g = select(covered, floor(c.mul(63.75).add(0.5)), float(0));
      const bx = side.sub(hw).div(band);
      const k = select(bx.lessThan(0.35), bx.div(0.35), float(1).sub(bx).div(0.65));
      const inBand = side.greaterThanEqual(0).and(bx.greaterThan(0)).and(bx.lessThan(1));
      const lip = select(inBand, floor(s.mul(255).mul(k).add(0.5)), float(0));
      strokeMat.fragmentNode = select(par.w.greaterThan(0.5), vec4(1, 0, 0, 0), vec4(r, g, 0, lip).div(255));
    }
    this.strokeMesh = quadMesh(this.stroke, strokeMat, 1);
    this.atlasScene.add(this.strokeMesh);

    // ---- residual, pass 2: older = valid ? (ledger == 0 ? 255 : mean(R) - ledger) : 0 ---------------------------
    this.mean = instancedQuad({ aRect: batch.residScratchRect, aInfo: batch.residInfo });
    const meanMat = plain(new NodeMaterial());
    meanMat.blending = NoBlending;
    {
      const rect = attribute("aRect", "vec4");
      const placed = place(rect, CELLS, scratchH);
      meanMat.vertexNode = placed.clip;
      const info = flat(attribute("aInfo", "vec4"));
      const cell = floor(varying(placed.p.sub(rect.xy)));
      let sum: F = float(0);
      for (let y = 0; y < cellPx; y++) {
        for (let x = 0; x < cellPx; x++) {
          const tx: F = info.x.add(cell.x.mul(cellPx)).add(x);
          const ty: F = info.y.add(cell.y.mul(cellPx)).add(y);
          const texel = textureLoad(this.target.texture, ivec2(vec2(tx, ty)));
          sum = sum.add(floor(texel.x.mul(255).add(0.5))) as F;
        }
      }
      const meanR = floor(sum.div(cellPx * cellPx).add(0.5));
      const led = textureLoad(this.ledgerTexture, ivec2(vec2(cell.x, info.z.mul(CELLS).add(cell.y))));
      const rl = floor(led.x.mul(255).add(0.5));
      const older = select(
        led.y.greaterThan(0.5),
        select(rl.lessThan(0.5), float(255), max(meanR.sub(rl), 0)),
        float(0),
      );
      meanMat.fragmentNode = vec4(older.div(255), 0, 0, 1);
    }
    this.meanScene.add(quadMesh(this.mean, meanMat, 0));

    // ---- residual, pass 3: R <- max(0, R - older) -------------------------------------------------------------
    this.resid = instancedQuad({ aRect: batch.residRect, aInfo: batch.residInfo });
    const residMat = blendedMaterial();
    {
      const placed = place(attribute("aRect", "vec4"), w, h);
      residMat.vertexNode = placed.clip;
      const info = flat(attribute("aInfo", "vec4"));
      const cell = floor(varying(placed.p.sub(attribute("aInfo", "vec4").xy)).div(cellPx));
      const ty: F = info.z.mul(CELLS).add(cell.y);
      const older = textureLoad(this.scratch.texture, ivec2(vec2(cell.x, ty))).x;
      residMat.fragmentNode = vec4(older, 0, 0, 0);
    }
    this.residScene.add(quadMesh(this.resid, residMat, 0));

    for (const scene of [this.atlasScene, this.meanScene, this.residScene]) {
      scene.matrixAutoUpdate = false;
      scene.matrixWorldAutoUpdate = false;
    }
  }

  /** The atlas texture for the terrain / regolith shader (tile origin and size come from `DustTileAtlas`). */
  get texture(): Texture {
    return this.target.texture;
  }

  /**
   * Creates the four pipelines before play, so the first stroke and the first tile rebuild do not pay for pipeline
   * creation inside a frame: every pass is issued once with one instance (zero-area quads; the one real quad goes to
   * scratch block 0, which every rebuild rewrites before it is read). Call once after the renderer is initialised and
   * before the first `DustTileAtlas.frame()` (and again after a device loss). Synchronous on purpose: three r187's
   * `compileAsync` holds renderer state (MRT, render context, call depth) across its awaits, and a frame rendered
   * meanwhile came out black for good in the game (W3-T02 report).
   */
  prepare(renderer: WebGPURenderer): void {
    const batch = this.batch;
    for (let i = 0; i < 4; i++) {
      batch.fillRect[i] = 0;
      batch.fillColor[i] = 0;
      batch.strokeRect[i] = 0;
      batch.strokeSeg[i] = 0;
      batch.strokePar[i] = 0;
      batch.strokeOrg[i] = 0;
      batch.residRect[i] = 0;
      batch.residInfo[i] = 0;
    }
    for (let i = 0; i < CELL_COUNT * 4; i++) batch.ledgerCells[i] = 0;
    batch.fillN = 1;
    batch.strokeN = 1;
    batch.residN = 1;
    this.flush(renderer);
    batch.reset();
  }

  /** Executes the batch of this frame on the GPU. Call once after `DustTileAtlas.frame()`. */
  flush(renderer: WebGPURenderer): void {
    const batch = this.batch;
    if (batch.empty) return;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    if (batch.fillN + batch.strokeN > 0) {
      this.fillMesh.visible = batch.fillN > 0;
      this.strokeMesh.visible = batch.strokeN > 0;
      this.fill.geometry.instanceCount = batch.fillN;
      this.stroke.geometry.instanceCount = batch.strokeN;
      if (batch.fillN > 0) upload(this.fill);
      if (batch.strokeN > 0) upload(this.stroke);
      renderer.setRenderTarget(this.target);
      renderer.render(this.atlasScene, this.camera);
      this.passes++;
    }
    if (batch.residN > 0) {
      const n = batch.residN * CELL_COUNT * 4;
      const src = batch.ledgerCells;
      const dst = this.ledgerBytes;
      for (let i = 0; i < n; i++) dst[i] = src[i]!;
      this.ledgerTexture.needsUpdate = true;
      this.mean.geometry.instanceCount = batch.residN;
      this.resid.geometry.instanceCount = batch.residN;
      upload(this.mean);
      upload(this.resid);
      renderer.setRenderTarget(this.scratch);
      renderer.render(this.meanScene, this.camera);
      renderer.setRenderTarget(this.target);
      renderer.render(this.residScene, this.camera);
      this.passes += 2;
    }

    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.target.dispose();
    this.scratch.dispose();
    this.ledgerTexture.dispose();
    for (const q of [this.fill, this.stroke, this.mean, this.resid]) q.geometry.dispose();
    for (const scene of [this.atlasScene, this.meanScene, this.residScene]) {
      for (const child of scene.children) ((child as Mesh).material as NodeMaterial).dispose();
    }
  }
}
