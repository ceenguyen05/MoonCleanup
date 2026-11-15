// The CDLOD sphere terrain (WDS section 3.6, M1-W2-T01): one instanced draw of the shared patch for every selected
// node, height from the resident height cube through the TSL twin. `update(camera)` runs once per frame before the
// render: selection (pure, `select.ts`) -> two instance buffers -> uniforms. Nothing is allocated per frame.
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as TSL from "three/tsl";
import {
  BufferAttribute,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshLambertNodeMaterial,
  MeshStandardNodeMaterial,
  Vector3,
  type Camera,
  type DataArrayTexture,
  type NodeMaterial,
  type PerspectiveCamera,
} from "three/webgpu";
import type { HeightCube, HeightDetailParams, PadMask } from "@moon-cleanup/world";
import { SHADOW_FLAT_RECEIVER_KEY } from "../../visuals/lighting/cascade-shadow-node";
import { ALBEDO_GRIME, GRIME_TINT } from "../../visuals/materials/regolith-constants";
import { createHeightMipTextures, createHeightTexture, createHeightTwin } from "../height/height-twin";
import { HeightMinMax } from "./min-max";
import { buildPatchGrid, type PatchGrid } from "./patch-grid";
import { CdlodSelector, createCdlodView, sidePlanesFromViewProjection, type CdlodView } from "./select";
import { applyTerrainSurface, createTerrainSurface, DETAIL_FADES_M, type TerrainSurface } from "./terrain-surface";

const t = TSL as unknown as Record<string, (...args: any[]) => any>;
const { cameraViewMatrix, float, normalize, transformDirection, vec3 } = t as any;

/** The terrain rows of the quality preset (`shared/render/quality.ts`). */
export interface CdlodQuality {
  readonly cdlodLeafLevel: number;
  readonly cdlodPatchVerts: number;
  readonly cdlodRangeMult: number;
}

export interface CdlodTerrainOptions {
  readonly cube: HeightCube;
  readonly radiusM: number;
  readonly pads?: readonly PadMask[];
  readonly detail?: HeightDetailParams | null;
  readonly quality: CdlodQuality;
  /** Ground height above R at a moon-centred point (the JS ground function): places the LOD sphere under the camera. */
  readonly heightAt: (x: number, y: number, z: number) => number;
  /** World position of the moon centre (default: the origin, the game's world frame). */
  readonly center?: Vector3;
  /** Reuse a pyramid / texture built for the same cube (a preset change rebuilds the terrain, not these). */
  readonly minMax?: HeightMinMax;
  readonly heightTexture?: DataArrayTexture;
  /** Instance capacity (default 512). */
  readonly maxInstances?: number;
  /** Per-fragment far-field normals from the height cube (default on). */
  readonly farNormals?: boolean;
  /** Horizon-map term in the material (default on; inert until `surface.horizon.setTextures`). */
  readonly horizon?: boolean;
}

/**
 * Plain lit regolith-coloured surface: what the terrain wears until the production regolith (M1-W2-T04) takes the
 * hooks. Diffuse only: a standard material's specular lobe (roughness 0.95) is several times the diffuse term at
 * grazing view toward a low light, which regolith does not do.
 */
export function createPlainTerrainMaterial(surface: TerrainSurface): NodeMaterial {
  const material = new MeshLambertNodeMaterial();
  material.name = "mc:terrain-plain";
  material.userData[SHADOW_FLAT_RECEIVER_KEY] = true;
  material.colorNode = vec3(GRIME_TINT[0] * ALBEDO_GRIME, GRIME_TINT[1] * ALBEDO_GRIME, GRIME_TINT[2] * ALBEDO_GRIME);
  material.normalNode = normalize(transformDirection(surface.normalWorld, cameraViewMatrix));
  applyTerrainSurface(material, surface);
  return material;
}

/** The same surface on a standard material (roughness 0.95), for A/B captures of the specular term. */
export function createSpecularTerrainMaterial(surface: TerrainSurface): NodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.name = "mc:terrain-plain-specular";
  material.metalness = 0;
  material.userData[SHADOW_FLAT_RECEIVER_KEY] = true;
  material.colorNode = vec3(GRIME_TINT[0] * ALBEDO_GRIME, GRIME_TINT[1] * ALBEDO_GRIME, GRIME_TINT[2] * ALBEDO_GRIME);
  material.roughnessNode = float(0.95);
  material.normalNode = normalize(transformDirection(surface.normalWorld, cameraViewMatrix));
  applyTerrainSurface(material, surface);
  return material;
}

/** Farthest receiver of a cascade from the camera, as a multiple of its far end (corner of a 16:9, 60 degree frustum: 1.55). */
const RECEIVER_REACH = 1.7;
/**
 * Shadow passes draw the surface this much lower, metres. The casters are coarser than the lit surface and leave out
 * the small craters and the noise, so without it their back faces poke through lit ground near the terminator and
 * draw a comb of dark stripes (seen at a 14 degree sun; gone at 0.3 m).
 */
export const CASTER_DROP_M = 0.3;
/** Casters of a cascade nearer than this fraction of the previous cascade end may be coarser (covers the fade band). */
const CASCADE_LOD_FLOOR = 0.7;

/** Shadow casters of one cascade: its own selection and instance buffers on the shared patch. */
interface CascadeCasters {
  readonly selector: CdlodSelector;
  readonly view: CdlodView;
  readonly geometry: InstancedBufferGeometry;
  readonly nodeAttribute: InstancedBufferAttribute;
  readonly lodAttribute: InstancedBufferAttribute;
  readonly mesh: Mesh;
}

export class CdlodTerrain {
  readonly mesh: Mesh;
  readonly selector: CdlodSelector;
  readonly surface: TerrainSurface;
  readonly material: NodeMaterial;
  readonly minMax: HeightMinMax;
  readonly heightTexture: DataArrayTexture;
  /** Mip levels 1..3 of the height cube (far-field normal); empty when far normals are off. */
  readonly heightMips: DataArrayTexture[];
  readonly patch: PatchGrid;
  readonly view: CdlodView = createCdlodView();
  /** Diagnostic: the main mesh is not drawn (cost of the frame without the terrain). */
  hidden = false;
  /** Triangles of the last selection. */
  triangles = 0;

  private readonly geometry: InstancedBufferGeometry;
  private readonly nodeAttribute: InstancedBufferAttribute;
  private readonly lodAttribute: InstancedBufferAttribute;
  private readonly center: Vector3;
  private readonly heightAt: (x: number, y: number, z: number) => number;
  private readonly ownsShared: boolean;
  private readonly vp = new Float64Array(16);
  private readonly quality: CdlodQuality;
  private readonly radiusM: number;
  private readonly casters: CascadeCasters[] = [];
  /**
   * Caster patch: every second vertex of the main patch (grid indices 0, 2, 4, ...), which is the grid one level
   * coarser (WDS section 3.6). The same vertex stage morphs it, so casters of neighbouring nodes still meet. A coarser
   * caster is safe because the cascades hold back faces only.
   */
  private readonly casterPositions: BufferAttribute;
  private readonly casterIndex: BufferAttribute;
  /** Triangles of one caster patch. */
  readonly casterTriangles: number;
  private readonly pendingCasters: Mesh[] = [];
  /** Drop of the per-cascade casters, metres (`CASTER_DROP_M`; a diagnostic may change it). */
  casterDropM = CASTER_DROP_M;
  /** Diagnostic: detail floor of every cascade, metres (`null` = the rule in `updateShadowCascades`). */
  shadowDetailFloorM: number | null = null;
  /** Instances drawn by the shadow cascades in the last frame (sum over cascades). */
  shadowInstances = 0;
  /** `true` once a host drives per-cascade casters; until then the main mesh casts (every cascade draws all of it). */
  private cascadeCasting = false;

  constructor(options: CdlodTerrainOptions, material?: (surface: TerrainSurface) => NodeMaterial) {
    const { cube, quality } = options;
    this.center = options.center ?? new Vector3();
    this.quality = quality;
    this.radiusM = options.radiusM;
    this.heightAt = options.heightAt;
    this.ownsShared = options.minMax === undefined;
    this.minMax = options.minMax ?? new HeightMinMax(cube);
    this.heightTexture = options.heightTexture ?? createHeightTexture(cube);
    this.patch = buildPatchGrid(quality.cdlodPatchVerts - 1);
    this.selector = new CdlodSelector({
      radiusM: options.radiusM,
      leafLevel: quality.cdlodLeafLevel,
      rangeMult: quality.cdlodRangeMult,
      minMax: this.minMax,
      ...(options.maxInstances === undefined ? {} : { maxInstances: options.maxInstances }),
    });

    this.heightMips = options.farNormals === false ? [] : createHeightMipTextures(cube);
    const twin = createHeightTwin({
      cube,
      texture: this.heightTexture,
      mips: this.heightMips,
      radiusM: options.radiusM,
      ...(options.detail === undefined ? {} : { detail: options.detail }),
      ...(options.pads === undefined ? {} : { pads: options.pads }),
    });
    this.surface = createTerrainSurface({
      twin,
      radiusM: options.radiusM,
      patchQuads: this.patch.quads,
      fadeScale: quality.cdlodRangeMult,
      farNormals: options.farNormals !== false,
      horizon: options.horizon !== false,
    });
    this.surface.uniforms.rootRange.value = this.selector.ranges[0]!;
    this.material = (material ?? createPlainTerrainMaterial)(this.surface);

    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.patch.positions, 3));
    geometry.setIndex(new BufferAttribute(this.patch.indices, 1));
    this.nodeAttribute = new InstancedBufferAttribute(this.selector.nodeData, 4);
    this.lodAttribute = new InstancedBufferAttribute(this.selector.lodData, 4);
    this.nodeAttribute.setUsage(DynamicDrawUsage);
    this.lodAttribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute("aNode", this.nodeAttribute);
    geometry.setAttribute("aLod", this.lodAttribute);
    geometry.instanceCount = 0;
    this.geometry = geometry;

    const coarse = buildPatchGrid(this.patch.quads / 2);
    for (let k = 0; k < coarse.positions.length; k += 3) {
      coarse.positions[k] = coarse.positions[k]! * 2;
      coarse.positions[k + 1] = coarse.positions[k + 1]! * 2;
    }
    this.casterPositions = new BufferAttribute(coarse.positions, 3);
    this.casterIndex = new BufferAttribute(coarse.indices, 1);
    this.casterTriangles = coarse.triangles;

    const mesh = new Mesh(geometry, this.material);
    mesh.name = "mc:terrain";
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = false;
    this.mesh = mesh;
    this.view.frustumExemptM = 60;
  }

  /** Selects the nodes for `camera` and uploads them. Call once per frame before the render. */
  update(camera: PerspectiveCamera): void {
    camera.updateMatrixWorld();
    const world = camera.matrixWorld.elements;
    const center = this.center;
    const view = this.view;
    view.camX = world[12]! - center.x;
    view.camY = world[13]! - center.y;
    view.camZ = world[14]! - center.z;
    view.lodHeightM = this.heightAt(view.camX, view.camY, view.camZ);

    // View-projection in doubles (column-major): planes do not go through float32.
    const P = camera.projectionMatrix.elements;
    const V = camera.matrixWorldInverse.elements;
    const vp = this.vp;
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        vp[c * 4 + r] =
          P[r]! * V[c * 4]! + P[4 + r]! * V[c * 4 + 1]! + P[8 + r]! * V[c * 4 + 2]! + P[12 + r]! * V[c * 4 + 3]!;
      }
    }
    sidePlanesFromViewProjection(vp, center.x, center.y, center.z, view.planes);

    const count = this.selector.select(view);
    this.geometry.instanceCount = count;
    this.nodeAttribute.needsUpdate = true;
    this.lodAttribute.needsUpdate = true;
    this.triangles = count * this.patch.triangles;

    const mesh = this.mesh;
    if (this.pendingCasters.length > 0 && mesh.parent !== null) {
      for (const caster of this.pendingCasters.splice(0)) mesh.parent.add(caster);
    }
    if (!this.cascadeCasting) mesh.castShadow = true;
    mesh.visible = count > 0 && !this.hidden;
    mesh.position.set(world[12]!, world[13]!, world[14]!);
    const u = this.surface.uniforms;
    u.center.value.copy(center);
    u.lodCamera.value.set(view.camX, view.camY, view.camZ);
    u.lodRadius.value = this.selector.radiusM + view.lodHeightM;
    u.origin.value.set(center.x - world[12]!, center.y - world[13]!, center.z - world[14]!);
  }

  /**
   * Per-cascade shadow casters (WDS section 3.6). Call after `update` each frame with the shadow cameras of the
   * cascades (their matrices of the last render), far ends in metres and the layer of cascade 0: the camera of cascade
   * k must have layer `layerBase + k` enabled, which only that cascade renders. Each cascade draws only the nodes
   * inside its light-space box, selected with the main LOD function, so the cast surface is the lit surface where the
   * cascade is read. With no cameras the terrain casts nothing.
   */
  updateShadowCascades(cameras: readonly Camera[], endsM: readonly number[], layerBase: number): void {
    this.cascadeCasting = true;
    this.mesh.castShadow = false;
    this.surface.uniforms.casterDrop.value = this.casterDropM;
    this.surface.uniforms.casterRangeScale.value = 0.5;
    const main = this.view;
    const center = this.center;
    const vp = this.vp;
    let total = 0;
    for (let k = 0; k < cameras.length; k++) {
      const camera = cameras[k]!;
      const set = this.casters[k] ?? this.createCasters(k, layerBase);
      const view = set.view;
      view.camX = main.camX;
      view.camY = main.camY;
      view.camZ = main.camZ;
      view.lodHeightM = main.lodHeightM;
      const end = endsM[k] ?? endsM[endsM.length - 1] ?? 100;
      const previousEnd = k === 0 ? 0 : (endsM[k - 1] ?? 0);
      view.maxDistanceM = Infinity;
      view.lodFloorM = previousEnd * CASCADE_LOD_FLOOR;
      // The cascades hold back faces only, so what a caster leaves out cannot shade itself. Every cascade casts
      // without the 4 m crater band and the noise (rims of 2 to 8 cm); the larger bands stay in all of them, so a
      // crater's shadow does not change where one cascade hands over to the next.
      view.detailFloorM = this.shadowDetailFloorM ?? DETAIL_FADES_M.craters[0][1] * this.quality.cdlodRangeMult;
      // The box is from the last render: allow for a frame of camera travel.
      view.planeMarginM = 2 + 0.05 * end;
      const P = camera.projectionMatrix.elements;
      const V = camera.matrixWorldInverse.elements;
      for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
          vp[c * 4 + r] =
            P[r]! * V[c * 4]! + P[4 + r]! * V[c * 4 + 1]! + P[8 + r]! * V[c * 4 + 2]! + P[12 + r]! * V[c * 4 + 3]!;
        }
      }
      sidePlanesFromViewProjection(vp, center.x, center.y, center.z, view.planes);
      // Fifth plane: nothing farther from the light than every receiver of the cascade can shade one. Receivers have
      // a view depth up to `end`, so they lie within `end * RECEIVER_REACH` of the camera (frustum corners). The direction to the light is the +Z axis of the shadow camera.
      const W = camera.matrixWorld.elements;
      const lx = W[8]!;
      const ly = W[9]!;
      const lz = W[10]!;
      view.planes[16] = lx;
      view.planes[17] = ly;
      view.planes[18] = lz;
      view.planes[19] = end * RECEIVER_REACH - (lx * main.camX + ly * main.camY + lz * main.camZ);
      // Sixth plane: the near plane of the shadow camera. Nothing nearer the light can be drawn into the cascade, and
      // every cascade keeps casters up to there, so a far hill shades the near and the far ground alike.
      view.planes[20] = -lx;
      view.planes[21] = -ly;
      view.planes[22] = -lz;
      view.planes[23] = lx * (W[12]! - center.x) + ly * (W[13]! - center.y) + lz * (W[14]! - center.z);
      view.planeCount = 6;
      const count = set.selector.select(view);
      set.geometry.instanceCount = count;
      set.nodeAttribute.needsUpdate = true;
      set.lodAttribute.needsUpdate = true;
      set.mesh.visible = count > 0;
      set.mesh.position.copy(this.mesh.position);
      total += count;
    }
    for (let k = cameras.length; k < this.casters.length; k++) this.casters[k]!.mesh.visible = false;
    this.shadowInstances = total;
  }

  /** Instances of cascade `k` in the last frame. */
  cascadeInstances(k: number): number {
    const set = this.casters[k];
    return set === undefined || !set.mesh.visible ? 0 : set.selector.count;
  }

  private createCasters(k: number, layerBase: number): CascadeCasters {
    const selector = new CdlodSelector({
      radiusM: this.radiusM,
      leafLevel: this.quality.cdlodLeafLevel,
      rangeMult: this.quality.cdlodRangeMult,
      minMax: this.minMax,
      maxInstances: 256,
    });
    const view = createCdlodView();
    view.horizonCull = false;
    view.frustumCull = true;
    view.frustumExemptM = 0;
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute("position", this.casterPositions);
    geometry.setIndex(this.casterIndex);
    const nodeAttribute = new InstancedBufferAttribute(selector.nodeData, 4);
    const lodAttribute = new InstancedBufferAttribute(selector.lodData, 4);
    nodeAttribute.setUsage(DynamicDrawUsage);
    lodAttribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute("aNode", nodeAttribute);
    geometry.setAttribute("aLod", lodAttribute);
    geometry.instanceCount = 0;
    const mesh = new Mesh(geometry, this.material);
    mesh.name = "mc:terrain-caster-" + String(k);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.visible = false;
    // Only the shadow camera of cascade k has this layer: the main camera and the other cascades never draw the mesh.
    mesh.layers.set(layerBase + k);
    // Beside the terrain mesh (both sit at the camera); attached in `update` when the terrain has no parent yet.
    if (this.mesh.parent !== null) this.mesh.parent.add(mesh);
    else this.pendingCasters.push(mesh);
    const set: CascadeCasters = { selector, view, geometry, nodeAttribute, lodAttribute, mesh };
    this.casters[k] = set;
    return set;
  }

  dispose(): void {
    for (const set of this.casters) {
      set.mesh.removeFromParent();
      set.geometry.dispose();
    }
    this.casters.length = 0;
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.surface.horizon?.dispose();
    for (const mip of this.heightMips) mip.dispose();
    if (this.ownsShared) this.heightTexture.dispose();
  }
}
