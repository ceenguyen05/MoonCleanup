// One purchasable row, shared by the Requisitions Desk and the Ops Console. State is text plus a glyph, never colour alone;
// an unaffordable or locked row keeps focus (aria-disabled, not disabled) and explains itself in a described-by line.

import { AnimatePresence, motion } from "motion/react";
import { Check, Lock } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { LumenIcon } from "../icons/custom";
import { Icon, type IconComponent } from "../icons/Icon";
import { SPRINGS } from "../motion/presets";
import { useReducedMotion } from "../ui-context";
import { lm, type RowStatus } from "./menu-model";
import styles from "./Menus.module.css";

export interface MenuRowProps {
  readonly testId: string;
  readonly icon: IconComponent;
  readonly name: string;
  readonly blurb?: string | null;
  readonly levelText?: string | null;
  /** Filled pips when a row has several levels (owned of max); omitted for single-level rows. */
  readonly pips?: { readonly on: number; readonly max: number } | null;
  readonly priceLm: number | null;
  readonly priceNote?: string | null;
  readonly hint?: string | null;
  readonly status: RowStatus;
  readonly labels: {
    readonly buy: string;
    readonly owned: string;
    readonly maxed: string;
    readonly locked: string;
    readonly processing: string;
    readonly approved: string;
  };
  readonly level: number;
  readonly onAct: () => void;
}

const STAMP_MS = 1400;

/** True for a short while after `level` goes up (an approved requisition). */
function useStamp(level: number): boolean {
  const prev = useRef(level);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const raised = level > prev.current;
    prev.current = level;
    if (!raised) return undefined;
    setOn(true);
    const id = window.setTimeout(() => setOn(false), STAMP_MS);
    return () => window.clearTimeout(id);
  }, [level]);
  return on;
}

export function MenuRow(props: MenuRowProps): ReactElement {
  const { status, labels } = props;
  const reduced = useReducedMotion();
  const stamped = useStamp(props.level);
  const reasonId = useId();
  const reason = status.kind === "locked" || status.kind === "short" ? status.text : null;
  const actionable = status.kind === "buy";
  let label: ReactNode = labels.buy;
  if (status.kind === "owned") label = labels.owned;
  else if (status.kind === "maxed") label = labels.maxed;
  else if (status.kind === "locked") label = labels.locked;
  else if (status.kind === "processing") label = labels.processing;
  const glyph = status.kind === "owned" || status.kind === "maxed" ? Check : status.kind === "locked" ? Lock : null;

  return (
    <li className={styles["row"]} data-testid={props.testId} data-status={status.kind}>
      <span className={styles["rowIcon"]} aria-hidden="true">
        <Icon icon={props.icon} size={24} />
      </span>
      <div className={styles["rowBody"]}>
        <span className={styles["rowName"]}>{props.name}</span>
        {props.blurb != null && <span className={styles["rowBlurb"]}>{props.blurb}</span>}
        {props.hint != null && <span className={styles["rowHint"]}>{props.hint}</span>}
        {reason !== null && (
          <span id={reasonId} className={styles["rowReason"]}>
            {reason}
          </span>
        )}
        {(props.levelText != null || props.pips != null) && (
          <span className={styles["rowLevel"]}>
            {props.pips != null && props.pips.max <= 8 && (
              <span className={styles["pips"]} aria-hidden="true">
                {Array.from({ length: props.pips.max }, (_, i) => (
                  <span key={i} className={`${styles["pip"]} ${i < (props.pips?.on ?? 0) ? styles["pipOn"] : ""}`} />
                ))}
              </span>
            )}
            {props.levelText}
          </span>
        )}
      </div>
      <div className={styles["rowAct"]}>
        {props.priceLm !== null && (
          <span className={styles["price"]}>
            <Icon icon={LumenIcon} size={20} />
            <span>{lm(props.priceLm)}</span>
            {props.priceNote != null && <span className={styles["priceNote"]}>{props.priceNote}</span>}
          </span>
        )}
        <span className={styles["btnWrap"]}>
          <button
            type="button"
            className={`${styles["buy"]} ${actionable ? styles["buyReady"] : ""}`}
            aria-disabled={actionable ? undefined : true}
            aria-describedby={reason === null ? undefined : reasonId}
            onClick={() => {
              if (actionable) props.onAct();
            }}
          >
            {glyph !== null && <Icon icon={glyph} size={16} />}
            <span>{label}</span>
          </button>
          <AnimatePresence>
            {stamped && (
              <motion.span
                className={styles["stamp"]}
                role="status"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: -10, scale: 1.35 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.16 } }}
                transition={reduced ? { duration: 0.12 } : SPRINGS.pop}
              >
                {labels.approved}
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </div>
    </li>
  );
}
