// Shared synthetic stand-in field for unit tests (smooth, with a ridge so slopes are non-trivial). Not a LOLA product.
import type { EquirectField } from "./lola/ldem.js";

export function syntheticField(width = 360, height = 180): EquirectField {
  const data = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    const lat = ((90 - (r + 0.5) * (180 / height)) * Math.PI) / 180;
    for (let c = 0; c < width; c++) {
      const lon = ((((c + 0.5) * 360) / width) * Math.PI) / 180;
      data[r * width + c] =
        40 * Math.sin(2 * lon) * Math.cos(lat) + 25 * Math.cos(3 * lat) + 10 * Math.sin(5 * lon + lat);
    }
  }
  const ppd = width / 360;
  return { width, height, data, colPerDeg: ppd, colOffset: -0.5, rowPerDeg: ppd, rowOffset: height / 2 - 0.5 };
}
