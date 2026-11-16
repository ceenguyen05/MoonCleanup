// Sync / offline status chip of the HUD (bottom left). A calm, one-line "where is my progress" readout driven by the
// `saveSync` slice. Display only: pointer-transparent, never takes focus, never blocks Solo (offline is a normal state, so
// it reads as a quiet chip, not a warning). Only a conflict or a failure raises to the attention tone. The Settings
// section and the prompt carry the details and the actions.

import { AnimatePresence, motion } from "motion/react";
import { memo, type ReactElement } from "react";
import { useUiPrefs } from "../menus/ui-local";
import { fadeTransition } from "../motion/presets";
import { STRINGS } from "../strings";
import { useReducedMotion, useSpring, useUiSelector } from "../ui-context";
import { hasConflict, indicatorView } from "./save-sync-model";
import { SyncGlyph } from "./SyncGlyph";
import styles from "./SyncIndicator.module.css";

const S = STRINGS.saveSync;

export const SyncIndicator = memo(function SyncIndicator(): ReactElement {
  const save = useUiSelector((state) => state.saveSync);
  const dismissed = useUiPrefs((state) => state.savePromptDismissed);
  const reduced = useReducedMotion();
  const pop = useSpring("pop");
  const view = indicatorView(save.state);
  const later = hasConflict(save) && dismissed;
  const chip = later ? S.conflictLaterChip : view.chip;
  const busy = view.state === "uploading";
  return (
    <div
      className={`${styles["chip"]} ${view.tone === "attention" ? styles["attention"] : ""}`}
      role="status"
      aria-live={view.tone === "attention" ? "polite" : "off"}
      aria-label={S.indicatorRegion}
      title={view.text}
      data-testid="hud-sync"
      data-state={view.state}
    >
      <span className={styles["glyph"]}>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={view.glyph}
            className={`${styles["glyphInner"]} ${busy && !reduced ? styles["busy"] : ""}`}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: fadeTransition("out", reduced) }}
            transition={pop}
          >
            <SyncGlyph glyph={view.glyph} />
          </motion.span>
        </AnimatePresence>
      </span>
      <span className={styles["text"]} data-testid="hud-sync-text">
        {chip}
      </span>
    </div>
  );
});
