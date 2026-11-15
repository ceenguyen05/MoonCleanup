// Steep rule input (game-feel section 2.3): tan of the local ground slope at the avatar, by the same central
// differences stepAvatar uses (+-slopeProbeM along the frame axes, measured before the move). Kept outside stepAvatar:
// any extra read inside that function pushed V8 to box doubles there (~470 B/tick in the alloc test). Writes the
// result into `out[0]` (no float64 return value, which would box when the call is not inlined).
import type { SimConfig } from "../config/sim-config";
import { headingBasis, type AvatarState, type SimGround } from "./avatar";

const basis = new Float64Array(9);
const probe = new Float64Array(4);

export function groundSlopeTan(a: AvatarState, cfg: SimConfig, ground: SimGround, out: Float64Array): void {
  headingBasis(a, basis); // idempotent for an unchanged position (stepAvatar calls it again)
  const pm = cfg.feel.slopeProbeM;
  const k = pm / cfg.moonRadiusM;
  const nx = basis[0]!;
  const ny = basis[1]!;
  const nz = basis[2]!;
  for (let p = 0; p < 4; p++) {
    const b = p < 2 ? 6 : 3;
    const kk = (p & 1) === 0 ? k : -k;
    const x = nx + basis[b]! * kk;
    const y = ny + basis[b + 1]! * kk;
    const z = nz + basis[b + 2]! * kk;
    const l = Math.sqrt(x * x + y * y + z * z);
    probe[p] = ground.heightAtXYZ(x / l, y / l, z / l);
  }
  const ge = (probe[0]! - probe[1]!) / (2 * pm);
  const gn = (probe[2]! - probe[3]!) / (2 * pm);
  out[0] = Math.sqrt(ge * ge + gn * gn);
}
