// Induction Checklist (HUD-07, GDD section 14): eight non-blocking guide steps, one at a time. Display only (the HUD is
// pointer-transparent and never takes focus); hiding and showing it lives in the Handbook. Nothing here runs per frame:
// React renders when the `checklist` slice changes (store flush, at most 15 Hz) and the animations (check draw, row
// collapse, completion stamp) use transform and opacity only. The block shrinks to a one-line header after 20 s without
// progress and re-expands on progress.

import { AnimatePresence, motion } from "motion/react";
import { ClipboardList } from "lucide-react";
import { memo, useEffect, useRef, useState, type ReactElement } from "react";
import { DotLight, GlassPanel } from "../components/GlassPanel";
import { Icon } from "../icons/Icon";
import { fadeTransition } from "../motion/presets";
import { STRINGS } from "../strings";
import { useReducedMotion, useSpring, useUiSelector } from "../ui-context";
import {
  inductionCount,
  inductionCountLabel,
  inductionView,
  progressKey,
  stepFraction,
  stepProgressText,
  stepText,
} from "./onboarding-model";
import styles from "./Onboarding.module.css";

const I = STRINGS.induction;

/** Time without progress before the block collapses to its header (ui-screens-and-flows HUD-07). */
export const INDUCTION_COLLAPSE_MS = 20_000;
/** How long a just-finished step stays as a ticked row before it leaves. */
export const INDUCTION_DONE_LINGER_MS = 1500;
/** How long the completion stamp stays. */
export const INDUCTION_COMPLETE_MS = 6000;
const CHECK_DRAW_S = 0.24;

function CheckMark({ drawn }: { readonly drawn: boolean }): ReactElement {
  const reduced = useReducedMotion();
  return (
    <svg className={styles["checkSvg"]} width={20} height={20} viewBox="0 0 20 20" aria-hidden="true">
      <motion.path
        d="M4.5 10.5 8.5 14.5 15.5 6"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={drawn && !reduced ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: reduced ? 0 : CHECK_DRAW_S, ease: [0.33, 1, 0.68, 1] }}
      />
    </svg>
  );
}

interface Leaving {
  readonly id: string;
  readonly title: string;
}

export const InductionChecklist = memo(function InductionChecklist(): ReactElement | null {
  const checklist = useUiSelector((state) => state.checklist);
  const reduced = useReducedMotion();
  const ui = useSpring("ui");
  const pop = useSpring("pop");
  const view = inductionView(checklist);
  const active = checklist.mode === "induction" && !checklist.hidden && view.total > 0;

  // Rows that just turned done stay ticked for a moment, then leave (spring collapse).
  const seenDone = useRef<ReadonlySet<string> | null>(null);
  const [leaving, setLeaving] = useState<readonly Leaving[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const wasComplete = useRef<boolean | null>(null);
  const key = progressKey(checklist.items);

  useEffect(() => {
    const doneNow = new Set(checklist.items.filter((item) => item.done).map((item) => item.id));
    const before = seenDone.current;
    seenDone.current = doneNow;
    if (before === null) return undefined; // first sight: steps finished in an earlier session do not replay
    const fresh: Leaving[] = [];
    for (const item of checklist.items) {
      const text = stepText(item);
      if (item.done && !before.has(item.id) && text !== null) fresh.push({ id: item.id, title: text.title });
    }
    if (fresh.length === 0) return undefined;
    setLeaving((list) => [...list, ...fresh]);
    const timer = window.setTimeout(
      () => setLeaving((list) => list.filter((row) => !fresh.some((added) => added.id === row.id))),
      INDUCTION_DONE_LINGER_MS,
    );
    return () => window.clearTimeout(timer);
  }, [checklist.items]);

  // Completion: shown once, only when it happens while the block is on screen.
  useEffect(() => {
    const before = wasComplete.current;
    wasComplete.current = view.complete;
    if (before === null || before || !view.complete) return undefined;
    setCelebrating(true);
    const timer = window.setTimeout(() => setCelebrating(false), INDUCTION_COMPLETE_MS);
    return () => window.clearTimeout(timer);
  }, [view.complete]);

  // 20 s without progress: collapse. Any progress re-expands.
  useEffect(() => {
    setCollapsed(false);
    if (!active || view.complete) return undefined;
    const timer = window.setTimeout(() => setCollapsed(true), INDUCTION_COLLAPSE_MS);
    return () => window.clearTimeout(timer);
  }, [key, active, view.complete]);

  if (!active) return null;
  if (view.complete && !celebrating) return null;

  const current = view.current;
  const currentText = current === null ? null : stepText(current);
  const progressText = current === null ? null : stepProgressText(current);
  const fraction = current === null ? 0 : stepFraction(current);
  const nextText = view.next === null ? null : stepText(view.next);
  const stepNo = current === null ? view.done : view.done + 1;

  return (
    <GlassPanel
      as="section"
      className={styles["induction"]}
      aria-label={I.region}
      data-testid="hud-induction"
      data-collapsed={collapsed}
      data-complete={view.complete}
    >
      <header className={styles["head"]}>
        <Icon icon={ClipboardList} size={20} />
        <span className={styles["headTitle"]}>{I.title}</span>
        <span className={styles["count"]} role="img" aria-label={inductionCountLabel(view)}>
          {inductionCount(view)}
        </span>
        <span className={styles["pips"]} aria-hidden="true">
          {Array.from({ length: view.total }, (_, k) => (
            <span key={k} className={styles["pip"]} data-done={k < view.done} />
          ))}
        </span>
      </header>

      <AnimatePresence initial={false} mode="popLayout">
        {leaving.map((row) => (
          <motion.div
            key={`done-${row.id}`}
            layout={reduced ? false : "position"}
            className={`${styles["row"]} ${styles["rowDone"]}`}
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: fadeTransition("out", reduced) }}
            transition={ui}
          >
            <span className={styles["rowIcon"]}>
              <CheckMark drawn />
            </span>
            <span className={styles["rowTitle"]}>{row.title}</span>
            <span className={styles["rowTag"]}>{I.done}</span>
          </motion.div>
        ))}

        {view.complete && celebrating ? (
          <motion.div
            key="complete"
            layout={reduced ? false : "position"}
            className={styles["complete"]}
            role="status"
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, transition: fadeTransition("out", reduced) }}
            transition={pop}
          >
            <span className={styles["completeTitle"]}>
              <DotLight />
              {I.complete}
            </span>
            <span className={styles["hint"]}>{I.completeBody}</span>
          </motion.div>
        ) : (
          current !== null &&
          currentText !== null && (
            <motion.div
              key={`now-${current.id}`}
              layout={reduced ? false : "position"}
              className={`${styles["row"]} ${styles["rowNow"]}`}
              aria-current="step"
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, transition: fadeTransition("out", reduced) }}
              transition={ui}
            >
              <span className={styles["rowIcon"]} aria-hidden="true">
                <span className={styles["stepNo"]}>{stepNo}</span>
              </span>
              <span className={styles["rowBody"]}>
                <span className={styles["rowTitle"]}>{currentText.title}</span>
                {!collapsed && <span className={styles["hint"]}>{currentText.hint}</span>}
                {!collapsed && progressText !== null && (
                  <span className={styles["meterRow"]}>
                    <span
                      className={styles["meter"]}
                      role="progressbar"
                      aria-label={progressText}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(fraction * 100)}
                    >
                      <span className={styles["meterFill"]} style={{ transform: `scaleX(${fraction})` }} />
                    </span>
                    <span className={styles["progressText"]}>{progressText}</span>
                  </span>
                )}
              </span>
            </motion.div>
          )
        )}
      </AnimatePresence>

      {!collapsed && nextText !== null && !view.complete && (
        <div className={`${styles["row"]} ${styles["rowNext"]}`}>
          <span className={styles["rowIcon"]} aria-hidden="true">
            <span className={styles["stepNo"]}>{stepNo + 1}</span>
          </span>
          <span className={styles["rowBody"]}>
            <span className={styles["rowTag"]}>{I.next}</span>
            <span className={styles["rowTitle"]}>{nextText.title}</span>
          </span>
        </div>
      )}
      {!collapsed && !view.complete && <p className={styles["foot"]}>{I.suggestOnly}</p>}
    </GlassPanel>
  );
});
