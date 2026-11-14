// Sun-shadow bias rule (rendering-pipeline.md section 5.2, VT-M0-04b). Pure.
//
//   normal offset  = K_NORMAL_TEXELS * texel      (metres along the surface normal, per cascade)
//   depth bias     = K_DEPTH_TEXELS * texel       (metres along the light, TOWARD more shadow, per cascade)
//
// Why this and not the earlier grazing rule (M0-visual-checks, measured on S05 at sun 60 / 15 / 4 / 1 degrees):
//
// - three renders the shadow map with the BACK faces of single-sided casters (`Renderer._shadowSide`), and no look material is
//   double-sided. A lit surface is therefore never in the map itself: the nearest stored depth along its light ray is the far
//   side of whatever stands between it and the sun. There is no self-shadow acne for a bias to push away.
// - The earlier normal offset was divided by `max(sin(elevation), 0.05)`: 16 texels at 4 degrees, 20 at 1 degree. That lifts
//   the lookup point 0.36 m (Medium cascade 0) to 4.3 m (cascade 2) above the ground, over the top of the caster: a 0.42 m rock
//   cast no shadow at 4 degrees and a 1 m post's shadow ended where cascade 0 ends (6.6 m of 14.3 m).
// - The earlier depth bias was slope-scaled, up to 8.7 texels on a surface the sun grazes. In three a positive `bias` moves the
//   receiver AWAY from the light (more shadow). The large normal offset hid that; with the offset corrected it darkened 43 to
//   52 % of the lit pixels of a 10 cm post. With the sign flipped it opens a 9 to 24 cm gap at every contact.
// - With no depth bias at all the PCF kernel leaves a lit sliver of about half a texel where a caster meets the ground (1.2 to
//   2.1 cm on Medium: post foot, boot soles). Half a texel toward more shadow closes it (0 to 0.4 cm) and costs 1 to 3 % of
//   the post's lit pixels.
//
// Both constants are in shadow-map TEXELS, so the same rule holds for every preset and cascade. A caster shorter than the
// normal offset of its cascade (Medium: 2.5 cm, 11 cm, 30 cm) loses its shadow there, which is below what that cascade
// resolves anyway. Double-sided casters would need a negative `bias` on their own shadow; add it per material, not here.

/** Lookup offset along the receiver normal, in texels of the cascade: covers the PCF footprint on curved lit surfaces. */
export const K_NORMAL_TEXELS = 1.1;
/** Depth bias toward more shadow, in texels of the cascade: closes the PCF sliver at the foot of a caster. */
export const K_DEPTH_TEXELS = 0.5;

/** World size of one shadow texel for an orthographic cascade of `widthM` over `sizePx`. */
export function texelWorldM(widthM: number, sizePx: number): number {
  return widthM / sizePx;
}

/** Normal-offset bias in metres for a cascade texel. Independent of the sun elevation (see the header). */
export function normalBiasM(texelM: number): number {
  return K_NORMAL_TEXELS * texelM;
}

/**
 * `LightShadow.bias` of a cascade: the depth bias in the normalised depth of its orthographic shadow camera (`depthRangeM` =
 * far - near). Positive, which in three means "more shadow" on both the standard and the reversed depth buffer.
 */
export function depthBias(texelM: number, depthRangeM: number): number {
  return depthRangeM > 0 ? (K_DEPTH_TEXELS * texelM) / depthRangeM : 0;
}
