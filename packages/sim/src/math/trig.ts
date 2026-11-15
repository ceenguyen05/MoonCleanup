// Deterministic trigonometry for gameplay paths (game-feel-and-controls.md section 2.1 "Determinism"): a 4,096-entry
// sine table generated with + - * / only (Taylor series, no Math.sin), sampled with linear interpolation. Every JS
// engine produces the same table bytes and therefore the same answers. Angles are "turn units": 65,536 = one full
// turn, the same scale as `SimInputCommand.yaw` (u16).
//
// Also a deterministic arctangent (polynomial, max error about 1e-5 rad) for slope angles. Bit-exactness across
// machines is not required by ADR-0010, but avoiding Math.sin/cos/atan keeps replays identical in practice.

/** Turn units per full turn (= INPUT_YAW_STEPS). */
export const TURN_UNITS = 65_536;
const TABLE_BITS = 12;
const TABLE_SIZE = 1 << TABLE_BITS; // 4096
const UNITS_PER_ENTRY = TURN_UNITS / TABLE_SIZE; // 16
const TWO_PI = 6.283185307179586;

/** sin(2 pi k / TABLE_SIZE) for k = 0 .. TABLE_SIZE (one extra entry so interpolation never wraps). */
const SIN_TABLE: Float64Array = buildSinTable();

function taylorSin(x: number): number {
  // x in [-pi/4, pi/4]: 11 terms are far below double precision.
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n <= 11; n++) {
    term = (-term * x2) / (2 * n * (2 * n + 1));
    sum += term;
  }
  return sum;
}

function taylorCos(x: number): number {
  const x2 = x * x;
  let term = 1;
  let sum = 1;
  for (let n = 1; n <= 11; n++) {
    term = (-term * x2) / ((2 * n - 1) * (2 * n));
    sum += term;
  }
  return sum;
}

function buildSinTable(): Float64Array {
  const t = new Float64Array(TABLE_SIZE + 1);
  const eighth = TABLE_SIZE / 8;
  for (let k = 0; k <= TABLE_SIZE; k++) {
    // Reduce to an octant so the series argument stays in [-pi/4, pi/4].
    const kk = k % TABLE_SIZE;
    const octant = Math.floor(kk / eighth);
    const rem = kk - octant * eighth; // 0 .. eighth-1
    const xSmall = (rem * TWO_PI) / TABLE_SIZE; // 0 .. pi/4
    const xBig = ((eighth - rem) * TWO_PI) / TABLE_SIZE; // pi/4 .. 0
    let v: number;
    switch (octant) {
      case 0:
        v = taylorSin(xSmall);
        break;
      case 1:
        v = taylorCos(xBig);
        break;
      case 2:
        v = taylorCos(xSmall);
        break;
      case 3:
        v = taylorSin(xBig);
        break;
      case 4:
        v = -taylorSin(xSmall);
        break;
      case 5:
        v = -taylorCos(xBig);
        break;
      case 6:
        v = -taylorCos(xSmall);
        break;
      default:
        v = -taylorSin(xBig);
        break;
    }
    t[k] = v;
  }
  return t;
}

/** sin of an angle in turn units (any real; wrapped). */
export function sinTurn(units: number): number {
  let u = units % TURN_UNITS;
  if (u < 0) u += TURN_UNITS;
  const f = u / UNITS_PER_ENTRY;
  const i = Math.floor(f);
  const a = SIN_TABLE[i]!;
  return a + (SIN_TABLE[i + 1]! - a) * (f - i);
}

/** cos of an angle in turn units. */
export function cosTurn(units: number): number {
  return sinTurn(units + TURN_UNITS / 4);
}

/** Radians to turn units. */
export function radiansToTurn(rad: number): number {
  return (rad * TURN_UNITS) / TWO_PI;
}

/** Turn units to radians in [0, 2 pi). */
export function turnToRadians(units: number): number {
  let u = units % TURN_UNITS;
  if (u < 0) u += TURN_UNITS;
  return (u * TWO_PI) / TURN_UNITS;
}

const HALF_PI = 1.5707963267948966;

/** Deterministic atan (Abramowitz-Stegun 4.4.49 style odd polynomial on [0, 1], range-reduced). |error| < 2e-5 rad. */
export function atanDet(x: number): number {
  const ax = x < 0 ? -x : x;
  const inv = ax > 1;
  const t = inv ? 1 / ax : ax;
  const t2 = t * t;
  const p = t * (0.999866 + t2 * (-0.3302995 + t2 * (0.180141 + t2 * (-0.085133 + t2 * 0.0208351))));
  const r = inv ? HALF_PI - p : p;
  return x < 0 ? -r : r;
}

/** Deterministic atan2 in radians, (-pi, pi]. Presentation and snapshots only. */
export function atan2Det(y: number, x: number): number {
  if (x > 0) return atanDet(y / x);
  if (x < 0) return y >= 0 ? atanDet(y / x) + Math.PI : atanDet(y / x) - Math.PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}
