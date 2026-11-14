import { AnimatePresence, motion } from "motion/react";
import { Check, Info, TriangleAlert } from "lucide-react";
import { useSyncExternalStore, type ReactElement } from "react";
import { Icon } from "../icons/Icon";
import { fadeTransition } from "../motion/presets";
import { useReducedMotion, useSpring } from "../ui-context";
import { DotLight } from "./GlassPanel";
import type { ToastQueue, ToastTone } from "./toast-queue";
import styles from "./ToastStack.module.css";

const TONE_ICON = { ok: Check, info: Info, warn: TriangleAlert } as const satisfies Record<ToastTone, unknown>;

/** Top-center notice stack under the compass: spring-pop in, 3.5 s hold, 180 ms out. role="status" announces politely. */
export function ToastStack({ queue }: { readonly queue: ToastQueue }): ReactElement {
  const toasts = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const reduced = useReducedMotion();
  const pop = useSpring("pop");
  return (
    <div className={styles["stack"]} role="status" aria-live="polite" aria-relevant="additions">
      <AnimatePresence initial={false} mode="popLayout">
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout={reduced ? false : "position"}
            className={`${styles["toast"]} ${styles[toast.tone]}`}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: fadeTransition("out", reduced) }}
            transition={pop}
          >
            <span className={styles["glyph"]}>
              <Icon icon={TONE_ICON[toast.tone]} size={20} />
            </span>
            <span className={styles["text"]}>{toast.text}</span>
            <DotLight />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
