// Avatar tangent frame on the Moon sphere (spec 4.3 "Sphere frame"). up = normalize(pos). Forward is the sim facing
// projected onto the tangent plane; when that is degenerate (facing parallel to up, first frame at a pole) the
// previous forward is parallel-transported instead. Never cross(up, worldY), so the north-pole outpost is safe.
// Basis convention matches glTF / sim: right = forward x up (sim east = north x n).

export class SphereFrame {
  readonly up = new Float64Array(3);
  readonly fwd = new Float64Array(3);
  readonly right = new Float64Array(3);
  /** Signed yaw change of the last update about up, radians (+ = turning right). */
  yawDelta = 0;
  private valid = false;

  /** Forgets the previous forward (teleport / spawn). */
  reset(): void {
    this.valid = false;
    this.yawDelta = 0;
  }

  /**
   * Updates from a moon-centred position `pos[0..2]` and a world facing vector `facing[0..2]` (need not be unit or
   * tangent). Writes up / fwd / right.
   */
  update(pos: Float64Array, facing: Float64Array): void {
    const up = this.up;
    const fwd = this.fwd;
    let l = Math.sqrt(pos[0]! * pos[0]! + pos[1]! * pos[1]! + pos[2]! * pos[2]!);
    if (l < 1e-9) l = 1;
    const ux = pos[0]! / l;
    const uy = pos[1]! / l;
    const uz = pos[2]! / l;
    const px = fwd[0]!;
    const py = fwd[1]!;
    const pz = fwd[2]!;
    const hadPrev = this.valid;
    up[0] = ux;
    up[1] = uy;
    up[2] = uz;
    // 1) facing projected on the tangent plane.
    let d = facing[0]! * ux + facing[1]! * uy + facing[2]! * uz;
    let fx = facing[0]! - ux * d;
    let fy = facing[1]! - uy * d;
    let fz = facing[2]! - uz * d;
    let fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
    if (fl < 1e-4 && hadPrev) {
      // 2) parallel transport of the previous forward.
      d = px * ux + py * uy + pz * uz;
      fx = px - ux * d;
      fy = py - uy * d;
      fz = pz - uz * d;
      fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
    }
    if (fl < 1e-4) {
      // 3) any tangent: the world axis least aligned with up, projected.
      const ax = ux < 0 ? -ux : ux;
      const ay = uy < 0 ? -uy : uy;
      const az = uz < 0 ? -uz : uz;
      const rx = ax <= ay && ax <= az ? 1 : 0;
      const ry = rx === 0 && ay <= az ? 1 : 0;
      const rz = rx === 0 && ry === 0 ? 1 : 0;
      d = rx * ux + ry * uy + rz * uz;
      fx = rx - ux * d;
      fy = ry - uy * d;
      fz = rz - uz * d;
      fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
    }
    fx /= fl;
    fy /= fl;
    fz /= fl;
    // Signed yaw change versus the previous forward (transported), about up.
    if (hadPrev) {
      const cx = py * fz - pz * fy;
      const cy = pz * fx - px * fz;
      const cz = px * fy - py * fx;
      const s = cx * ux + cy * uy + cz * uz;
      const c = px * fx + py * fy + pz * fz;
      // Turning right (toward `right` = fwd x up) is a negative rotation about up; report it positive.
      this.yawDelta = -Math.atan2(s, c);
    } else this.yawDelta = 0;
    fwd[0] = fx;
    fwd[1] = fy;
    fwd[2] = fz;
    // right = fwd x up
    this.right[0] = fy * uz - fz * uy;
    this.right[1] = fz * ux - fx * uz;
    this.right[2] = fx * uy - fy * ux;
    this.valid = true;
  }

  /** World vector -> local (right, up, fwd) components. `out` may alias nothing in the frame. */
  toLocal(v: Float64Array, out: Float64Array): void {
    const x = v[0]!;
    const y = v[1]!;
    const z = v[2]!;
    const r = this.right;
    const u = this.up;
    const f = this.fwd;
    out[0] = x * r[0]! + y * r[1]! + z * r[2]!;
    out[1] = x * u[0]! + y * u[1]! + z * u[2]!;
    out[2] = x * f[0]! + y * f[1]! + z * f[2]!;
  }

  /** Local (right, up, fwd) -> world vector. */
  toWorld(v: Float64Array, out: Float64Array): void {
    const x = v[0]!;
    const y = v[1]!;
    const z = v[2]!;
    const r = this.right;
    const u = this.up;
    const f = this.fwd;
    out[0] = r[0]! * x + u[0]! * y + f[0]! * z;
    out[1] = r[1]! * x + u[1]! * y + f[1]! * z;
    out[2] = r[2]! * x + u[2]! * y + f[2]! * z;
  }
}
