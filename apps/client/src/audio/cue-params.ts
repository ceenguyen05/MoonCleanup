// Maps a cue's typed parameters (shared/audio/cues.ts AudioCueParamMap) to playback rate and gain. Pure; writes into a
// caller-owned `Controls` object so the play path allocates nothing.

import {
  AUDIO_CELL_FILL_PITCH_SEMITONES,
  AUDIO_STAMP_STREAK_MAX_SEMITONES,
  type AudioCueId,
} from "@moon-cleanup/shared";
import { clamp } from "./dsp";

export interface Controls {
  rate: number;
  gain: number;
}

/** Loose superset of every cue's parameters; fields a cue does not use are simply absent. */
export interface LooseParams {
  readonly gain?: number;
  readonly pitchSemitones?: number;
  readonly speed01?: number;
  readonly grime01?: number;
  readonly fill01?: number;
  readonly dry?: boolean;
  readonly rate01?: number;
  readonly streak?: number;
  readonly streak01?: number;
  readonly distance01?: number;
  readonly impact01?: number;
  readonly load01?: number;
  readonly intensity01?: number;
  readonly effort01?: number;
  readonly night01?: number;
  readonly farSide01?: number;
  readonly pct?: number;
  readonly pucks?: number;
  readonly kindId?: string;
  readonly own?: boolean;
  readonly toolId?: string;
}

export function semitoneRate(semis: number): number {
  return Math.pow(2, semis / 12);
}

/** Computes rate and gain of cue `id` for `p`. Neutral cues return rate 1, gain 1 (times the common params). */
export function controlsFor(id: AudioCueId, p: LooseParams, out: Controls): Controls {
  let semis = p.pitchSemitones ?? 0;
  let gain = p.gain ?? 1;
  switch (id) {
    case "tool.sweep": {
      const speed = clamp(p.speed01 ?? 0.5, 0, 1);
      const grime = clamp(p.grime01 ?? 1, 0, 1);
      // Swirl rate +-15 percent with speed; clean ground is thinner and higher (about +3 semitones), and quieter.
      out.rate = (0.85 + 0.3 * speed) * semitoneRate(semis + 3 * (1 - grime));
      gain *= (0.25 + 0.75 * speed) * (0.55 + 0.45 * grime) * (p.dry === true ? 0.35 : 1);
      out.gain = gain;
      return out;
    }
    case "cell.fill_hiss":
      semis += AUDIO_CELL_FILL_PITCH_SEMITONES * clamp(p.fill01 ?? 0, 0, 1);
      gain *= 0.5 + 0.5 * clamp(p.fill01 ?? 0, 0, 1);
      break;
    case "assay.pour":
      out.rate = 0.9 + 0.2 * clamp(p.rate01 ?? 0.5, 0, 1);
      out.gain = gain * (0.5 + 0.5 * clamp(p.rate01 ?? 0.5, 0, 1));
      return out;
    case "plot.stamp":
      semis += Math.min(AUDIO_STAMP_STREAK_MAX_SEMITONES, Math.max(0, (p.streak ?? 1) - 1));
      break;
    case "ui.lumen_tick":
      semis += 5 * clamp(p.streak01 ?? 0, 0, 1);
      break;
    case "railshot.thoom":
      gain *= 1 - 0.6 * clamp(p.distance01 ?? 0, 0, 1);
      break;
    case "avatar.land":
      gain *= 0.35 + 0.65 * clamp(p.impact01 ?? 0.5, 0, 1);
      break;
    case "avatar.footstep":
      gain *= 0.5 + 0.5 * clamp(p.speed01 ?? 0.5, 0, 1);
      break;
    case "vehicle.drive_loop":
      out.rate = 0.7 + 0.8 * clamp(p.speed01 ?? 0, 0, 1);
      out.gain = gain * (0.35 + 0.65 * clamp(p.speed01 ?? 0, 0, 1));
      return out;
    case "vehicle.work_loop":
      out.rate = 0.9 + 0.2 * clamp(p.intensity01 ?? 0.5, 0, 1);
      out.gain = gain * (0.3 + 0.7 * clamp(p.intensity01 ?? 0.5, 0, 1));
      return out;
    case "ambience.breathing":
      out.rate = 0.85 + 0.6 * clamp(p.effort01 ?? 0, 0, 1);
      out.gain = gain * (0.35 + 0.65 * clamp(p.effort01 ?? 0, 0, 1));
      return out;
    case "ambience.suit_bed":
      // Night cools the bed (darker via lower rate), the far side thins it to almost nothing.
      out.rate = 1 - 0.03 * clamp(p.night01 ?? 0, 0, 1);
      out.gain = gain * (1 - 0.35 * clamp(p.night01 ?? 0, 0, 1)) * (1 - 0.9 * clamp(p.farSide01 ?? 0, 0, 1));
      return out;
    case "music.stinger_shine": {
      // Milestone percent nudges the pitch up (1 % lowest, 100 % highest), within a fourth.
      const pct = clamp(p.pct ?? 25, 1, 100);
      semis += 5 * (Math.log(pct) / Math.log(100));
      break;
    }
    default:
      break;
  }
  out.rate = semitoneRate(semis);
  out.gain = gain;
  return out;
}
