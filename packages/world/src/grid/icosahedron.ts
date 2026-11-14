// The 12 icosahedron vertices and the 10 diamonds of the GP(m,0) grid (WDS sections 2.2 and 2.3).
//
// Vertices are 17-significant-digit literals (WDS section 1 determinism rule): N = +Y, S = -Y; upper ring U0..U4 at
// latitude +atan(1/2), longitudes 0, 72, 144, 216, 288 deg; lower ring L0..L4 at latitude -atan(1/2), longitudes 36,
// 108, 180, 252, 324 deg. Longitude 0 is +X and increases toward -Z (east): x = r cos(lon), z = -r sin(lon), with
// y = 1/sqrt(5), r = 2/sqrt(5). Values were computed with 40-digit decimal arithmetic from the exact golden-ratio forms
// of cos/sin(36 deg) and cos/sin(72 deg).

const Y = 0.44721359549995794; // 1/sqrt(5)
const R0 = 0.89442719099991588; // 2/sqrt(5)
const RC72 = 0.27639320225002103; // r cos 72
const RS72 = 0.85065080835203993; // r sin 72
const RC36 = 0.72360679774997897; // r cos 36
const RS36 = 0.52573111211913361; // r sin 36

/** Unit vectors as [x, y, z]. */
export type Vec3Tuple = readonly [number, number, number];

export const ICO_NORTH: Vec3Tuple = [0, 1, 0];
export const ICO_SOUTH: Vec3Tuple = [0, -1, 0];

/** Upper ring U0..U4 (longitudes 0, 72, 144, 216, 288 deg). */
export const ICO_UPPER: readonly Vec3Tuple[] = [
  [R0, Y, 0],
  [RC72, Y, -RS72],
  [-RC36, Y, -RS36],
  [-RC36, Y, RS36],
  [RC72, Y, RS72],
];

/** Lower ring L0..L4 (longitudes 36, 108, 180, 252, 324 deg). */
export const ICO_LOWER: readonly Vec3Tuple[] = [
  [RC36, -Y, -RS36],
  [-RC72, -Y, -RS72],
  [-R0, -Y, 0],
  [-RC72, -Y, RS72],
  [RC36, -Y, RS36],
];

/**
 * Lattice corners of diamond `d` in the order (0,0), (m,0), (0,m), (m,m) (WDS section 2.3).
 *   North d (0..4):    U_d, N, L_d, U_{d+1}   (i toward N, j toward L_d)
 *   South 5+k (5..9):  L_k, U_{k+1}, S, L_{k+1} (i toward U_{k+1}, j toward S)
 */
export function diamondCorners(d: number): readonly [Vec3Tuple, Vec3Tuple, Vec3Tuple, Vec3Tuple] {
  const pick = (list: readonly Vec3Tuple[], index: number): Vec3Tuple => {
    const v = list[((index % 5) + 5) % 5];
    if (!v) throw new RangeError(`icosahedron vertex ${index}`);
    return v;
  };
  if (d >= 0 && d < 5) {
    return [pick(ICO_UPPER, d), ICO_NORTH, pick(ICO_LOWER, d), pick(ICO_UPPER, d + 1)];
  }
  if (d >= 5 && d < 10) {
    const k = d - 5;
    return [pick(ICO_LOWER, k), pick(ICO_UPPER, k + 1), ICO_SOUTH, pick(ICO_LOWER, k + 1)];
  }
  throw new RangeError(`diamond ${d}`);
}
