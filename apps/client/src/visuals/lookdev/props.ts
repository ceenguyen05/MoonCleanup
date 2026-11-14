// Look-dev stand-in props: chunky rounded primitives with the Brightside palette (ivory paint, safety orange, dark glass, warm
// lamps) so light, shadow and post can be judged on game-like shapes. Placeholders, not the asset family: they are replaced by
// the glTF pipeline (M0-W3-T03b: rounder, chunkier silhouettes, panel lines, soft contact-AO blobs on every foot). One owner
// (`LookProps`), shared materials, one dispose().

import {
  Fn,
  abs,
  atan,
  float,
  fract,
  mix,
  mx_fractal_noise_float,
  positionLocal,
  positionWorld,
  smoothstep,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Object3D,
} from "three/webgpu";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mulberry32 } from "../sky/star-catalog";

function paint(name: string, rgb: readonly [number, number, number], roughness: number): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial();
  m.name = name;
  m.color = new Color(rgb[0], rgb[1], rgb[2]);
  m.roughness = roughness;
  m.metalness = 0;
  return m;
}

/** Height of a rock's flat base in its unit geometry (below the centre). */
export const ROCK_BASE_Y = -0.21;
/** How far the base is buried, as a fraction of the rock's vertical scale: the ground cuts the side faces, not the base. */
export const ROCK_SINK = 0.03;

/** Centre height above the ground for a rock of vertical scale `scaleY` so its base sits `ROCK_SINK` under the surface. */
export function rockRestY(scaleY: number): number {
  return scaleY * (-ROCK_BASE_Y - ROCK_SINK);
}

/**
 * Faceted rock: an icosphere with seeded radial noise, flat normals (chunky, readable) and a FLAT base at `ROCK_BASE_Y`.
 * (Until M0 look-polish r2 the base vertices kept their own noise, so the underside was uneven and, with the old lift, up to
 * 12 % of the rock's size above the ground: a grazing sun shone under the rock and its shadow started detached.)
 */
export function rockGeometry(seed: number): BufferGeometry {
  const rand = mulberry32(seed);
  const g = new IcosahedronGeometry(1, 1);
  const pos = g.getAttribute("position");
  const phase = [rand() * 6, rand() * 6, rand() * 6];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n =
      0.8 +
      0.2 * Math.sin(x * 2.3 + (phase[0] ?? 0)) * Math.cos(y * 2.1 + (phase[1] ?? 0)) +
      0.1 * Math.sin(z * 4.1 + (phase[2] ?? 0));
    pos.setXYZ(i, x * n, y <= -0.35 ? ROCK_BASE_Y : y * n * 0.75, z * n);
  }
  const flat = g.toNonIndexed();
  g.dispose();
  flat.computeVertexNormals();
  return flat;
}

type Vec3Tuple = readonly [number, number, number];

export class LookProps {
  readonly ivory = paint("mc:look-ivory", [0.7, 0.69, 0.66], 0.6);
  readonly orange = paint("mc:look-orange", [0.7, 0.22, 0.03], 0.42);
  readonly graphite = paint("mc:look-graphite", [0.07, 0.075, 0.085], 0.5);
  readonly visor = paint("mc:look-visor", [0.02, 0.028, 0.05], 0.1);
  readonly panelBlue = new MeshStandardNodeMaterial();
  readonly rock = new MeshStandardNodeMaterial();
  readonly window = new MeshStandardNodeMaterial();
  readonly eye = new MeshStandardNodeMaterial();
  /** Ivory hab shell with panel seams (meridians and a latitude ring) so the dome reads as plates, not a blob. */
  readonly shell = new MeshStandardNodeMaterial();
  readonly concrete = new MeshStandardNodeMaterial();
  readonly hazard = new MeshStandardNodeMaterial();
  /** Soft black contact-AO blob (alpha-blended, no depth write); works on every preset, no post needed. */
  readonly contact = new MeshBasicNodeMaterial();

  private readonly disposables: { dispose(): void }[] = [];
  private readonly shared = new Map<string, BufferGeometry>();
  private readonly m4 = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly up = new Vector3(0, 1, 0);

  constructor() {
    this.rock.name = "mc:look-rock";
    this.rock.roughness = 0.94;
    this.rock.metalness = 0;
    this.rock.colorNode = Fn(() => {
      const n = mx_fractal_noise_float(positionWorld.mul(0.9), 3, 2.0, 0.5, 1.0);
      const warm = vec3(0.3, 0.27, 0.235);
      const cool = vec3(0.2, 0.2, 0.21);
      const base = mix(cool, warm, n.mul(0.5).add(0.5));
      return base.mul(float(1).add(n.mul(0.12)));
    })();

    this.window.name = "mc:look-window";
    this.window.color = new Color(0.02, 0.02, 0.02);
    this.window.emissive = new Color(2.6, 1.9, 1.0);
    this.window.roughness = 0.5;

    this.eye.name = "mc:look-eye";
    this.eye.color = new Color(0.01, 0.02, 0.02);
    this.eye.emissive = new Color(0.25, 2.4, 2.8);
    this.eye.roughness = 0.4;

    this.shell.name = "mc:look-shell";
    this.shell.metalness = 0;
    this.shell.roughness = 0.58;
    this.shell.colorNode = Fn(() => {
      const base = vec3(0.72, 0.71, 0.68);
      const a = atan(positionLocal.z, positionLocal.x)
        .div(Math.PI * 2)
        .mul(18);
      const seamA = float(1).sub(smoothstep(0.0, 0.035, abs(fract(a.add(0.5)).sub(0.5))));
      const seamL = float(1).sub(smoothstep(0.0, 0.03, abs(fract(positionLocal.y.mul(0.55)).sub(0.5))));
      const seam = seamA.max(seamL).mul(0.22);
      return vec4(base.mul(float(1).sub(seam)), 1);
    })();

    this.panelBlue.name = "mc:look-solar";
    this.panelBlue.metalness = 0;
    this.panelBlue.roughness = 0.24;
    this.panelBlue.colorNode = Fn(() => {
      const cells = uv().mul(vec2(10, 6));
      const cellX = smoothstep(0.44, 0.5, abs(fract(cells.x).sub(0.5)));
      const cellY = smoothstep(0.43, 0.5, abs(fract(cells.y).sub(0.5)));
      const seam = cellX.max(cellY);
      return vec4(mix(vec3(0.022, 0.06, 0.18), vec3(0.32, 0.36, 0.42), seam.mul(0.6)), 1);
    })();

    this.concrete.name = "mc:look-concrete";
    this.concrete.metalness = 0;
    this.concrete.roughness = 0.9;
    this.concrete.colorNode = Fn(() => {
      const n = mx_fractal_noise_float(positionWorld.mul(1.4), 3, 2.0, 0.5, 1.0);
      return vec4(vec3(0.42, 0.415, 0.41).mul(float(1).add(n.mul(0.12))), 1);
    })();

    this.hazard.name = "mc:look-hazard";
    this.hazard.metalness = 0;
    this.hazard.roughness = 0.7;
    this.hazard.colorNode = Fn(() => {
      const stripes = smoothstep(0.45, 0.55, fract(positionWorld.x.add(positionWorld.z).mul(1.6)));
      return vec4(mix(vec3(0.72, 0.5, 0.02), vec3(0.05, 0.05, 0.055), stripes), 1);
    })();

    this.contact.name = "mc:look-contact-ao";
    this.contact.transparent = true;
    this.contact.depthWrite = false;
    this.contact.polygonOffset = true;
    this.contact.polygonOffsetFactor = -2;
    this.contact.polygonOffsetUnits = -2;
    this.contact.fog = false;
    this.contact.colorNode = Fn(() => {
      const r = uv().sub(0.5).length().mul(2);
      const fall = float(1).sub(smoothstep(0.0, 1.0, r));
      return vec4(0, 0, 0, fall.mul(fall).mul(0.62));
    })();

    this.disposables.push(
      this.ivory,
      this.orange,
      this.graphite,
      this.visor,
      this.panelBlue,
      this.rock,
      this.window,
      this.eye,
      this.shell,
      this.concrete,
      this.hazard,
      this.contact,
    );
  }

  private mesh(geometry: BufferGeometry, material: MeshStandardNodeMaterial, shadows = true): Mesh {
    this.disposables.push(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    return mesh;
  }

  private rounded(w: number, h: number, d: number, r: number, material: MeshStandardNodeMaterial): Mesh {
    return this.mesh(new RoundedBoxGeometry(w, h, d, 3, r), material);
  }

  private at<T extends Object3D>(object: T, x: number, y: number, z: number): T {
    object.position.set(x, y, z);
    return object;
  }

  /** A cylinder of radius `r` spanning point `a` to point `b` (any orientation). */
  private bar(a: Vec3Tuple, b: Vec3Tuple, r: number, material: MeshStandardNodeMaterial): Mesh {
    const from = new Vector3(...a);
    const to = new Vector3(...b);
    const dir = to.clone().sub(from);
    const length = dir.length();
    const m = this.mesh(new CylinderGeometry(r, r, length, 10), material);
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(this.up, dir.normalize());
    return m;
  }

  /** A soft contact-AO blob lying on the ground, `radiusX` x `radiusZ` metres, at local height `y`. */
  blob(radiusX: number, radiusZ = radiusX, y = 0.014, strength = 1): Mesh {
    let geometry = this.shared.get("blob");
    if (geometry === undefined) {
      geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      this.shared.set("blob", geometry);
      this.disposables.push(geometry);
    }
    const m = new Mesh(geometry, this.contact);
    m.name = "mc:look-contact";
    m.position.y = y;
    m.scale.set(radiusX * 2, strength, radiusZ * 2);
    m.castShadow = false;
    m.receiveShadow = false;
    m.renderOrder = 2;
    return m;
  }

  /** 1 m test post (10 cm square), foot at y = 0. */
  post(heightM = 1): Mesh {
    const m = this.mesh(new BoxGeometry(0.1, heightM, 0.1), this.ivory);
    m.name = "mc:look-post";
    m.position.y = heightM / 2;
    return m;
  }

  /** A 0.5 m boulder seated in the ground at y = 0 (flat base slightly buried). */
  boulder(radiusM = 0.5, seed = 7): Mesh {
    const m = this.mesh(rockGeometry(seed), this.rock);
    m.name = "mc:look-boulder";
    m.scale.setScalar(radiusM);
    m.position.y = rockRestY(radiusM);
    return m;
  }

  /**
   * Chibi custodian proxy (big helmet, stubby limbs, orange pack, a brush in hand), boot soles on y = 0, facing +z.
   * Total height 1.5 m (a toy-proportion astronaut: head is a third of the height).
   */
  custodian(): Group {
    const g = new Group();
    g.name = "mc:look-custodian";
    const add = (...objects: Object3D[]): void => {
      g.add(...objects);
    };
    for (const side of [-1, 1]) {
      add(this.at(this.rounded(0.2, 0.15, 0.36, 0.06, this.graphite), side * 0.12, 0.075, 0.05));
      add(this.at(this.mesh(new CapsuleGeometry(0.085, 0.2, 4, 10), this.ivory), side * 0.12, 0.3, 0));
      const arm = this.mesh(new CapsuleGeometry(0.065, 0.2, 4, 10), this.ivory);
      arm.position.set(side * 0.31, 0.78, 0.02);
      arm.rotation.z = side * 0.35;
      add(arm);
      add(this.at(this.mesh(new SphereGeometry(0.085, 14, 10), this.orange), side * 0.36, 0.62, 0.04));
    }
    add(this.at(this.mesh(new CapsuleGeometry(0.23, 0.2, 6, 16), this.ivory), 0, 0.72, 0));
    const belt = this.mesh(new CylinderGeometry(0.245, 0.245, 0.07, 18), this.orange);
    add(this.at(belt, 0, 0.52, 0));
    add(this.at(this.rounded(0.16, 0.12, 0.05, 0.02, this.orange), 0, 0.82, 0.225));
    add(this.at(this.mesh(new SphereGeometry(0.018, 8, 6), this.eye), 0.04, 0.83, 0.255));
    // Pack with twin tanks.
    add(this.at(this.rounded(0.42, 0.52, 0.22, 0.07, this.orange), 0, 0.78, -0.27));
    for (const side of [-1, 1]) {
      add(this.at(this.mesh(new CapsuleGeometry(0.055, 0.34, 4, 10), this.ivory), side * 0.14, 0.78, -0.43));
    }
    // Helmet, visor and glowing eyes.
    const helmet = this.mesh(new SphereGeometry(0.3, 28, 20), this.ivory);
    add(this.at(helmet, 0, 1.2, 0));
    const visor = this.mesh(new SphereGeometry(0.235, 24, 16), this.visor);
    visor.scale.set(1.05, 0.82, 0.7);
    add(this.at(visor, 0, 1.2, 0.14));
    for (const side of [-1, 1]) {
      const eye = this.rounded(0.065, 0.1, 0.03, 0.014, this.eye);
      eye.castShadow = false;
      add(this.at(eye, side * 0.085, 1.21, 0.298));
    }
    add(this.at(this.mesh(new CylinderGeometry(0.06, 0.06, 0.1, 10), this.orange), 0, 1.5, 0));
    // The brush: a long handle from the right hand down to a wide orange head resting on the ground.
    add(this.bar([0.36, 0.64, 0.05], [0.3, 0.04, 0.74], 0.022, this.graphite));
    add(this.at(this.rounded(0.46, 0.07, 0.16, 0.025, this.orange), 0.3, 0.035, 0.76));
    g.add(this.blob(0.34, 0.4, 0.014, 1));
    g.add(this.at(this.blob(0.3, 0.2, 0.014, 0.8), 0.3, 0.014, 0.76));
    return g;
  }

  /** Chunky outpost: drum + dome hab with seams and an orange band, annex module, solar array, dish, flood mast, tanks, crates. */
  outpost(): Group {
    const g = new Group();
    g.name = "mc:look-outpost";

    // Concrete landing apron with a hazard-striped rim (the always-clean outpost ground of art-direction 3.2).
    const pad = this.mesh(new CylinderGeometry(7.4, 7.6, 0.4, 56), this.concrete);
    pad.castShadow = false;
    g.add(this.at(pad, 0, -0.12, 0));
    const rim = this.mesh(new TorusGeometry(7.5, 0.1, 6, 72), this.hazard);
    rim.rotation.x = Math.PI / 2;
    g.add(this.at(rim, 0, 0.1, 0));

    // Hab: drum, shallow dome with seams, orange band, door canopy, windows, roof beacon. Turned so the door faces -z (the
    // look-dev cameras approach from -z).
    const hab = new Group();
    hab.name = "mc:look-hab";
    hab.rotation.y = Math.PI;
    const drum = this.mesh(new CylinderGeometry(3.3, 3.4, 2.2, 40, 4), this.shell);
    hab.add(this.at(drum, 0, 1.2, 0));
    const dome = this.mesh(new SphereGeometry(3.3, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), this.shell);
    dome.scale.y = 0.62;
    hab.add(this.at(dome, 0, 2.3, 0));
    const band = this.mesh(new TorusGeometry(3.38, 0.2, 10, 56), this.orange);
    band.rotation.x = Math.PI / 2;
    hab.add(this.at(band, 0, 2.3, 0));
    const skirt = this.mesh(new CylinderGeometry(3.55, 3.7, 0.35, 40), this.orange);
    hab.add(this.at(skirt, 0, 0.3, 0));
    const doorFrame = this.rounded(1.7, 2.3, 0.5, 0.18, this.orange);
    hab.add(this.at(doorFrame, 0, 1.35, 3.22));
    const door = this.rounded(1.25, 1.95, 0.4, 0.14, this.graphite);
    hab.add(this.at(door, 0, 1.2, 3.34));
    const canopy = this.rounded(2.2, 0.18, 1.1, 0.07, this.orange);
    hab.add(this.at(canopy, 0, 2.55, 3.45));
    for (let i = 0; i < 5; i++) {
      const a = -1.5 + i * 0.75;
      if (Math.abs(a) < 0.45) continue;
      const w = this.rounded(0.85, 0.55, 0.16, 0.06, this.window);
      w.castShadow = false;
      w.position.set(Math.sin(a) * 3.38, 1.55, Math.cos(a) * 3.38);
      w.rotation.y = a;
      hab.add(w);
    }
    const beaconBase = this.mesh(new CylinderGeometry(0.28, 0.34, 0.3, 14), this.orange);
    hab.add(this.at(beaconBase, 0, 3.78, 0));
    const beaconLamp = this.mesh(new SphereGeometry(0.26, 14, 10), this.window, false);
    hab.add(this.at(beaconLamp, 0, 4.05, 0));

    g.add(hab);

    // Annex: a horizontal capsule module with an orange stripe, joined to the hab by a short tube.
    const annex = this.mesh(new CapsuleGeometry(1.15, 3.2, 8, 24), this.shell);
    annex.rotation.z = Math.PI / 2;
    annex.rotation.y = 0.45;
    g.add(this.at(annex, 4.9, 1.3, -3.4));
    const stripe = this.mesh(new TorusGeometry(1.17, 0.14, 8, 36), this.orange);
    stripe.rotation.y = Math.PI / 2 + 0.45;
    g.add(this.at(stripe, 4.9 + 0.7, 1.3, -3.4 + 0.33));
    const tube = this.bar([2.8, 1.0, -2.0], [3.9, 1.1, -2.9], 0.5, this.ivory);
    g.add(tube);
    g.add(this.at(this.blob(3.0, 1.8, 0.02, 0.8), 4.9, 0.02, -3.4));

    // Solar array: three framed panels with cell grids on a shared rail.
    for (let i = 0; i < 3; i++) {
      const x = 8.4 + i * 3.4;
      const post = this.mesh(new CylinderGeometry(0.1, 0.14, 1.1, 10), this.graphite);
      g.add(this.at(post, x, 0.55, 0.2));
      const frame = this.rounded(3.0, 0.14, 1.95, 0.05, this.ivory);
      frame.rotation.x = -0.45;
      g.add(this.at(frame, x, 1.3, 0.2));
      const panel = this.rounded(2.82, 0.08, 1.77, 0.02, this.panelBlue);
      panel.rotation.x = -0.45;
      g.add(this.at(panel, x, 1.37, 0.17));
      g.add(this.at(this.blob(0.6, 0.5, 0.02, 0.8), x, 0.02, 0.2));
    }

    // Dish, flood mast (kept at (-6, *, 1) with the flood head at y 5.3: S06's spot light is aimed from there).
    const mast = this.mesh(new CylinderGeometry(0.1, 0.16, 6, 12), this.graphite);
    g.add(this.at(mast, -6, 3, 1));
    const mastFoot = this.mesh(new CylinderGeometry(0.4, 0.5, 0.35, 14), this.orange);
    g.add(this.at(mastFoot, -6, 0.17, 1));
    const dish = this.mesh(new SphereGeometry(1.0, 24, 12, 0, Math.PI * 2, 0, 0.95), this.ivory);
    dish.rotation.set(-0.9, 0.5, 0);
    g.add(this.at(dish, -6, 6.2, 1));
    const feed = this.bar([-6, 6.2, 1], [-5.45, 6.9, 1.45], 0.04, this.graphite);
    g.add(feed);
    const feedTip = this.mesh(new SphereGeometry(0.1, 10, 8), this.orange);
    g.add(this.at(feedTip, -5.45, 6.9, 1.45));
    const flood = this.rounded(1.0, 0.55, 0.4, 0.1, this.orange);
    g.add(this.at(flood, -6, 5.3, 1.3));
    const lamp = this.mesh(new BoxGeometry(0.78, 0.36, 0.05), this.window, false);
    g.add(this.at(lamp, -6, 5.3, 1.52));
    g.add(this.at(this.blob(0.9, 0.9, 0.02, 0.9), -6, 0.02, 1));

    // Fuel tanks and crates.
    for (let i = 0; i < 2; i++) {
      const tank = this.mesh(new CapsuleGeometry(0.72, 1.3, 8, 18), this.ivory);
      g.add(this.at(tank, -4.2 + i * 1.7, 1.37, 5.4));
      const cap = this.mesh(new CylinderGeometry(0.34, 0.34, 0.25, 12), this.orange);
      g.add(this.at(cap, -4.2 + i * 1.7, 2.8, 5.4));
      g.add(this.at(this.blob(1.1, 1.1, 0.02, 0.9), -4.2 + i * 1.7, 0.02, 5.4));
    }
    const crateAt: readonly (readonly [number, number, number, number, number])[] = [
      [4.5, 4.2, 0.5, 0.2, 0],
      [5.4, 4.5, 0.45, -0.3, 1],
      [4.8, 5.1, 0.4, 0.5, 0],
      [4.9, 4.6, 0.38, 0.1, 1.0],
    ];
    for (const [x, z, s, r, stacked] of crateAt) {
      const crate = this.rounded(
        s * 2,
        s * 2,
        s * 2,
        s * 0.22,
        stacked > 0.5 && z < 4.8 && s < 0.4 ? this.ivory : this.orange,
      );
      const y = stacked > 0.5 && s < 0.4 ? 0.5 * 2 + s : s;
      crate.position.set(x, y, z);
      crate.rotation.y = r;
      g.add(crate);
      g.add(this.at(this.blob(s * 1.9, s * 1.9, 0.02, 0.8), x, 0.02, z));
    }
    return g;
  }

  /** Flat-topped wall (VT-M0-16): 6 m wide, 2.4 m tall, 0.3 m thick, base on y = 0. */
  wall(): Mesh {
    const m = this.mesh(new BoxGeometry(6, 2.4, 0.3), this.ivory);
    m.name = "mc:look-wall";
    m.position.y = 1.2;
    return m;
  }

  /**
   * Scattered boulder field as one InstancedMesh (`count` rocks within `areaRadiusM`, avoiding `keepOut`), plus a second
   * InstancedMesh of soft contact blobs under them (returned in a group, rocks first).
   */
  boulderField(
    count: number,
    areaRadiusM: number,
    groundY: (x: number, z: number) => number,
    keepOut: readonly (readonly [number, number, number])[] = [],
    seed = 11,
  ): Group {
    const geometry = rockGeometry(seed);
    this.disposables.push(geometry);
    const blobGeometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.disposables.push(blobGeometry);
    const mesh = new InstancedMesh(geometry, this.rock, count);
    mesh.name = "mc:look-boulders";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const blobs = new InstancedMesh(blobGeometry, this.contact, count);
    blobs.name = "mc:look-boulder-contact";
    blobs.castShadow = false;
    blobs.receiveShadow = false;
    blobs.renderOrder = 2;
    const rand = mulberry32(seed * 977);
    let placed = 0;
    let guard = 0;
    while (placed < count && guard++ < count * 20) {
      const r = Math.sqrt(rand()) * areaRadiusM;
      const a = rand() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (keepOut.some(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) < kr)) continue;
      // Many small rocks, few big ones.
      const size = 0.12 + Math.pow(rand(), 3.2) * 1.5;
      const yaw = rand() * Math.PI * 2;
      this.q.setFromAxisAngle(this.up, yaw);
      const gy = groundY(x, z);
      this.s.set(size * (0.8 + rand() * 0.5), size * (0.7 + rand() * 0.5), size * (0.8 + rand() * 0.5));
      // Seated on the LOWEST ground under the rock's footprint, so the base is buried on slopes and crater walls too.
      const reach = size * 0.75;
      const low = Math.min(
        gy,
        groundY(x + reach, z),
        groundY(x - reach, z),
        groundY(x, z + reach),
        groundY(x, z - reach),
      );
      this.p.set(x, low + rockRestY(this.s.y), z);
      this.m4.compose(this.p, this.q, this.s);
      mesh.setMatrixAt(placed, this.m4);
      this.q.identity();
      this.p.set(x, gy + 0.02, z);
      this.s.set(size * 2.7, 1, size * 2.7);
      this.m4.compose(this.p, this.q, this.s);
      blobs.setMatrixAt(placed, this.m4);
      placed++;
    }
    mesh.count = placed;
    blobs.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    blobs.instanceMatrix.needsUpdate = true;
    const group = new Group();
    group.name = "mc:look-boulder-field";
    group.add(mesh, blobs);
    return group;
  }

  dispose(): void {
    for (const d of this.disposables.splice(0)) d.dispose();
  }
}
