// Settings (MVP subset): UI size, notice verbosity, reduce motion, volumes (settings slice, written through
// `settings.set`), render quality preset and the remap entry (intents). Native controls only, so keyboard and gamepad
// navigation work in DOM / spatial order. The quality preset is an intent with local selection state until the render
// settings service exposes the current preset.

import { useEffect, useRef, type ReactElement, type RefObject } from "react";
import { NOTICE_VERBOSITIES, type NoticeVerbosity } from "@moon-cleanup/shared";
import { formatString, STRINGS } from "../strings";
import { USER_SCALE_MAX, USER_SCALE_MIN } from "../tokens/display-metrics";
import { SaveSettings } from "../save/SaveSettings";
import { useUi, useUiSelector } from "../ui-context";
import { ControlsScreen } from "./ControlsScreen";
import {
  PLOT_CARD_ACTIVATIONS,
  QUALITY_PRESETS,
  useUiIntents,
  type PlotCardActivation,
  type QualityPreset,
} from "./intents";
import { useUiPrefs, useUiPrefsStore } from "./ui-local";
import styles from "./Menus.module.css";

const S = STRINGS.menus.settings;
const VOLUME_KEYS = ["master", "effects", "music", "ambience"] as const;

function presetRank(preset: QualityPreset): number {
  return QUALITY_PRESETS.indexOf(preset);
}
function nextPreset(preset: QualityPreset): QualityPreset {
  return QUALITY_PRESETS[Math.min(QUALITY_PRESETS.length - 1, presetRank(preset) + 1)] ?? preset;
}

function Segmented<T extends string>({
  label,
  options,
  value,
  names,
  onPick,
  testId,
  isUnavailable,
}: {
  label: string;
  options: readonly T[];
  value: T;
  names: Readonly<Record<T, string>>;
  onPick: (next: T) => void;
  testId: string;
  /** Options the device cannot use: shown, focusable, announced as disabled, and ignored on activation. */
  isUnavailable?: (option: T) => boolean;
}): ReactElement {
  return (
    <div className={styles["field"]} role="radiogroup" aria-label={label} data-testid={testId}>
      <span className={styles["fieldLabel"]}>{label}</span>
      <span className={styles["segmented"]}>
        {options.map((option) => {
          const unavailable = isUnavailable?.(option) === true;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={option === value}
              aria-disabled={unavailable || undefined}
              className={`${styles["seg"]} ${option === value ? styles["segOn"] : ""} ${unavailable ? styles["segOff"] : ""}`}
              onClick={() => {
                if (!unavailable) onPick(option);
              }}
            >
              {names[option]}
            </button>
          );
        })}
      </span>
    </div>
  );
}

export function SettingsPanel(): ReactElement {
  const prefs = useUiPrefsStore();
  const intents = useUiIntents();
  const controlsOpen = useUiPrefs((state) => state.controlsOpen);
  const remapRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Leaving Settings (or the screen) always ends a capture and tells the input layer the screen is closed.
  useEffect(
    () => () => {
      if (prefs.getState().controlsOpen) {
        prefs.setControlsOpen(false);
        intents.openControls(false);
      }
    },
    [prefs, intents],
  );
  // Back from the rebinding screen: focus returns to the button that opened it.
  useEffect(() => {
    if (wasOpen.current && !controlsOpen) remapRef.current?.focus({ preventScroll: true });
    wasOpen.current = controlsOpen;
  }, [controlsOpen]);

  if (controlsOpen) return <ControlsScreen />;
  return (
    <SettingsList
      remapRef={remapRef}
      onOpenControls={() => {
        prefs.setControlsOpen(true);
        intents.openControls(true);
      }}
    />
  );
}

function SettingsList({
  remapRef,
  onOpenControls,
}: {
  remapRef: RefObject<HTMLButtonElement | null>;
  onOpenControls: () => void;
}): ReactElement {
  const { store } = useUi();
  const settings = useUiSelector((state) => state.settings);
  const intents = useUiIntents();
  const prefs = useUiPrefsStore();
  const quality = useUiPrefs((state) => state.quality);
  const plotCardMode = useUiPrefs((state) => state.plotCardMode);

  return (
    <div className={styles["body"]}>
      <p className={styles["subtitle"]}>{S.subtitle}</p>

      <section className={styles["group"]} aria-label={S.interface}>
        <h3 className={styles["groupTitle"]}>{S.interface}</h3>
        <label className={styles["field"]}>
          <span className={styles["fieldLabel"]}>{S.hudScale}</span>
          <input
            type="range"
            className={styles["range"]}
            min={Math.round(USER_SCALE_MIN * 100)}
            max={Math.round(USER_SCALE_MAX * 100)}
            step={5}
            value={settings.hudScalePct}
            aria-valuetext={formatString(S.hudScaleValue, { pct: settings.hudScalePct })}
            data-testid="settings-hud-scale"
            onChange={(event) =>
              store.dispatch({ type: "settings.set", patch: { hudScalePct: Number(event.target.value) } })
            }
          />
          <span className={styles["fieldValue"]}>{formatString(S.hudScaleValue, { pct: settings.hudScalePct })}</span>
        </label>
        <Segmented<NoticeVerbosity>
          label={S.verbosity}
          options={NOTICE_VERBOSITIES}
          value={settings.noticeVerbosity}
          names={S.verbosityOptions}
          testId="settings-verbosity"
          onPick={(next) => store.dispatch({ type: "settings.set", patch: { noticeVerbosity: next } })}
        />
        <label className={styles["check"]}>
          <input
            type="checkbox"
            checked={settings.reduceMotion}
            data-testid="settings-reduce-motion"
            onChange={(event) =>
              store.dispatch({ type: "settings.set", patch: { reduceMotion: event.target.checked } })
            }
          />
          <span className={styles["checkText"]}>
            <span className={styles["fieldLabel"]}>{S.reduceMotion}</span>
            <span className={styles["rowBlurb"]}>{S.reduceMotionHint}</span>
          </span>
        </label>
      </section>

      <section className={styles["group"]} aria-label={S.audio}>
        <h3 className={styles["groupTitle"]}>{S.audio}</h3>
        {VOLUME_KEYS.map((key) => {
          const pct = Math.round(settings.volume[key] * 100);
          return (
            <label key={key} className={styles["field"]}>
              <span className={styles["fieldLabel"]}>{S.volumes[key]}</span>
              <input
                type="range"
                className={styles["range"]}
                min={0}
                max={100}
                step={5}
                value={pct}
                aria-valuetext={formatString(S.volumeValue, { pct })}
                data-testid={`settings-volume-${key}`}
                onChange={(event) =>
                  store.dispatch({
                    type: "settings.set",
                    patch: { volume: { ...settings.volume, [key]: Number(event.target.value) / 100 } },
                  })
                }
              />
              <span className={styles["fieldValue"]}>{formatString(S.volumeValue, { pct })}</span>
            </label>
          );
        })}
      </section>

      <section className={styles["group"]} aria-label={S.graphics}>
        <h3 className={styles["groupTitle"]}>{S.graphics}</h3>
        <Segmented<QualityPreset>
          label={S.quality}
          options={QUALITY_PRESETS}
          value={quality.preset}
          names={S.qualityOptions}
          testId="settings-quality"
          isUnavailable={(option) => presetRank(option) > presetRank(quality.maxPreset)}
          onPick={(next) => {
            prefs.setQuality({ preset: next }); // optimistic; `quality.changed` confirms or clamps it
            intents.setQualityPreset(next);
          }}
        />
        <p className={styles["rowBlurb"]} data-testid="settings-quality-hint">
          {quality.maxPreset === QUALITY_PRESETS[QUALITY_PRESETS.length - 1]
            ? S.qualityHint
            : formatString(S.qualityCapped, { preset: S.qualityOptions[nextPreset(quality.maxPreset)] })}
        </p>
      </section>

      <section className={styles["group"]} aria-label={S.controls}>
        <h3 className={styles["groupTitle"]}>{S.controls}</h3>
        <Segmented<PlotCardActivation>
          label={S.plotCard}
          options={PLOT_CARD_ACTIVATIONS}
          value={plotCardMode}
          names={S.plotCardOptions}
          testId="settings-plot-card-mode"
          onPick={(next) => {
            prefs.setPlotCardMode(next);
            intents.setPlotCardMode(next);
          }}
        />
        <div className={styles["field"]}>
          <span className={styles["fieldLabel"]}>
            {S.remap}
            <span className={styles["rowBlurb"]}>{S.remapHint}</span>
          </span>
          <button
            ref={remapRef}
            type="button"
            className={`${styles["buy"]} ${styles["buyReady"]}`}
            data-testid="settings-remap"
            id="mc-settings-remap"
            onClick={onOpenControls}
          >
            {S.remap}
          </button>
        </div>
      </section>

      <SaveSettings />
    </div>
  );
}
