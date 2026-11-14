import type { ReactElement } from "react";
import styles from "./MoonMark.module.css";

/** One moon disc. `clean` draws the polished ivory version, otherwise the grimy umber one. */
function Disc({ clean, id }: { readonly clean: boolean; readonly id: string }): ReactElement {
  const base = clean ? ["#fffaf0", "#eadfc6"] : ["#7d6149", "#4b3727"];
  const crater = clean ? "#cfc2a6" : "#3b2b1f";
  const craterRim = clean ? "#ffffff" : "#8f7358";
  return (
    <svg viewBox="0 0 120 120" width="100%" height="100%" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`${id}-fill`} cx="38%" cy="32%" r="80%">
          <stop offset="0" stopColor={base[0]} />
          <stop offset="1" stopColor={base[1]} />
        </radialGradient>
      </defs>
      <rect width="120" height="120" fill={`url(#${id}-fill)`} />
      <g fill={crater} opacity={clean ? 0.55 : 0.7}>
        <ellipse cx="42" cy="44" rx="13" ry="12" />
        <ellipse cx="79" cy="38" rx="8" ry="7.5" />
        <ellipse cx="82" cy="76" rx="15" ry="14" />
        <ellipse cx="38" cy="82" rx="7" ry="6.5" />
        <ellipse cx="62" cy="62" rx="5" ry="4.5" />
        <ellipse cx="96" cy="58" rx="4" ry="3.6" />
      </g>
      <g fill="none" stroke={craterRim} strokeWidth="1.4" opacity={clean ? 0.9 : 0.4}>
        <path d="M31 40a13 12 0 0 1 17-7" />
        <path d="M69 59a15 14 0 0 1 11-7" opacity="0" />
        <path d="M70 72a15 14 0 0 1 17-9" />
      </g>
      {!clean && (
        <g fill="#2c1f15" opacity="0.35">
          <circle cx="24" cy="62" r="2.2" />
          <circle cx="56" cy="24" r="1.8" />
          <circle cx="68" cy="96" r="2.4" />
          <circle cx="100" cy="86" r="1.6" />
          <circle cx="50" cy="104" r="1.4" />
        </g>
      )}
    </svg>
  );
}

/**
 * Brand moon for the waking screen: a grimy disc with a squeegee-clean wipe sweeping across it on a 6 s loop.
 * The wipe is two counter-moving layers (transform only), so nothing re-lays-out; reduced motion shows it half-clean.
 * Decorative: the screen text carries the meaning.
 */
export function MoonMark({ size = 132 }: { readonly size?: number }): ReactElement {
  return (
    <div className={styles["frame"]} style={{ width: size, height: size }} aria-hidden="true">
      <div className={styles["moon"]}>
        <div className={styles["layer"]}>
          <Disc clean={false} id="moon-grime" />
        </div>
        <div className={`${styles["layer"]} ${styles["wipe"]}`}>
          <div className={`${styles["layer"]} ${styles["wipeInner"]}`}>
            <Disc clean id="moon-clean" />
          </div>
          <div className={styles["edge"]} />
        </div>
        <div className={styles["rim"]} />
      </div>
      <svg className={`${styles["spark"]} ${styles["sparkA"]}`} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 1.5 14 10l8.5 2-8.5 2-2 8.5L10 14l-8.5-2L10 10z" fill="currentColor" />
      </svg>
      <svg className={`${styles["spark"]} ${styles["sparkB"]}`} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 1.5 14 10l8.5 2-8.5 2-2 8.5L10 14l-8.5-2L10 10z" fill="currentColor" />
      </svg>
    </div>
  );
}
