// Achievement toasts: a gold badge stamps in (spring pop, transform and opacity only) with the achievement's name, holds
// 4.5 s and fades. Detection is local: the first non-empty `achievements` snapshot is the baseline (nothing replays on
// load); a later `unlockedAtMs` turning non-null raises one toast. At most 3 on screen; announced politely.

import { AnimatePresence, motion } from "motion/react";
import { Award } from "lucide-react";
import { memo, useEffect, useRef, useState, type ReactElement } from "react";
import { DotLight } from "../components/GlassPanel";
import { Icon } from "../icons/Icon";
import { fadeTransition } from "../motion/presets";
import { STRINGS } from "../strings";
import { useReducedMotion, useSpring, useUiSelector } from "../ui-context";
import { achievementName, scanUnlocks } from "./onboarding-model";
import styles from "./Onboarding.module.css";

export const ACHIEVEMENT_HOLD_MS = 4500;
export const ACHIEVEMENT_MAX_VISIBLE = 3;

interface AwardToast {
  readonly key: number;
  readonly name: string;
}

export const AchievementToasts = memo(function AchievementToasts(): ReactElement {
  const items = useUiSelector((state) => state.achievements.items);
  const reduced = useReducedMotion();
  const pop = useSpring("pop");
  const [awards, setAwards] = useState<readonly AwardToast[]>([]);
  const known = useRef<ReadonlySet<string> | null>(null);
  const nextKey = useRef(1);
  const timers = useRef<Set<number>>(new Set());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) window.clearTimeout(id);
      pending.clear();
    };
  }, []);

  useEffect(() => {
    if (items.length === 0) return undefined;
    const scan = scanUnlocks(known.current, items);
    known.current = scan.known;
    const added: AwardToast[] = [];
    for (const id of scan.fresh) {
      const name = achievementName(id);
      if (name !== null) added.push({ key: nextKey.current++, name });
    }
    if (added.length === 0) return undefined;
    setAwards((list) => [...added, ...list].slice(0, ACHIEVEMENT_MAX_VISIBLE));
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setAwards((list) => list.filter((award) => !added.some((gone) => gone.key === award.key)));
    }, ACHIEVEMENT_HOLD_MS);
    timers.current.add(timer);
    return undefined;
  }, [items]);

  return (
    <div
      className={styles["achievements"]}
      role="status"
      aria-live="polite"
      aria-relevant="additions"
      data-testid="hud-achievements"
    >
      <AnimatePresence initial={false} mode="popLayout">
        {awards.map((award) => (
          <motion.div
            key={award.key}
            layout={reduced ? false : "position"}
            className={styles["award"]}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -14, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: fadeTransition("out", reduced) }}
            transition={pop}
          >
            <motion.span
              className={styles["badge"]}
              initial={reduced ? false : { scale: 1.5, rotate: -14 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={pop}
            >
              <Icon icon={Award} size={24} />
            </motion.span>
            <span className={styles["awardText"]}>
              <span className={styles["kicker"]}>{STRINGS.achievements.toastKicker}</span>
              <span className={styles["awardName"]}>{award.name}</span>
            </span>
            <DotLight />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
});
