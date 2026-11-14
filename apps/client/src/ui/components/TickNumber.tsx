import { animate } from "motion/react";
import { useEffect, useRef, type ReactElement } from "react";
import { EASE, tickUpDurationMs } from "../motion/presets";
import { useReducedMotion } from "../ui-context";
import styles from "./TickNumber.module.css";

const INTEGER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatInteger(value: number): string {
  return INTEGER.format(Math.round(value));
}

export interface TickNumberProps {
  readonly value: number;
  readonly format?: (value: number) => string;
  /** Flash gold on increases (income). Default true. */
  readonly flash?: boolean;
  readonly className?: string;
}

/**
 * Counter that rolls to a new value locally (no React re-render per frame, no store traffic): tabular numerals so the
 * layout never shifts, duration `clamp(350 + 220 log10 |delta|, 350, 1200)` ms with ease-out-expo, a gold flash on
 * income. Reduced motion jumps straight to the value with a one-frame highlight. Each new value restarts the roll
 * from what is on screen, so rapid increments merge into one tick-up.
 */
export function TickNumber({ value, format = formatInteger, flash = true, className }: TickNumberProps): ReactElement {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  const initial = useRef(value);
  const flashAnimation = useRef<Animation | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const from = shown.current;
    if (from === value) return undefined;
    const increased = value > from;

    if (flash && increased) {
      flashAnimation.current?.cancel();
      flashAnimation.current = element.animate(
        [{ color: "var(--mc-lumen-gold)" }, { color: "var(--mc-lumen-gold)", offset: 0.35 }, { color: "inherit" }],
        { duration: reduced ? 120 : 600, easing: "ease-out" },
      );
    }
    if (reduced) {
      shown.current = value;
      element.textContent = format(value);
      return undefined;
    }
    const controls = animate(from, value, {
      duration: tickUpDurationMs(value - from) / 1000,
      ease: [...EASE.outExpo],
      onUpdate: (latest) => {
        shown.current = latest;
        element.textContent = format(latest);
      },
      onComplete: () => {
        shown.current = value;
        element.textContent = format(value);
      },
    });
    return () => controls.stop();
  }, [value, format, flash, reduced]);

  return (
    <span ref={ref} className={[styles["number"], className].filter(Boolean).join(" ")}>
      {format(initial.current)}
    </span>
  );
}
