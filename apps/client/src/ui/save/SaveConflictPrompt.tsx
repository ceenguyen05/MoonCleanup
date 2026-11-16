// "Which copy?" (ADR-0031 rule 3): shown when this device and the cloud hold diverged Solo saves. Two copies side by side
// (saved-at, device, playtime, Shine, wallet) and two explicit buttons. There is NO default: focus starts on the heading,
// Enter on the heading does nothing, nothing is highlighted as "recommended" (the Newer tag is information only) and
// there is no timeout. "Decide later" (also Esc / pad Back) just hides the prompt; the player keeps playing on this
// device, the indicator says a choice is waiting and Settings can reopen it. Choosing sends `saveSync.resolveConflict`
// through the store (the net module does the work, backs up the losing copy and answers by clearing the conflict).
//
// Keyboard: Tab is trapped in the dialog, arrows move focus spatially, Esc = decide later. Gamepad: `UiModule.navigate`
// drives the same functions through SAVE_PROMPT_ATTR. While visible the prompt raises `menus.modal`, so the input layer
// can suspend gameplay bindings the same way it does for a menu.

import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Cloud, Monitor } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import type { SaveConflictChoice, SoloCheckpointSummary } from "@moon-cleanup/shared";
import { GlassPanel } from "../components/GlassPanel";
import { Icon } from "../icons/Icon";
import { focusables, moveFocus, type NavDirection } from "../menus/focus-nav";
import { useUiPrefs, useUiPrefsStore } from "../menus/ui-local";
import { fadeTransition } from "../motion/presets";
import { formatString, STRINGS } from "../strings";
import { useReducedMotion, useSpring, useUi, useUiSelector } from "../ui-context";
import { hasMoreBelow, newerSide, promptVisible, summaryRows, wrapTab } from "./save-sync-model";
import { useNow } from "./use-now";
import styles from "./SaveConflictPrompt.module.css";

const S = STRINGS.saveSync.prompt;
const SAFETY_DAYS = 7; // SOLO_BACKUP_RETENTION_DAYS (shared/api/rest)
/** A choice the net module never answered (it keeps the prompt on a failed download) frees the buttons again. */
export const CHOICE_TIMEOUT_MS = 20_000;

/** Attribute the gamepad navigation looks for to find the prompt (kept apart from the menu frame's own attribute). */
export const SAVE_PROMPT_ATTR = "data-mc-save-prompt";

const ARROWS: Readonly<Record<string, NavDirection>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

function CopyCard({
  side,
  summary,
  newer,
  busy,
  chosen,
  onChoose,
  totalPlots,
  nowMs,
}: {
  side: "local" | "server";
  summary: SoloCheckpointSummary;
  newer: boolean;
  busy: boolean;
  chosen: boolean;
  onChoose: () => void;
  totalPlots: number;
  nowMs: number;
}): ReactElement {
  const choice: SaveConflictChoice = side === "local" ? "keep_local" : "use_server";
  const titleId = useId();
  const hintId = useId();
  return (
    <section className={styles["card"]} aria-labelledby={titleId} data-testid={`save-copy-${side}`}>
      <header className={styles["cardHead"]}>
        <span className={styles["cardIcon"]}>
          <Icon icon={side === "local" ? Monitor : Cloud} size={24} />
        </span>
        <h3 id={titleId} className={styles["cardTitle"]}>
          {side === "local" ? S.local : S.server}
        </h3>
        {newer && <span className={styles["newer"]}>{S.newer}</span>}
      </header>
      <dl className={styles["rows"]}>
        {summaryRows(summary, nowMs, totalPlots).map((row) => (
          <div key={row.id} className={styles["row"]}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        className={styles["choose"]}
        aria-disabled={busy || undefined}
        aria-describedby={hintId}
        data-testid={`save-choose-${choice}`}
        data-chosen={chosen || undefined}
        onClick={() => {
          if (!busy) onChoose();
        }}
      >
        {S.choose[choice]}
      </button>
      <p id={hintId} className={styles["hint"]}>
        {S.chooseHint[choice]}
      </p>
    </section>
  );
}

function PromptDialog(): ReactElement {
  const { store } = useUi();
  const prefs = useUiPrefsStore();
  const save = useUiSelector((state) => state.saveSync);
  const totalPlots = useUiSelector((state) => state.shine.total);
  const device = useUiSelector((state) => state.input.lastDevice);
  const reduced = useReducedMotion();
  const soft = useSpring("soft");
  const nowMs = useNow(30_000);
  const rootRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const titleId = useId();
  const introId = useId();
  const [pending, setPending] = useState<SaveConflictChoice | null>(null);
  // Keep the last pair while the dialog fades out after the conflict cleared.
  const lastConflict = useRef(save.conflict);
  if (save.conflict !== null) lastConflict.current = save.conflict;
  const conflict = lastConflict.current;
  const hasConflict = conflict !== null;

  useEffect(() => {
    openerRef.current = document.activeElement;
    return () => {
      const target = openerRef.current;
      if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true });
    };
  }, []);

  // Free the buttons again when the net module reports a failure or never answers; success removes the dialog itself.
  const errorKey = save.error === null ? "" : `${save.error.kind}:${save.error.reason ?? ""}`;
  useEffect(() => {
    setPending(null);
  }, [errorKey]);
  useEffect(() => {
    if (pending === null) return undefined;
    const id = window.setTimeout(() => setPending(null), CHOICE_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [pending]);

  // "More below" cue: shown only while the copies body is scrollable and not at its end.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const body = bodyRef.current;
    if (body === null) return undefined;
    const update = (): void => setMore(hasMoreBelow(body.scrollTop, body.clientHeight, body.scrollHeight));
    update();
    body.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(body);
    for (const child of Array.from(body.children)) observer?.observe(child);
    return () => {
      body.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [hasConflict]);

  const headingRef = useCallback((node: HTMLHeadingElement | null): void => {
    node?.focus({ preventScroll: true });
  }, []);

  const later = (): void => prefs.setSavePromptDismissed(true);
  const choose = (choice: SaveConflictChoice): void => {
    setPending(choice);
    store.dispatch({ type: "saveSync.resolveConflict", choice });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    event.stopPropagation(); // the game must not see dialog typing, Enter or Space
    const root = rootRef.current;
    if (root === null) return;
    if (event.key === "Escape") {
      event.preventDefault();
      later();
      return;
    }
    const arrow = ARROWS[event.key];
    if (arrow !== undefined) {
      event.preventDefault();
      moveFocus(root, arrow);
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = focusables(root);
    const active = document.activeElement;
    const index = active instanceof HTMLElement ? nodes.indexOf(active) : -1;
    const target = wrapTab(nodes.length, index, event.shiftKey);
    if (target !== null) {
      event.preventDefault();
      nodes[target]?.focus();
    }
  };

  if (conflict === null) return <></>;
  const newer = newerSide(conflict.local, conflict.server);
  const busy = pending !== null;
  const statusText = busy ? S.working : save.error !== null ? S.failed : "";
  return (
    <motion.div
      className={styles["scrim"]}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: fadeTransition("in", reduced) }}
      exit={{ opacity: 0, transition: fadeTransition("out", reduced) }}
    >
      <motion.div
        ref={rootRef}
        {...{ [SAVE_PROMPT_ATTR]: "" }}
        className={styles["stage"]}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={introId}
        data-testid="save-conflict-prompt"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, transition: fadeTransition("out", false) }}
        transition={soft}
        onKeyDown={onKeyDown}
      >
        <GlassPanel strong className={styles["panel"] ?? ""}>
          <div className={styles["bodyWrap"]}>
            <div ref={bodyRef} className={styles["body"]} data-testid="save-prompt-body">
              <h2 id={titleId} ref={headingRef} tabIndex={-1} className={styles["title"]}>
                {S.title}
              </h2>
              <p id={introId} className={styles["intro"]}>
                {S.intro}
              </p>
              <div className={styles["cards"]}>
                <CopyCard
                  side="local"
                  summary={conflict.local}
                  newer={newer === "local"}
                  busy={busy}
                  chosen={pending === "keep_local"}
                  onChoose={() => choose("keep_local")}
                  totalPlots={totalPlots}
                  nowMs={nowMs}
                />
                <CopyCard
                  side="server"
                  summary={conflict.server}
                  newer={newer === "server"}
                  busy={busy}
                  chosen={pending === "use_server"}
                  onChoose={() => choose("use_server")}
                  totalPlots={totalPlots}
                  nowMs={nowMs}
                />
              </div>
              <p className={styles["safety"]}>{formatString(S.safety, { days: SAFETY_DAYS })}</p>
            </div>
            <div
              className={styles["more"]}
              aria-hidden="true"
              data-testid="save-prompt-more"
              data-visible={more || undefined}
            >
              <span className={styles["morePill"]}>
                <Icon icon={ChevronDown} size={16} />
                {S.moreBelow}
              </span>
            </div>
          </div>
          <footer className={styles["foot"]}>
            <div className={styles["footRow"]}>
              <button
                type="button"
                className={styles["later"]}
                data-testid="save-decide-later"
                aria-describedby={`${introId}-later`}
                onClick={later}
              >
                {S.later}
              </button>
              <span id={`${introId}-later`} className={styles["laterHint"]} hidden={statusText !== ""}>
                {S.laterHint}
              </span>
              <div className={styles["status"]} role="status" aria-live="polite" data-testid="save-prompt-status">
                {statusText}
              </div>
            </div>
            <p className={styles["keys"]}>{S.footer[device]}</p>
          </footer>
        </GlassPanel>
      </motion.div>
    </motion.div>
  );
}

/** Mounted by UiRoot. Renders nothing unless the slice holds a conflict and the player has not postponed it. */
export function SaveConflictPrompt(): ReactNode {
  const { store } = useUi();
  const save = useUiSelector((state) => state.saveSync);
  const dismissed = useUiPrefs((state) => state.savePromptDismissed);
  const prefs = useUiPrefsStore();
  const modalMissing = useUiSelector((state) => state.menus.modal === null);
  const visible = promptVisible(save, dismissed);

  // A conflict that ended (the net module resolved it, or a sync fast-forwarded) re-arms the prompt for the next one.
  useEffect(() => {
    if (save.state !== "conflict") prefs.setSavePromptDismissed(false);
  }, [save.state, prefs]);

  // Tell the input layer a modal is up (gameplay bindings suspend); clear it only when it is still ours.
  useEffect(() => {
    if (!visible) return undefined;
    if (modalMissing) {
      store.dispatch({ type: "menus.modal", modal: { id: "confirm", props: { kind: "save_conflict" } } });
    }
    return undefined;
  }, [visible, modalMissing, store]);
  useEffect(() => {
    if (visible) return undefined;
    const modal = store.getState().menus.modal;
    if (modal !== null && modal.props["kind"] === "save_conflict") store.dispatch({ type: "menus.modal", modal: null });
    return undefined;
  }, [visible, store]);

  return <AnimatePresence>{visible && <PromptDialog key="save-conflict" />}</AnimatePresence>;
}
