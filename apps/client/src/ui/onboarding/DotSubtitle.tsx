// DOT subtitle (bottom-centre, above nothing else it owns): the line `dot.line` as text with DOT's amber light. Every DOT
// line is text (audio-direction section 6), so this doubles as the caption for DOT's chime. One timer per line, no per-frame
// work; the line leaves with `dot.next`, which also promotes the next queued line. Unknown ids are skipped at once.

import { AnimatePresence, motion } from "motion/react";
import { memo, useEffect, type ReactElement } from "react";
import { DotLight } from "../components/GlassPanel";
import { fadeTransition } from "../motion/presets";
import { STRINGS } from "../strings";
import { useReducedMotion, useSpring, useUi, useUiSelector } from "../ui-context";
import { dotHoldMs, dotText } from "./onboarding-model";
import styles from "./Onboarding.module.css";

export const DotSubtitle = memo(function DotSubtitle(): ReactElement {
  const { store } = useUi();
  const line = useUiSelector((state) => state.dot.line);
  const unread = useUiSelector((state) => state.dot.handbookUnread);
  const reduced = useReducedMotion();
  const ui = useSpring("ui");
  const text = line === null ? null : dotText(line.textId, line.params);

  useEffect(() => {
    if (line === null) return undefined;
    // A line that cannot be shown is dropped on the next tick so the queue behind it is not stuck.
    const timer = window.setTimeout(
      () => store.dispatch({ type: "dot.next" }),
      text === null ? 0 : dotHoldMs(line.durationMs),
    );
    return () => window.clearTimeout(timer);
  }, [store, line, text]);

  return (
    <div role="status" aria-live="polite" aria-label={STRINGS.dotSubtitle.region} data-testid="hud-dot">
      {unread > 0 && (
        <span className={styles["tipBadge"]} data-testid="hud-tip-badge">
          <span className={styles["tipDot"]} aria-hidden="true" />
          {STRINGS.handbook.unread}
        </span>
      )}
      <AnimatePresence mode="wait" initial={false}>
        {line !== null && text !== null && (
          <motion.div
            key={`${line.textId}:${text}`}
            className={styles["dotLine"]}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: fadeTransition("out", reduced) }}
            transition={ui}
          >
            <DotLight />
            <span className={styles["dotTag"]}>{STRINGS.dotSubtitle.tag}</span>
            <span className={styles["dotText"]}>{text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
