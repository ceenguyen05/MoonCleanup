import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { NetConnectionState } from "@moon-cleanup/shared";
import { DotLight, GlassPanel } from "../components/GlassPanel";
import { fadeTransition } from "../motion/presets";
import { STRINGS } from "../strings";
import { useReducedMotion, useSpring, useUiSelector } from "../ui-context";
import { MoonMark } from "./MoonMark";
import styles from "./WakingOverlay.module.css";
import { dotTipAt, formatElapsed, isWakingVisible, wakingVariant, type WakingVariant } from "./waking-model";

const COPY: Record<WakingVariant, { readonly headline: string; readonly body: string }> = {
  waking: { headline: STRINGS.waking.headline, body: STRINGS.waking.body },
  slow: { headline: STRINGS.waking.headlineSlow, body: STRINGS.waking.bodySlow },
  connecting: { headline: STRINGS.waking.headlineConnecting, body: STRINGS.waking.bodyConnecting },
  lost: { headline: STRINGS.waking.headlineLost, body: STRINGS.waking.bodyLost },
};

/** Whole seconds since the overlay became visible; resets when it hides. Updates once a second. */
function useElapsedSeconds(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);
  useEffect(() => {
    if (!active) {
      startedAt.current = null;
      setElapsed(0);
      return undefined;
    }
    startedAt.current ??= performance.now();
    const tick = (): void => {
      const start = startedAt.current ?? performance.now();
      setElapsed(Math.floor((performance.now() - start) / 1000));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return elapsed;
}

export interface WakingOverlayProps {
  /** Forces a connection state without touching the store (`?wakePreview=`, QA only). */
  readonly previewConn?: NetConnectionState | null;
}

/**
 * SCR-03 "Waking the moon...": a calm, honest wait over the canvas, bound to the `session.conn` slice of the UI store
 * (mirrored from `net.status`). Shown while `waking`, `connecting` or `lost`; leaves when `connected`.
 */
export function WakingOverlay({ previewConn = null }: WakingOverlayProps): ReactElement {
  const storeConn = useUiSelector((state) => state.session.conn);
  const closeCode = useUiSelector((state) => state.session.closeCode);
  const conn = previewConn ?? storeConn;
  const visible = isWakingVisible(conn);
  const reduced = useReducedMotion();
  const soft = useSpring("soft");
  const elapsed = useElapsedSeconds(visible);
  const variant = wakingVariant(conn, elapsed);
  const lastVariant = useRef<WakingVariant>("waking");
  if (variant !== null) lastVariant.current = variant;
  const shownVariant = variant ?? lastVariant.current; // keep the last copy while the overlay fades out
  const copy = COPY[shownVariant];
  const tip = dotTipAt(elapsed);
  const reloadRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (variant === "lost") reloadRef.current?.focus();
  }, [variant]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="waking"
          className={styles["scrim"]}
          data-testid="waking-overlay"
          data-conn={conn}
          data-variant={shownVariant}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: fadeTransition("in", reduced) }}
          exit={{ opacity: 0, transition: fadeTransition("out", reduced) }}
        >
          <motion.div
            className={styles["stage"]}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            transition={soft}
          >
            <GlassPanel
              strong
              as="section"
              className={styles["panel"]}
              role="dialog"
              aria-modal="false"
              aria-labelledby="mc-waking-headline"
            >
              <MoonMark />
              <div className={styles["copy"]} aria-live="polite" aria-atomic="true">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={shownVariant}
                    className={styles["headlineBlock"]}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, transition: fadeTransition("in", reduced) }}
                    exit={{ opacity: 0, transition: fadeTransition("out", reduced) }}
                  >
                    <h2 id="mc-waking-headline" className={styles["headline"]}>
                      {copy.headline}
                    </h2>
                    <p className={styles["body"]}>{copy.body}</p>
                  </motion.div>
                </AnimatePresence>
              </div>
              {variant === "lost" ? (
                <div className={styles["actions"]}>
                  <button
                    ref={reloadRef}
                    type="button"
                    className={styles["button"]}
                    onClick={() => window.location.reload()}
                  >
                    {STRINGS.waking.reload}
                  </button>
                  {closeCode !== null && <span className={styles["code"]}>{closeCode}</span>}
                </div>
              ) : (
                <div className={styles["elapsed"]} role="timer" aria-label={STRINGS.waking.elapsedLabel}>
                  <span className={styles["elapsedLabel"]}>{STRINGS.waking.elapsedLabel}</span>
                  <span className={styles["elapsedValue"]} data-testid="waking-elapsed">
                    {formatElapsed(elapsed)}
                  </span>
                </div>
              )}
              {variant !== "lost" && (
                <div className={styles["dot"]}>
                  <span className={styles["dotTag"]}>
                    <DotLight />
                    {STRINGS.waking.dotTag}
                  </span>
                  <div className={styles["tipSlot"]}>
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.p
                        key={tip.index}
                        className={styles["tip"]}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1, transition: fadeTransition("in", reduced) }}
                        exit={{ opacity: 0, transition: fadeTransition("out", reduced) }}
                      >
                        {tip.text}
                      </motion.p>
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </GlassPanel>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
