import { describe, expect, it } from "vitest";

import { parseLdemLabel } from "./label.js";

const LABEL = `PDS_VERSION_ID            = "PDS3"
PRODUCT_ID                = "LDEM_16"
DESCRIPTION               = "This data product is a shape map (radius)
   of the Moon at a resolution of 1895.21 m/pix.
"
OBJECT                    = UNCOMPRESSED_FILE
  OBJECT                  = IMAGE
    LINES                 = 2880
    LINE_SAMPLES          = 5760
    SAMPLE_TYPE           = LSB_INTEGER
    SAMPLE_BITS           = 16
    SCALING_FACTOR        = 0.5
    OFFSET                = 1737400.
  END_OBJECT              = IMAGE
END_OBJECT                = UNCOMPRESSED_FILE
 MAP_RESOLUTION               = 16 <pix/deg>
 POSITIVE_LONGITUDE_DIRECTION = "EAST"
 CENTER_LONGITUDE             = 180 <deg>
 LINE_PROJECTION_OFFSET       = 1439.5 <pix>
 SAMPLE_PROJECTION_OFFSET     = 2879.5 <pix>
 MAXIMUM_LATITUDE             = 90 <deg>
 WESTERNMOST_LONGITUDE        = 0 <deg>
`;

describe("LDEM label", () => {
  it("decodes the parameters from the label (nothing assumed)", () => {
    const label = parseLdemLabel(LABEL);
    expect(label.productId).toBe("LDEM_16");
    expect(label.lines).toBe(2880);
    expect(label.lineSamples).toBe(5760);
    expect(label.scalingFactor).toBe(0.5);
    expect(label.referenceRadiusM).toBe(1737400);
    expect(label.pixelsPerDegree).toBe(16);
    expect(label.sampleProjectionOffset).toBe(2879.5);
  });

  it("rejects unsupported sample types and inconsistent dimensions", () => {
    expect(() => parseLdemLabel(LABEL.replace("LSB_INTEGER", "MSB_INTEGER"))).toThrow(/Unsupported/);
    expect(() => parseLdemLabel(LABEL.replace("5760", "5000"))).toThrow(/dimensions/);
  });
});
