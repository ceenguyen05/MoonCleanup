// Menu host: shows the surface named by `menus.open` (Requisitions Desk, Ops Console, Settings) as a modal dialog over the
// game. The store decides what is open (gameplay / input dispatch `menus.open`); this component only renders it. Keyboard:
// Tab is trapped, arrow keys move focus spatially, Escape goes back; the gamepad drives the same functions through
// `UiModule.navigate`. No window listeners: keys are React handlers on the frame, so closed menus cost nothing.

import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { GlassPanel } from "../components/GlassPanel";
import { Icon } from "../icons/Icon";
import { fadeTransition } from "../motion/presets";
import { STRINGS } from "../strings";
import { useReducedMotion, useSpring, useUi, useUiSelector } from "../ui-context";
import { Handbook } from "../onboarding/Handbook";
import { useCloseControls } from "./ControlsScreen";
import { focusables, moveFocus, type NavDirection } from "./focus-nav";
import { OpsConsole } from "./OpsConsole";
import { RequisitionsDesk } from "./RequisitionsDesk";
import { SettingsPanel } from "./SettingsPanel";
import { useUiPrefsStore } from "./ui-local";
import styles from "./Menus.module.css";

const M = STRINGS.menus;

export const MENU_NAV_ATTR = "data-mc-nav-root";

const ARROWS: Readonly<Record<string, NavDirection>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

function MenuFrame({
  surface,
  title,
  children,
}: {
  surface: string;
  title: string;
  children: ReactNode;
}): ReactElement {
  const { store } = useUi();
  const device = useUiSelector((state) => state.input.lastDevice);
  const reduced = useReducedMotion();
  const spring = useSpring("ui");
  const prefs = useUiPrefsStore();
  const closeControls = useCloseControls();
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const openerRef = useRef<Element | null>(null);
  const returnIdRef = useRef<string | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    returnIdRef.current = store.getState().menus.focusReturnId;
    return () => {
      const byId = returnIdRef.current === null ? null : document.getElementById(returnIdRef.current);
      const target = byId ?? openerRef.current;
      if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true });
    };
  }, [store]);

  const headingRef = useCallback((node: HTMLHeadingElement | null): void => {
    node?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    event.stopPropagation(); // the game must not see menu typing, Enter or Space
    const root = rootRef.current;
    if (root === null) return;
    if (event.key === "Escape") {
      event.preventDefault();
      // Inside the rebinding screen Escape first ends a capture, then returns to the Settings list, then closes.
      if (prefs.getState().capture !== null) prefs.setCapture(null);
      else if (prefs.getState().controlsOpen) closeControls();
      else store.dispatch({ type: "menus.back" });
      return;
    }
    const arrow = ARROWS[event.key];
    if (arrow !== undefined) {
      const target = event.target;
      const isRange = target instanceof HTMLInputElement && target.type === "range";
      if (isRange && (arrow === "left" || arrow === "right")) return; // sliders keep their own arrows
      event.preventDefault();
      moveFocus(root, arrow);
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = focusables(root);
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (first === undefined || last === undefined) return;
    const current = document.activeElement;
    const atStart =
      current === first || !root.contains(current) || (current instanceof HTMLElement && current.tabIndex < 0);
    if (event.shiftKey && atStart) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <motion.div
      className={styles["scrim"]}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: fadeTransition("in", reduced) }}
      exit={{ opacity: 0, transition: fadeTransition("out", reduced) }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) store.dispatch({ type: "menus.back" });
      }}
    >
      <motion.div
        ref={rootRef}
        {...{ [MENU_NAV_ATTR]: "" }}
        className={styles["stage"]}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={`menu-${surface}`}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, transition: fadeTransition("out", false) }}
        transition={spring}
        onKeyDown={onKeyDown}
      >
        <GlassPanel strong className={styles["panel"] ?? ""}>
          <header className={styles["head"]}>
            <h2 id={titleId} ref={headingRef} tabIndex={-1} className={styles["title"]}>
              {title}
            </h2>
            <button
              type="button"
              className={styles["closeBtn"]}
              aria-label={M.close}
              onClick={() => store.dispatch({ type: "menus.back" })}
            >
              <Icon icon={X} size={20} />
            </button>
          </header>
          {children}
          <footer className={styles["foot"]}>{M.footer[device]}</footer>
        </GlassPanel>
      </motion.div>
    </motion.div>
  );
}

/** Mounted by UiRoot. Renders nothing while no surface (or an unbuilt one) is open. */
export function MenuHost(): ReactElement {
  const open = useUiSelector((state) => state.menus.open);
  let frame: ReactElement | null = null;
  if (open === "requisitions_desk")
    frame = (
      <MenuFrame key={open} surface={open} title={M.desk.title}>
        <RequisitionsDesk />
      </MenuFrame>
    );
  else if (open === "ops_console")
    frame = (
      <MenuFrame key={open} surface={open} title={M.console.title}>
        <OpsConsole />
      </MenuFrame>
    );
  else if (open === "handbook")
    frame = (
      <MenuFrame key={open} surface={open} title={STRINGS.handbook.title}>
        <Handbook />
      </MenuFrame>
    );
  else if (open === "settings")
    frame = (
      <MenuFrame key={open} surface={open} title={M.settings.title}>
        <SettingsPanel />
      </MenuFrame>
    );
  return <AnimatePresence>{frame}</AnimatePresence>;
}
