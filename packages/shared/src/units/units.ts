// @contract units/units v0
// @consumers every package and app that names a quantity (M0: this package's own contracts, apps/client/src/render,
//   apps/client/src/net, apps/server/src/net)
//
// Unit aliases. They are plain `number` aliases, not brands, on purpose: simulation and rendering math mixes these
// values in every expression and must not pay a cast per operation. The alias documents the unit at a declaration
// (`dt: Seconds`) and nothing more. The project uses SI units everywhere: metres, seconds, kilograms.

/** Length or distance in metres. */
export type Metres = number;

/** Duration or elapsed time in seconds. */
export type Seconds = number;

/** Duration or clock value in milliseconds (network clocks, timers). */
export type Milliseconds = number;

/** Mass in kilograms (dust, cargo). */
export type Kilograms = number;

/** Amount of Lumens (LM), the in-game currency. */
export type Lumens = number;

/** Rate in hertz (simulation tick rate, snapshot rate). */
export type Hertz = number;

/** Index of a simulation tick. u32 on the wire (netcode.md section 2). */
export type Tick = number;
