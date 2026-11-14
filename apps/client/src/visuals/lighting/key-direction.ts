// Direction toward the active key light (sun by day, Earth at near-side night) as ONE shared TSL uniform, world space, unit
// length. `SunRig.update` writes it once per frame; materials that need the light's direction outside the lighting model
// read it (the regolith's grazing-sun detail fade). Before any rig has run it points straight up (noon: no fade).

import { uniform } from "three/tsl";
import { Vector3 } from "three/webgpu";

export const keyDirectionUniform = uniform(new Vector3(0, 1, 0));
