// Player settings persistence of the composition root (integrator round 5, Job B). No shared settings/save path exists
// for client preferences yet (the Solo save is the Contract checkpoint, not the settings), so the three player-chosen
// values live in the browser's localStorage next to the Solo identity keys: UI size, render quality preset and the
// key/pad binding table. Every read is validated; a corrupt value is reported (not silently replaced) and ignored.
// Writes never throw (private mode, quota): a failure is reported once through `onProblem`.

import { QUALITY_PRESET_IDS, type QualityPresetId } from "@moon-cleanup/shared";
import type { KeyValueStore } from "./solo-host";

export const SETTINGS_KEYS = {
  hudScalePct: "mc.settings.hudScalePct",
  quality: "mc.settings.quality",
  bindings: "mc.controls.bindings",
} as const;

/** UI size slider range (percent), matching the UI's USER_SCALE_MIN/MAX. */
export const HUD_SCALE_PCT_MIN = 80;
export const HUD_SCALE_PCT_MAX = 150;

export interface SettingsStorage {
  loadHudScalePct(): number | null;
  saveHudScalePct(pct: number): void;
  loadQuality(): QualityPresetId | null;
  saveQuality(preset: QualityPresetId): void;
  /** Raw JSON object (device code -> action id); the controls port validates it. Null when nothing is stored. */
  loadBindings(): Readonly<Record<string, string>> | null;
  saveBindings(table: Readonly<Record<string, string>>): void;
}

export function createSettingsStorage(
  storage: KeyValueStore | null,
  onProblem: (source: string, error: unknown) => void,
): SettingsStorage {
  let writeFailed = false;
  const read = (key: string): string | null => {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const write = (key: string, value: string): void => {
    try {
      storage?.setItem(key, value);
    } catch (error) {
      if (!writeFailed) {
        writeFailed = true;
        onProblem("settings save", error);
      }
    }
  };
  return {
    loadHudScalePct() {
      const raw = read(SETTINGS_KEYS.hudScalePct);
      if (raw === null) return null;
      const pct = Number(raw);
      if (!Number.isFinite(pct) || pct < HUD_SCALE_PCT_MIN || pct > HUD_SCALE_PCT_MAX) {
        onProblem("settings load", new Error(`stored UI size "${raw}" is out of range and was ignored`));
        return null;
      }
      return Math.round(pct);
    },
    saveHudScalePct(pct) {
      write(SETTINGS_KEYS.hudScalePct, String(Math.round(pct)));
    },
    loadQuality() {
      const raw = read(SETTINGS_KEYS.quality);
      if (raw === null) return null;
      const preset = QUALITY_PRESET_IDS.find((id) => id === raw);
      if (preset === undefined) {
        onProblem("settings load", new Error(`stored quality preset "${raw}" is unknown and was ignored`));
        return null;
      }
      return preset;
    },
    saveQuality(preset) {
      write(SETTINGS_KEYS.quality, preset);
    },
    loadBindings() {
      const raw = read(SETTINGS_KEYS.bindings);
      if (raw === null) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
        const table: Record<string, string> = {};
        for (const [device, action] of Object.entries(parsed)) {
          if (typeof action !== "string") throw new Error(`binding for ${device} is not an action id`);
          table[device] = action;
        }
        return table;
      } catch (error) {
        onProblem("settings load", new Error(`stored key bindings are unreadable and were ignored: ${String(error)}`));
        return null;
      }
    },
    saveBindings(table) {
      write(SETTINGS_KEYS.bindings, JSON.stringify(table));
    },
  };
}
