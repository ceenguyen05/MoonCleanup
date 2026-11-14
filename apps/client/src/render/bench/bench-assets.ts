// Stand-in content of the bench (M0-W2-T02): rocks, avatar proxies, ~40 outpost props, sky bodies. Geometry and
// materials are plain three / TSL node materials; every object has one owner (`BenchContent`) and one `dispose()`.
// Stand-ins, not art: technical-artist's assets replace them (swap point listed in the report).

import { cos, mix, normalLocal, positionLocal, sin, smoothstep, step, vec3, vec4 } from "three/tsl";
import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Object3D,
} from "three/webgpu";
import { BatchedPool, InstancedSet, drawsNeeded, splitInstanceCounts } from "../instancing";
import { groundY, mulberry32 } from "./terrain-data";

export const ROCK_COUNT = 2100;
export const ROCK_TYPES = 4;
export const AVATAR_COUNT = 16;
const AVATAR_PARTS = 3;

function standard(
  name: string,
  r: number,
  g: number,
  b: number,
  roughness: number,
  metalness = 0,
): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial();
  m.name = name;
  m.color = new Color(r, g, b);
  m.roughness = roughness;
  m.metalness = metalness;
  return m;
}

/** Faceted rock: an icosphere with seeded radial noise, flat normals. */
function rockGeometry(seed: number): BufferGeometry {
  const rand = mulberry32(seed);
  const g = new IcosahedronGeometry(1, 1);
  const pos = g.getAttribute("position");
  const phase = [rand() * 6, rand() * 6, rand() * 6];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n =
      0.78 +
      0.22 * Math.sin(x * 2.3 + (phase[0] ?? 0)) * Math.cos(y * 2.1 + (phase[1] ?? 0)) +
      0.12 * Math.sin(z * 4.1 + (phase[2] ?? 0));
    pos.setXYZ(i, x * n, y * n * 0.72, z * n);
  }
  g.computeVertexNormals();
  return g;
}

export interface BenchContentCounts {
  readonly rockInstances: number;
  readonly rockDraws: number;
  readonly avatarInstances: number;
  readonly props: number;
  readonly skyDraws: number;
}

export class BenchContent {
  readonly rocks: InstancedSet[] = [];
  readonly avatars: BatchedPool;
  readonly props: Mesh[] = [];
  readonly propsGroup = new Group();
  readonly skyGroup = new Group();
  readonly counts: BenchContentCounts;
  /** Materials shared by the props, also used by the draw-filler pool. */
  readonly panelMaterial: MeshStandardNodeMaterial;

  private readonly disposables: { dispose(): void }[] = [];
  private readonly avatarBase: { x: number; z: number; phase: number; radius: number }[] = [];
  private readonly avatarIds: number[] = [];
  private readonly mat = new Matrix4();
  private readonly pos = new Vector3();
  private readonly scl = new Vector3();
  private readonly quat = new Quaternion();
  private readonly euler = new Euler();
  private readonly yAxisQuat = new Quaternion();
  private readonly white = new Color();

  constructor() {
    this.propsGroup.name = "mc:bench-outpost";
    this.skyGroup.name = "mc:bench-sky";

    // ---- Rocks: 2,100 instances over 4 meshes (4 draws) ---------------------------------------------------------
    const rockMaterial = standard("mc:bench-rock", 0.33, 0.325, 0.32, 0.95);
    this.disposables.push(rockMaterial);
    const per = splitInstanceCounts(ROCK_COUNT, ROCK_TYPES);
    const rand = mulberry32(2026);
    for (let type = 0; type < ROCK_TYPES; type++) {
      const geometry = rockGeometry(100 + type);
      this.disposables.push(geometry);
      const count = per[type] ?? 0;
      const set = new InstancedSet(
        {
          name: `mc:bench-rocks-${String(type)}`,
          geometry,
          material: rockMaterial,
          count,
          castShadow: true,
          receiveShadow: true,
        },
        false,
      );
      for (let i = 0; i < count; i++) {
        // Denser near the worksite: radius ~ 12 + 120 * u^1.6, away from the levelled pad.
        const r = 12 + 120 * Math.pow(rand(), 1.6);
        const a = rand() * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const size = rand() < 0.04 ? 1.4 + rand() * 1.6 : 0.12 + Math.pow(rand(), 2.2) * 0.9;
        this.pos.set(x, groundY(x, z) + size * 0.18, z);
        this.euler.set(rand() * 0.8, rand() * Math.PI * 2, rand() * 0.8);
        this.quat.setFromEuler(this.euler);
        this.scl.set(size * (0.8 + rand() * 0.5), size * (0.7 + rand() * 0.5), size * (0.8 + rand() * 0.5));
        this.mat.compose(this.pos, this.quat, this.scl);
        set.setMatrixAt(i, this.mat);
      }
      set.commit();
      set.computeBounds();
      this.rocks.push(set);
    }

    // ---- Avatar proxies: 16 x (body, helmet, pack) in one BatchedMesh (1 draw) -----------------------------------
    const suit = standard("mc:bench-avatar", 1, 1, 1, 0.55);
    const body = new CapsuleGeometry(0.27, 0.62, 4, 12);
    body.translate(0, 0.85, 0);
    const helmet = new SphereGeometry(0.27, 16, 12);
    helmet.translate(0, 1.58, 0);
    const pack = new BoxGeometry(0.42, 0.56, 0.24);
    pack.translate(0, 1.0, -0.3);
    this.avatars = new BatchedPool({
      name: "mc:bench-avatars",
      material: suit,
      maxInstances: AVATAR_COUNT * AVATAR_PARTS,
      geometries: [body, helmet, pack],
      castShadow: true,
      receiveShadow: true,
    });
    const colors = [new Color(0.9, 0.92, 0.94), new Color(0.78, 0.84, 0.9), new Color(1.0, 0.36, 0.08)];
    const avatarRand = mulberry32(77);
    for (let i = 0; i < AVATAR_COUNT; i++) {
      const ring = 5 + (i % 4) * 2.4;
      const angle = (i / AVATAR_COUNT) * Math.PI * 2 + avatarRand() * 0.3;
      this.avatarBase.push({
        x: Math.cos(angle) * ring,
        z: Math.sin(angle) * ring,
        phase: avatarRand() * 6,
        radius: 1.2 + avatarRand(),
      });
      this.mat.identity();
      for (let part = 0; part < AVATAR_PARTS; part++) {
        const id = this.avatars.addInstance(part, this.mat, colors[part] ?? this.white);
        this.avatarIds.push(id);
      }
    }
    this.placeAvatars(0, false);
    this.avatars.computeBounds();

    // ---- Outpost props: 40 separate meshes (the budget's "nearest outpost" row) ---------------------------------
    this.panelMaterial = standard("mc:bench-panel", 0.8, 0.82, 0.84, 0.5);
    const accent = standard("mc:bench-accent", 1.0, 0.32, 0.06, 0.45);
    const metal = standard("mc:bench-metal", 0.16, 0.17, 0.19, 0.4, 0.7);
    const glass = standard("mc:bench-solar", 0.05, 0.1, 0.22, 0.25, 0.3);
    this.disposables.push(this.panelMaterial, accent, metal, glass);
    this.buildProps({ panel: this.panelMaterial, accent, metal, glass });

    // ---- Sky: sun disk and Earth (unlit stand-ins, 2 draws) ----------------------------------------------------
    this.buildSky();

    this.counts = {
      rockInstances: ROCK_COUNT,
      rockDraws: drawsNeeded(ROCK_COUNT, Math.ceil(ROCK_COUNT / ROCK_TYPES)),
      avatarInstances: AVATAR_COUNT * AVATAR_PARTS,
      props: this.props.length,
      skyDraws: this.skyGroup.children.length,
    };
  }

  private addProp(
    geometry: BufferGeometry,
    material: MeshStandardNodeMaterial,
    x: number,
    z: number,
    lift: number,
    parent: Group = this.propsGroup,
  ): Mesh {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, groundY(x, z) + lift, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    parent.add(mesh);
    this.props.push(mesh);
    return mesh;
  }

  private buildProps(m: {
    panel: MeshStandardNodeMaterial;
    accent: MeshStandardNodeMaterial;
    metal: MeshStandardNodeMaterial;
    glass: MeshStandardNodeMaterial;
  }): void {
    const hab = new CylinderGeometry(1.6, 1.6, 4.4, 20);
    hab.rotateZ(Math.PI / 2);
    const stripe = new CylinderGeometry(1.63, 1.63, 0.5, 20);
    stripe.rotateZ(Math.PI / 2);
    const tank = new CylinderGeometry(0.9, 0.9, 2.0, 16);
    const pole = new CylinderGeometry(0.07, 0.09, 4.2, 8);
    const lamp = new BoxGeometry(0.5, 0.18, 0.32);
    const crate = new BoxGeometry(0.9, 0.7, 0.9);
    const smallCrate = new BoxGeometry(0.55, 0.45, 0.55);
    const solar = new BoxGeometry(2.6, 0.06, 1.5);
    const solarPost = new CylinderGeometry(0.06, 0.06, 0.8, 6);
    const pad = new TorusGeometry(5.5, 0.18, 6, 40);
    pad.rotateX(Math.PI / 2);
    const dish = new ConeGeometry(0.9, 0.5, 16, 1, true);
    const mast = new CylinderGeometry(0.05, 0.05, 3.0, 6);
    const door = new BoxGeometry(0.1, 1.5, 1.0);
    this.disposables.push(hab, stripe, tank, pole, lamp, crate, smallCrate, solar, solarPost, pad, dish, mast, door);

    // 3 habitat modules in a row with orange bands and doors (9).
    for (let i = 0; i < 3; i++) {
      const x = -5.2 + i * 5.2;
      this.addProp(hab, m.panel, x, 6.5, 1.6);
      this.addProp(stripe, m.accent, x - 1.1, 6.5, 1.6);
      this.addProp(door, m.metal, x + 2.2, 6.5, 0.8);
    }
    // 4 fuel tanks (4) and 4 crates (4) beside the modules.
    for (let i = 0; i < 4; i++)
      this.addProp(tank, i % 2 === 0 ? m.panel : m.accent, 7 + (i % 2) * 2.1, 2 + Math.floor(i / 2) * 2.1, 1.0);
    for (let i = 0; i < 4; i++)
      this.addProp(crate, i % 2 === 0 ? m.accent : m.metal, -7 - (i % 2) * 1.1, 1.2 + Math.floor(i / 2) * 1.1, 0.35);
    // 4 light poles with heads (8).
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const x = Math.cos(a) * 9.5;
      const z = Math.sin(a) * 9.5;
      this.addProp(pole, m.metal, x, z, 2.1);
      this.addProp(lamp, m.panel, x, z, 4.25);
    }
    // 4 solar tables: panel + post (8).
    for (let i = 0; i < 4; i++) {
      const x = -9 + i * 3.2;
      const solarMesh = this.addProp(solar, m.glass, x, -5.5, 0.95);
      solarMesh.rotation.x = -0.45;
      solarMesh.updateMatrix();
      this.addProp(solarPost, m.metal, x, -5.5, 0.4);
    }
    // Landing pad ring, comms mast and dish, 4 small crates, 1 more crate (3 + 4... fill to about 40).
    this.addProp(pad, m.accent, 0, -1.5, 0.2);
    this.addProp(mast, m.metal, 10.5, -3, 1.5);
    const d = this.addProp(dish, m.panel, 10.5, -3, 3.2);
    d.rotation.x = 0.7;
    d.updateMatrix();
    for (let i = 0; i < 4; i++) this.addProp(smallCrate, m.panel, 3 + i * 0.7, -7.5 + (i % 2) * 0.6, 0.23);
  }

  private buildSky(): void {
    // Sun disk: scene-linear values far above the bloom threshold, so it glows.
    const sunMaterial = new MeshBasicNodeMaterial();
    sunMaterial.name = "mc:bench-sun-disk";
    sunMaterial.colorNode = vec4(vec3(80, 74, 64), 1);
    sunMaterial.fog = false;
    const sunGeometry = new SphereGeometry(1, 20, 12);
    const sun = new Mesh(sunGeometry, sunMaterial);
    sun.name = "mc:bench-sun";
    sun.frustumCulled = false;
    this.skyGroup.add(sun);

    // Earth: unlit marble from the local normal (ocean, land, cloud bands), already display-relative.
    const earthMaterial = new MeshBasicNodeMaterial();
    earthMaterial.name = "mc:bench-earth";
    const n = normalLocal;
    const bands = sin(positionLocal.y.mul(5.0).add(n.x.mul(2.2)))
      .mul(0.5)
      .add(0.5);
    const land = step(
      0.62,
      sin(n.z.mul(3.1).add(n.x.mul(2.7)))
        .mul(cos(n.y.mul(2.3)))
        .mul(0.5)
        .add(0.5),
    );
    const ocean = vec3(0.04, 0.16, 0.5);
    const ground = vec3(0.22, 0.34, 0.14);
    const surface = mix(ocean, ground, land);
    const clouds = smoothstep(0.55, 0.85, bands);
    earthMaterial.colorNode = vec4(mix(surface, vec3(0.95, 0.96, 1.0), clouds.mul(0.8)).mul(0.9), 1);
    const earthGeometry = new SphereGeometry(1, 40, 24);
    const earth = new Mesh(earthGeometry, earthMaterial);
    earth.name = "mc:bench-earth";
    earth.frustumCulled = false;
    this.skyGroup.add(earth);
    this.disposables.push(sunMaterial, sunGeometry, earthMaterial, earthGeometry);
  }

  /** Places the sun disk and Earth on the sky dome (20 km away, camera far is 30 km). */
  placeSky(sunDirection: Vector3, earthDirection: Vector3, cameraPosition: Vector3): void {
    const [sun, earth] = this.skyGroup.children;
    const distance = 20_000;
    if (sun !== undefined) {
      sun.position.copy(sunDirection).multiplyScalar(distance).add(cameraPosition);
      sun.scale.setScalar(distance * Math.tan((0.53 * Math.PI) / 360));
    }
    if (earth !== undefined) {
      earth.position.copy(earthDirection).multiplyScalar(distance).add(cameraPosition);
      earth.scale.setScalar(distance * Math.tan((3.8 * Math.PI) / 360));
      earth.rotation.y = 1.1;
    }
  }

  /** Avatar proxies walk small circles. No allocation: scratch vectors and one matrix are reused. */
  placeAvatars(time: number, animate: boolean): void {
    for (let i = 0; i < AVATAR_COUNT; i++) {
      const base = this.avatarBase[i];
      if (base === undefined) continue;
      const a = animate ? base.phase + time * (0.35 + (i % 3) * 0.08) : base.phase;
      const x = base.x + Math.cos(a) * base.radius;
      const z = base.z + Math.sin(a) * base.radius;
      this.pos.set(x, groundY(x, z), z);
      this.yAxisQuat.setFromAxisAngle(_up, -a + Math.PI / 2);
      this.scl.set(1, 1, 1);
      this.mat.compose(this.pos, this.yAxisQuat, this.scl);
      for (let part = 0; part < AVATAR_PARTS; part++) {
        const id = this.avatarIds[i * AVATAR_PARTS + part];
        if (id !== undefined) this.avatars.setMatrixAt(id, this.mat);
      }
    }
  }

  addTo(world: Object3D, sky: Object3D): void {
    for (const set of this.rocks) set.addTo(world);
    this.avatars.addTo(world);
    world.add(this.propsGroup);
    sky.add(this.skyGroup);
  }

  dispose(): void {
    for (const set of this.rocks) set.dispose();
    this.rocks.length = 0;
    this.avatars.dispose();
    this.propsGroup.removeFromParent();
    this.skyGroup.removeFromParent();
    this.props.length = 0;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

const _up = new Vector3(0, 1, 0);
