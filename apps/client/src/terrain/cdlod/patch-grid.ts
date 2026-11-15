// The one shared CDLOD patch (WDS section 3.6): (quads + 1)^2 surface vertices plus a 1-vertex skirt ring, as plain
// arrays (pure). A vertex is (grid i, grid j, skirt flag): the grid index is clamped to 0..quads, so a skirt vertex
// sits under its edge vertex and the vertex shader lowers it by the node's skirt depth.

export interface PatchGrid {
  readonly quads: number;
  /** 3 floats per vertex: i, j, skirt (0 or 1). */
  readonly positions: Float32Array;
  readonly indices: Uint16Array;
  readonly triangles: number;
}

export function buildPatchGrid(quads: number): PatchGrid {
  if (!(Number.isInteger(quads) && quads >= 2 && quads % 2 === 0 && quads <= 128)) {
    throw new RangeError(`patch quads ${String(quads)}`);
  }
  const side = quads + 3;
  const positions = new Float32Array(side * side * 3);
  for (let gj = 0; gj < side; gj++) {
    for (let gi = 0; gi < side; gi++) {
      const k = (gj * side + gi) * 3;
      positions[k] = Math.min(quads, Math.max(0, gi - 1));
      positions[k + 1] = Math.min(quads, Math.max(0, gj - 1));
      positions[k + 2] = gi === 0 || gj === 0 || gi === side - 1 || gj === side - 1 ? 1 : 0;
    }
  }
  const cells = side - 1;
  const indices = new Uint16Array(cells * cells * 6);
  let n = 0;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const v00 = j * side + i;
      const v10 = v00 + 1;
      const v01 = v00 + side;
      const v11 = v01 + 1;
      // Counter-clockwise seen from outside (a to the right, b up; u x v = n on every face).
      indices[n++] = v00;
      indices[n++] = v10;
      indices[n++] = v11;
      indices[n++] = v00;
      indices[n++] = v11;
      indices[n++] = v01;
    }
  }
  return { quads, positions, indices, triangles: cells * cells * 2 };
}
