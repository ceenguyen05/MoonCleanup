/* global requestAnimationFrame, GPUBufferUsage, GPUTextureUsage, GPUMapMode -- browser page */
// T06 GPU lane, browser side: replays a recorded tile draw stream (gpu/recorder.ts) into an RGBA8 atlas with raw
// WebGPU and compares the result with the CPU reference bytes (src/core/tiles.ts).
// PROTOTYPE MEASUREMENT ONLY: raw WebGPU + WGSL, so the pass cost is not hidden behind an engine. The production
// replay (M1-W3-T02) is three r187 WebGPURenderer + TSL; that port is not what is measured here.
//
// Fragment path: one render pass per frame that has events, one instanced draw; each instance is the texel rectangle
// of one stroke in one tile slot. Blend: RGB reverse-subtract (dst - src), alpha max (WDS 7.3 fragment column).
// Rebuilt tiles arrive as whole-tile uploads (the rebuild is CPU work in this prototype).
// Compute path (WDS 7.3 WebGPU column): per frame, one dispatch over the touched tiles; each thread owns one texel,
// loads the atlas texel, loops over the tile's strokes, writes a scratch storage texture; then one
// copyTextureToTexture per touched tile back into the atlas.

const EV = 16;
const FRAME_HALF_MM = 12800;
const FRAME_EDGE_MM = 25600;
const INST_FLOATS = 16;

const COVERAGE_WGSL = /* wgsl */ `
// Returns (r, g, 0, lip) in 1/255 steps for texel (tx, ty) of a tile. Same arithmetic as TileAtlasRef.draw.
fn strokeAt(tx: f32, ty: f32, seg: vec4f, par: vec4f, ts: f32) -> vec4f {
  let kind = par.w;
  if (kind > 0.5) { return vec4f(1.0, 0.0, 0.0, 0.0); }
  let hw = par.x;
  let band = par.y;
  let s = par.z;
  let wx = (tx + 0.5) * ts - ${FRAME_HALF_MM}.0 - seg.x;
  let wy = (ty + 0.5) * ts - ${FRAME_HALF_MM}.0 - seg.y;
  let dx = seg.z - seg.x;
  let dy = seg.w - seg.y;
  let len = sqrt(dx * dx + dy * dy);
  let h = ts * 0.5;
  var c = 0.0;
  var side = 0.0;
  if (len == 0.0) {
    side = sqrt(wx * wx + wy * wy);
    c = min(1.0, 0.5 + (hw - side) / ts);
  } else {
    let ax = dx / len;
    let ay = dy / len;
    let along = wx * ax + wy * ay;
    let cr = wy * ax - wx * ay;
    side = abs(cr);
    let w1 = min(side + h, hw);
    let w0 = max(side - h, -hw);
    let l1 = min(along + h, len);
    let l0 = max(along - h, 0.0);
    if (w1 > w0 && l1 > l0) { c = ((w1 - w0) * (l1 - l0)) / (ts * ts); }
    if (l1 <= l0) { side = -1.0; }
  }
  var r = 0.0;
  var g = 0.0;
  if (c > 0.0) {
    r = floor(255.0 * s * c + 0.5);
    g = floor(63.75 * c + 0.5);
  }
  var lip = 0.0;
  let bx = (side - hw) / band;
  if (side >= 0.0 && bx > 0.0 && bx < 1.0) {
    var k = (1.0 - bx) / 0.65;
    if (bx < 0.35) { k = bx / 0.35; }
    lip = floor(255.0 * s * k + 0.5);
  }
  return vec4f(r, g, 0.0, lip) / 255.0;
}
`;

const FRAGMENT_WGSL = /* wgsl */ `
struct U { atlas: vec2f, ts: f32, pad: f32 };
@group(0) @binding(0) var<uniform> u: U;
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) seg: vec4f,
  @location(1) @interpolate(flat) par: vec4f,
  @location(2) @interpolate(flat) org: vec4f,
};
@vertex fn vs(
  @builtin(vertex_index) vi: u32,
  @location(0) rect: vec4f, @location(1) seg: vec4f, @location(2) par: vec4f, @location(3) org: vec4f,
) -> VOut {
  let cx = f32(vi & 1u);
  let cy = f32(vi >> 1u);
  let p = vec2f(mix(rect.x, rect.z, cx), mix(rect.y, rect.w, cy));
  var o: VOut;
  o.pos = vec4f(p.x / u.atlas.x * 2.0 - 1.0, 1.0 - p.y / u.atlas.y * 2.0, 0.0, 1.0);
  o.seg = seg; o.par = par; o.org = org;
  return o;
}
${COVERAGE_WGSL}
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let t = floor(i.pos.xy) - i.org.xy;
  return strokeAt(t.x, t.y, i.seg, i.par, u.ts);
}
`;

const COMPUTE_WGSL = /* wgsl */ `
struct Tile { org: vec2u, first: u32, count: u32 };
struct Inst { rect: vec4f, seg: vec4f, par: vec4f, org: vec4f };
struct U { ts: f32, px: u32, scratchCols: u32, pad: u32 };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> tiles: array<Tile>;
@group(0) @binding(2) var<storage, read> insts: array<Inst>;
@group(0) @binding(3) var atlas: texture_2d<f32>;
@group(0) @binding(4) var scratch: texture_storage_2d<rgba8unorm, write>;
${COVERAGE_WGSL}
@compute @workgroup_size(8, 8, 1) fn cs(@builtin(global_invocation_id) id: vec3u) {
  let tile = tiles[id.z];
  let texel = vec2u(id.x, id.y);
  var v = textureLoad(atlas, vec2i(tile.org + texel), 0);
  let fx = f32(id.x);
  let fy = f32(id.y);
  for (var k = 0u; k < tile.count; k++) {
    let it = insts[tile.first + k];
    // Same texel rectangle as the fragment quad.
    let ax = f32(tile.org.x) + fx;
    let ay = f32(tile.org.y) + fy;
    if (ax < it.rect.x || ax >= it.rect.z || ay < it.rect.y || ay >= it.rect.w) { continue; }
    let d = strokeAt(fx, fy, it.seg, it.par, u.ts);
    // Quantise to bytes before the subtraction, as the blend unit does on an rgba8unorm target.
    let b = round(v * 255.0);
    let q = round(d * 255.0);
    v = vec4f(max(b.r - q.r, 0.0), max(b.g - q.g, 0.0), b.b, max(b.a, q.a)) / 255.0;
  }
  let so = vec2u((id.z % u.scratchCols) * u.px, (id.z / u.scratchCols) * u.px);
  textureStore(scratch, vec2i(so + texel), v);
}
`;

function quantile(sorted, p) {
  return sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function stats(list) {
  const s = Float64Array.from(list).sort();
  let sum = 0;
  for (const v of s) sum += v;
  return {
    n: s.length,
    mean: s.length ? sum / s.length : 0,
    p50: quantile(s, 0.5),
    p95: quantile(s, 0.95),
    p99: quantile(s, 0.99),
    max: s.length ? s[s.length - 1] : 0,
  };
}

export async function adapterInfo() {
  if (!navigator.gpu) return { webgpu: false };
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) return { webgpu: false, reason: "no adapter" };
  const i = adapter.info ?? {};
  return {
    webgpu: true,
    vendor: i.vendor ?? "",
    architecture: i.architecture ?? "",
    device: i.device ?? "",
    description: i.description ?? "",
    isFallbackAdapter: i.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null,
    timestampQuery: adapter.features.has("timestamp-query"),
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    userAgent: navigator.userAgent,
  };
}

/**
 * @param {string} base  URL of a recording directory
 * @param {{path: "fragment" | "compute", pace: "flat" | "raf", maxFrames?: number}} opt
 */
export async function runReplay(base, opt) {
  const meta = await (await fetch(`${base}/meta.json`)).json();
  const ev = new Float32Array(await (await fetch(`${base}/events.bin`)).arrayBuffer());
  const uploads = new Uint8Array(await (await fetch(`${base}/uploads.bin`)).arrayBuffer());
  const fin = new Uint8Array(await (await fetch(`${base}/final.bin`)).arrayBuffer());

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  const hasTs = adapter.features.has("timestamp-query");
  const device = await adapter.requestDevice({ requiredFeatures: hasTs ? ["timestamp-query"] : [] });
  const errors = [];
  device.addEventListener("uncapturederror", (e) => errors.push(String(e.error?.message ?? e).slice(0, 300)));

  const px = meta.px;
  const cols = 32;
  const rows = Math.ceil(meta.slots / cols);
  const W = cols * px;
  const H = rows * px;
  const ts = FRAME_EDGE_MM / px;
  const tileBytes = px * px * 4;
  const atlas = device.createTexture({
    size: [W, H],
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.COPY_DST,
  });
  const atlasView = atlas.createView();

  // ---- per-frame event index -------------------------------------------------------------------------------
  const nEv = ev.length / EV;
  const frames = Math.min(meta.frames, opt.maxFrames ?? meta.frames);
  const first = new Int32Array(frames + 1);
  {
    let e = 0;
    for (let f = 0; f < frames; f++) {
      first[f] = e;
      while (e < nEv && ev[e * EV] === f) e++;
    }
    first[frames] = e;
  }
  let maxInst = 1;
  for (let f = 0; f < frames; f++) maxInst = Math.max(maxInst, first[f + 1] - first[f]);

  const inst = new Float32Array(maxInst * INST_FLOATS);
  const instBuf = device.createBuffer({
    size: inst.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  // ---- fragment pipeline -----------------------------------------------------------------------------------
  const uni = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uni, 0, new Float32Array([W, H, ts, 0]));
  const fmod = device.createShaderModule({ code: FRAGMENT_WGSL });
  const fpipe = await device.createRenderPipelineAsync({
    layout: "auto",
    vertex: {
      module: fmod,
      entryPoint: "vs",
      buffers: [
        {
          arrayStride: INST_FLOATS * 4,
          stepMode: "instance",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x4" },
            { shaderLocation: 1, offset: 16, format: "float32x4" },
            { shaderLocation: 2, offset: 32, format: "float32x4" },
            { shaderLocation: 3, offset: 48, format: "float32x4" },
          ],
        },
      ],
    },
    fragment: {
      module: fmod,
      entryPoint: "fs",
      targets: [
        {
          format: "rgba8unorm",
          blend: {
            color: { operation: "reverse-subtract", srcFactor: "one", dstFactor: "one" },
            alpha: { operation: "max", srcFactor: "one", dstFactor: "one" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-strip" },
  });
  const fbind = device.createBindGroup({
    layout: fpipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uni } }],
  });

  // ---- compute pipeline ------------------------------------------------------------------------------------
  const SCR_COLS = 8;
  const SCR_TILES = 64;
  let cpipe = null;
  let cbind = null;
  let scratch = null;
  let tileBuf = null;
  const tileArr = new Uint32Array(SCR_TILES * 4);
  if (opt.path === "compute") {
    scratch = device.createTexture({
      size: [SCR_COLS * px, (SCR_TILES / SCR_COLS) * px],
      format: "rgba8unorm",
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    tileBuf = device.createBuffer({
      size: tileArr.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const cuni = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const cu = new ArrayBuffer(16);
    new Float32Array(cu, 0, 1)[0] = ts;
    new Uint32Array(cu, 4, 3).set([px, SCR_COLS, 0]);
    device.queue.writeBuffer(cuni, 0, cu);
    cpipe = await device.createComputePipelineAsync({
      layout: "auto",
      compute: { module: device.createShaderModule({ code: COMPUTE_WGSL }), entryPoint: "cs" },
    });
    cbind = device.createBindGroup({
      layout: cpipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: cuni } },
        { binding: 1, resource: { buffer: tileBuf } },
        { binding: 2, resource: { buffer: instBuf } },
        { binding: 3, resource: atlasView },
        { binding: 4, resource: scratch.createView() },
      ],
    });
  }

  // ---- timestamp queries -----------------------------------------------------------------------------------
  const QCHUNK = 512;
  let qset = null;
  let qresolve = null;
  let qread = null;
  if (hasTs) {
    qset = device.createQuerySet({ type: "timestamp", count: QCHUNK * 2 });
    qresolve = device.createBuffer({
      size: QCHUNK * 16,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    qread = device.createBuffer({ size: QCHUNK * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  }
  const gpuMs = [];
  let qN = 0;
  async function flushQueries() {
    if (!hasTs || qN === 0) return;
    const enc = device.createCommandEncoder();
    enc.resolveQuerySet(qset, 0, qN * 2, qresolve, 0);
    enc.copyBufferToBuffer(qresolve, 0, qread, 0, qN * 16);
    device.queue.submit([enc.finish()]);
    await qread.mapAsync(GPUMapMode.READ, 0, qN * 16);
    const t = new BigInt64Array(qread.getMappedRange(0, qN * 16).slice(0));
    qread.unmap();
    for (let i = 0; i < qN; i++) gpuMs.push(Number(t[i * 2 + 1] - t[i * 2]) / 1e6);
    qN = 0;
  }

  // ---- replay ----------------------------------------------------------------------------------------------
  const jsMs = [];
  const instPerPass = [];
  const tilesPerPass = [];
  let passes = 0;
  let uploadsDone = 0;
  let copies = 0;
  // compute scratch: touched slots of the frame
  const slotIdx = new Int32Array(meta.slots).fill(-1);
  const slotList = new Int32Array(SCR_TILES);
  const order = new Int32Array(maxInst);

  function frame(f) {
    const e0 = first[f];
    const e1 = first[f + 1];
    if (e0 === e1) return false;
    const j0 = performance.now();
    let n = 0;
    let nTiles = 0;
    for (let e = e0; e < e1; e++) {
      const o = e * EV;
      const kind = ev[o + 1];
      const slot = ev[o + 2];
      const ox = (slot % cols) * px;
      const oy = Math.floor(slot / cols) * px;
      if (kind === 2) {
        const idx = ev[o + 14];
        device.queue.writeTexture(
          { texture: atlas, origin: [ox, oy] },
          uploads,
          { offset: idx * tileBytes, bytesPerRow: px * 4, rowsPerImage: px },
          [px, px],
        );
        uploadsDone++;
        continue;
      }
      if (opt.path === "compute") {
        if (slotIdx[slot] < 0) {
          if (nTiles === SCR_TILES) throw new Error("compute scratch full");
          slotIdx[slot] = nTiles;
          slotList[nTiles++] = slot;
        }
        order[n] = e;
        n++;
        continue;
      }
      const i = n++ * INST_FLOATS;
      inst[i] = ox + ev[o + 10];
      inst[i + 1] = oy + ev[o + 11];
      inst[i + 2] = ox + ev[o + 12] + 1;
      inst[i + 3] = oy + ev[o + 13] + 1;
      inst[i + 4] = ev[o + 3];
      inst[i + 5] = ev[o + 4];
      inst[i + 6] = ev[o + 5];
      inst[i + 7] = ev[o + 6];
      const widthCm = ev[o + 7];
      const depth16 = ev[o + 8];
      const level = ev[o + 9];
      inst[i + 8] = widthCm * 5;
      inst[i + 9] = Math.max(150, 3 * widthCm);
      inst[i + 10] = kind === 1 ? 1 : depth16 >= 16 * level ? 1 : depth16 / (16 * level);
      inst[i + 11] = kind;
      inst[i + 12] = ox;
      inst[i + 13] = oy;
    }
    if (n === 0) {
      jsMs.push(performance.now() - j0);
      return true;
    }
    const enc = device.createCommandEncoder();
    const tsw = hasTs
      ? { querySet: qset, beginningOfPassWriteIndex: qN * 2, endOfPassWriteIndex: qN * 2 + 1 }
      : undefined;
    if (opt.path === "fragment") {
      device.queue.writeBuffer(instBuf, 0, inst, 0, n * INST_FLOATS);
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: atlasView, loadOp: "load", storeOp: "store" }],
        timestampWrites: tsw,
      });
      pass.setPipeline(fpipe);
      pass.setBindGroup(0, fbind);
      pass.setVertexBuffer(0, instBuf, 0, n * INST_FLOATS * 4);
      pass.draw(4, n);
      pass.end();
      tilesPerPass.push(0);
    } else {
      // Group the instances by tile (counting sort over the touched tiles).
      let w = 0;
      for (let ti = 0; ti < nTiles; ti++) {
        const slot = slotList[ti];
        const ox = (slot % cols) * px;
        const oy = Math.floor(slot / cols) * px;
        const start = w;
        for (let k = 0; k < n; k++) {
          const o = order[k] * EV;
          if (ev[o + 2] !== slot) continue;
          const kind = ev[o + 1];
          const i = w++ * INST_FLOATS;
          inst[i] = ox + ev[o + 10];
          inst[i + 1] = oy + ev[o + 11];
          inst[i + 2] = ox + ev[o + 12] + 1;
          inst[i + 3] = oy + ev[o + 13] + 1;
          inst[i + 4] = ev[o + 3];
          inst[i + 5] = ev[o + 4];
          inst[i + 6] = ev[o + 5];
          inst[i + 7] = ev[o + 6];
          const widthCm = ev[o + 7];
          const depth16 = ev[o + 8];
          const level = ev[o + 9];
          inst[i + 8] = widthCm * 5;
          inst[i + 9] = Math.max(150, 3 * widthCm);
          inst[i + 10] = kind === 1 ? 1 : depth16 >= 16 * level ? 1 : depth16 / (16 * level);
          inst[i + 11] = kind;
          inst[i + 12] = ox;
          inst[i + 13] = oy;
        }
        tileArr[ti * 4] = ox;
        tileArr[ti * 4 + 1] = oy;
        tileArr[ti * 4 + 2] = start;
        tileArr[ti * 4 + 3] = w - start;
        slotIdx[slot] = -1;
      }
      device.queue.writeBuffer(instBuf, 0, inst, 0, n * INST_FLOATS);
      device.queue.writeBuffer(tileBuf, 0, tileArr, 0, nTiles * 4);
      const pass = enc.beginComputePass({ timestampWrites: tsw });
      pass.setPipeline(cpipe);
      pass.setBindGroup(0, cbind);
      pass.dispatchWorkgroups(px / 8, px / 8, nTiles);
      pass.end();
      for (let ti = 0; ti < nTiles; ti++) {
        enc.copyTextureToTexture(
          { texture: scratch, origin: [(ti % SCR_COLS) * px, Math.floor(ti / SCR_COLS) * px] },
          { texture: atlas, origin: [tileArr[ti * 4], tileArr[ti * 4 + 1]] },
          [px, px],
        );
        copies++;
      }
      tilesPerPass.push(nTiles);
    }
    device.queue.submit([enc.finish()]);
    jsMs.push(performance.now() - j0);
    instPerPass.push(n);
    passes++;
    if (hasTs) qN++;
    return true;
  }

  const wall0 = performance.now();
  const rafDt = [];
  if (opt.pace === "raf") {
    let last = 0;
    for (let f = 0; f < frames; f++) {
      const now = await new Promise((r) => requestAnimationFrame(r));
      if (last > 0) rafDt.push(now - last);
      last = now;
      frame(f);
      if (qN === QCHUNK) await flushQueries();
    }
  } else {
    for (let f = 0; f < frames; f++) {
      frame(f);
      if (qN === QCHUNK) await flushQueries();
      // Keep the queue from growing without bound in the flat-out mode.
      else if ((f & 255) === 255) await device.queue.onSubmittedWorkDone();
    }
  }
  await flushQueries();
  await device.queue.onSubmittedWorkDone();
  const wallMs = performance.now() - wall0;

  // ---- readback and comparison -----------------------------------------------------------------------------
  let compare = null;
  if (frames === meta.frames && meta.noCompare !== true) {
    const rb = device.createBuffer({ size: W * H * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: atlas }, { buffer: rb, bytesPerRow: W * 4, rowsPerImage: H }, [W, H]);
    device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const got = new Uint8Array(rb.getMappedRange());
    const diffTexels = [0, 0, 0, 0];
    const maxDiff = [0, 0, 0, 0];
    const hist = new Array(6).fill(0);
    let texels = 0;
    let texelsAnyDiff = 0;
    let dusty = 0;
    meta.finalSlots.forEach((slot, si) => {
      const ox = (slot % cols) * px;
      const oy = Math.floor(slot / cols) * px;
      for (let y = 0; y < px; y++) {
        for (let x = 0; x < px; x++) {
          const a = ((oy + y) * W + ox + x) * 4;
          const b = si * tileBytes + (y * px + x) * 4;
          texels++;
          if (fin[b] < 255) dusty++;
          let any = 0;
          for (let c = 0; c < 4; c++) {
            const d = Math.abs(got[a + c] - fin[b + c]);
            if (d > 0) {
              diffTexels[c]++;
              any = Math.max(any, d);
              if (d > maxDiff[c]) maxDiff[c] = d;
            }
          }
          if (any > 0) {
            texelsAnyDiff++;
            hist[Math.min(5, any)]++;
          }
        }
      }
    });
    rb.unmap();
    compare = {
      tiles: meta.finalSlots.length,
      texels,
      texelsCleanedAtAll: dusty,
      texelsDiffering: texelsAnyDiff,
      pctDiffering: texels ? (100 * texelsAnyDiff) / texels : 0,
      diffTexelsRGBA: diffTexels,
      maxAbsDiffRGBA: maxDiff,
      histMaxDiff_1_2_3_4_5plus: hist.slice(1),
    };
  }
  const out = {
    label: meta.label,
    path: opt.path,
    pace: opt.pace,
    px,
    atlas: `${W}x${H}`,
    framesReplayed: frames,
    framesWithEvents: jsMs.length,
    passes,
    uploads: uploadsDone,
    copies,
    instancesPerPass: stats(instPerPass),
    tilesPerComputePass: opt.path === "compute" ? stats(tilesPerPass) : null,
    timestampQuery: hasTs,
    gpuPassMs: hasTs ? stats(gpuMs) : null,
    gpuPassMsPerFrameAllFrames: hasTs ? gpuMs.reduce((s, v) => s + v, 0) / frames : null,
    jsEncodeMs: stats(jsMs),
    jsEncodeMsPerFrameAllFrames: jsMs.reduce((s, v) => s + v, 0) / frames,
    wallMs,
    rafIntervalMs: rafDt.length ? stats(rafDt) : null,
    compare,
    errors,
    cpuRefMs: meta.cpuRefMs,
  };
  atlas.destroy();
  scratch?.destroy();
  device.destroy();
  return out;
}

globalThis.dustGpu = { adapterInfo, runReplay };
