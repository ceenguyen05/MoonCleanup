// Material slots and player colours of the blockout custodian and Desk Duster v0 (M1-W3-T07). Pure data, no three.
//
// The Blender sources (`assets/models/characters/blockout/custodian_blockout.py`, `assets/models/tools/blockout/
// desk_duster_v0.py`) write the slot id per face into glTF COLOR_0.R (slot / 15) and the rigid part into COLOR_0.B
// (part / 15); COLOR_0.G is baked AO. This table is the "final material slots" of art-direction 13.4: the production
// suit (M1-W4-T07) keeps the slots and replaces the per-slot constants with texture reads.
// Values: art-direction 4.3 (suit), 5.1 (Brightside PBR palette), 4.4 (player colours), naming bible T1 (wood + brass).

/** Encoding scale of slot and part ids in COLOR_0 (8-bit exact: k / 15 * 255 = 17 k). */
export const ID_SCALE = 15;

export interface SlotSpec {
  readonly name: string;
  /** Base colour, sRGB hex. Ignored where `player` is 1 (the player colour replaces it). */
  readonly base: number;
  readonly roughness: number;
  readonly metalness: number;
  /** 1 = the player colour replaces the base colour (art-direction 4.3 "Player color" slot). */
  readonly player: number;
  /** Emissive strength in units of the base / player colour (scene-linear, before exposure). */
  readonly emissive: number;
  /** 1 = this slot is the Crown Lamp lens: its emission follows the lamp switch. */
  readonly lamp: number;
}

export const SLOTS: readonly SlotSpec[] = [
  { name: "suit", base: 0xe4dccb, roughness: 0.8, metalness: 0, player: 0, emissive: 0, lamp: 0 },
  { name: "bellows", base: 0x1c8c84, roughness: 0.7, metalness: 0, player: 0, emissive: 0, lamp: 0 },
  { name: "graphite", base: 0x2b2f34, roughness: 0.6, metalness: 0, player: 0, emissive: 0, lamp: 0 },
  { name: "steel", base: 0xc9cccf, roughness: 0.35, metalness: 1, player: 0, emissive: 0, lamp: 0 },
  { name: "hazard", base: 0xf2b705, roughness: 0.45, metalness: 0, player: 0, emissive: 0, lamp: 0 },
  { name: "playerPlate", base: 0xffffff, roughness: 0.5, metalness: 0, player: 1, emissive: 0, lamp: 0 },
  { name: "playerGlow", base: 0xffffff, roughness: 0.4, metalness: 0, player: 1, emissive: 0.4, lamp: 0 },
  // Smoked bronze visor: dark, glossy, partly metallic so the environment (lit ground, Earth) shows as a Fresnel rim.
  { name: "visor", base: 0x4a3622, roughness: 0.08, metalness: 0.75, player: 0, emissive: 0, lamp: 0 },
  { name: "lampLens", base: 0xfff1d6, roughness: 0.2, metalness: 0, player: 0, emissive: 6, lamp: 1 },
  { name: "sole", base: 0x1f2226, roughness: 0.9, metalness: 0, player: 0, emissive: 0, lamp: 0 },
  // Desk Duster v0 (naming bible T1: polished wood and brass, graphite bristles).
  { name: "wood", base: 0x8a5532, roughness: 0.35, metalness: 0, player: 0, emissive: 0, lamp: 0 },
  { name: "brass", base: 0xc9a14a, roughness: 0.3, metalness: 1, player: 0, emissive: 0, lamp: 0 },
  { name: "bristle", base: 0x2b2f34, roughness: 0.9, metalness: 0, player: 0, emissive: 0, lamp: 0 },
  // Production suit + tools (M1-W4-T07). Glyph: player-colour plate decal; the material inks the numeral from the
  // glyph atlas (art-direction 4.4). Rubber: squeegee blade. Orange grip: the scuffed Crescent Squeegee grip.
  { name: "glyph", base: 0xffffff, roughness: 0.5, metalness: 0, player: 1, emissive: 0, lamp: 0 },
  { name: "rubber", base: 0x16181a, roughness: 0.75, metalness: 0, player: 0, emissive: 0, lamp: 0 },
  { name: "orangeGrip", base: 0xd9772e, roughness: 0.7, metalness: 0, player: 0, emissive: 0, lamp: 0 },
];

/** Numeral ink of the glyph slot (graphite, sRGB hex). */
export const GLYPH_INK = 0x1f2226;

/** Slot ids by name (the Blender scripts use the same numbers). */
export const SLOT = Object.freeze(Object.fromEntries(SLOTS.map((s, i) => [s.name, i])) as Record<string, number>);

/** Player colours P01..P16 (art-direction 4.4), sRGB hex. */
export const PLAYER_COLORS: readonly number[] = [
  0xff6b5b, 0xff9a3c, 0xf5d547, 0xa3e048, 0x3ddc97, 0x2ec4d6, 0x4da3ff, 0x4e6cff, 0x8e6bff, 0xc86bfa, 0xff5fc8,
  0xff8fa8, 0xd9b98c, 0xbfe6ff, 0xd93a4a, 0x3e9e5a,
];

/** Rigid parts of the procedural motion (COLOR_0.B). Left before right; `pivot_<joint>_<L|R>` nodes in the GLB. */
export const PART = {
  body: 0,
  thighL: 1,
  thighR: 2,
  shinL: 3,
  shinR: 4,
  upperArmL: 5,
  upperArmR: 6,
  forearmL: 7,
  forearmR: 8,
} as const;

/** sRGB hex -> linear RGB (0..1), the colour space the TSL material works in. */
export function srgbHexToLinear(hex: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const c = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  out[0] = c((hex >> 16) & 255);
  out[1] = c((hex >> 8) & 255);
  out[2] = c(hex & 255);
  return out;
}

/** Wraps any integer to a valid player slot index 0..15. */
export function playerSlot(index: number): number {
  const n = PLAYER_COLORS.length;
  return ((Math.trunc(index) % n) + n) % n;
}
