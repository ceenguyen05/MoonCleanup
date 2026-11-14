import type { HTMLAttributes, ReactElement } from "react";
import styles from "./GlassPanel.module.css";

export interface GlassPanelProps extends HTMLAttributes<HTMLElement> {
  /** Strong glass (modals, text-heavy panels): 0.88 opacity and never blurred. */
  readonly strong?: boolean;
  readonly as?: "div" | "section" | "aside" | "header" | "nav";
}

/** Dark glass panel (token `ui-glass-*`): hairline border, top sheen, elevation e-1. */
export function GlassPanel({ strong = false, as: Tag = "div", className, ...rest }: GlassPanelProps): ReactElement {
  const classes = [styles["panel"], strong ? styles["strong"] : undefined, className].filter(Boolean).join(" ");
  return <Tag className={classes} {...rest} />;
}

/** DOT's small amber status light. Pulses (opacity only) unless reduced motion is on. */
export function DotLight({ label }: { readonly label?: string }): ReactElement {
  return (
    <span
      className={styles["dotLight"]}
      {...(label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
    />
  );
}
