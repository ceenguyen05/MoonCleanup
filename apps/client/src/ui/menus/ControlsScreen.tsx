// Key rebinding screen (Settings > Controls). Reads and writes the binding table only through `ControlsPort`; capture state
// lives in the UI-local prefs store so the keyboard (React handlers on the button, no window listeners) and the gamepad
// (`UiModule.offerInput`) feed the same `commitCapture`. Native buttons, so keyboard and gamepad menu navigation work in
// DOM / spatial order.

import { useCallback, useRef, useSyncExternalStore, type KeyboardEvent, type ReactElement } from "react";
import { CONTROL_GROUPS, inputLabel, inputsFor, inputsText, type BindingTable, type InputKind } from "./controls-model";
import { formatString, STRINGS } from "../strings";
import { useUiIntents } from "./intents";
import {
  commitCapture,
  useControlsPort,
  useUiPrefs,
  useUiPrefsStore,
  type RemapNote,
  type UiPrefsStore,
} from "./ui-local";
import styles from "./Menus.module.css";

const R = STRINGS.menus.remap;
const ACTION_NAMES = R.actions as Readonly<Record<string, string>>;
const EMPTY_TABLE: BindingTable = {};
const noSubscribe = (): (() => void) => () => undefined;
const emptyTable = (): BindingTable => EMPTY_TABLE;

function actionName(action: string): string {
  return ACTION_NAMES[action] ?? R.otherAction;
}

export function remapNoteText(note: RemapNote): string {
  switch (note.kind) {
    case "bound":
      return formatString(R.notes.bound, { action: actionName(note.action), key: inputLabel(note.code) });
    case "cleared":
      return formatString(R.notes.cleared, { action: actionName(note.action) });
    case "moved":
      return formatString(note.leftUnbound ? R.notes.movedUnbound : R.notes.moved, {
        action: actionName(note.action),
        key: inputLabel(note.code),
        from: actionName(note.from),
      });
    case "reserved":
      return formatString(R.notes.reserved, { key: inputLabel(note.code) });
    case "failed":
      return R.notes.failed;
    case "reset":
      return R.notes.reset;
  }
}

/** Closes the rebinding screen (back to the Settings list) and tells the input layer. */
export function useCloseControls(): () => void {
  const prefs = useUiPrefsStore();
  const intents = useUiIntents();
  return useCallback(() => {
    if (!prefs.getState().controlsOpen) return;
    prefs.setControlsOpen(false);
    intents.openControls(false);
  }, [prefs, intents]);
}

function BindButton({
  action,
  kind,
  codes,
  prefs,
}: {
  action: string;
  kind: InputKind;
  codes: readonly string[];
  prefs: UiPrefsStore;
}): ReactElement {
  const port = useControlsPort();
  const capturing = useUiPrefs((state) => state.capture?.action === action && state.capture.kind === kind);
  const swallowKeyUp = useRef(false);
  const current = inputsText(codes);
  const label = formatString(kind === "key" ? R.changeKey : R.changePad, { action: actionName(action), current });

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!capturing) return;
    if (kind === "pad") {
      if (event.code !== "Escape") return; // pad buttons arrive through UiModule.offerInput
      event.preventDefault();
      event.stopPropagation();
      prefs.setCapture(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation(); // the dialog must not see Escape / Tab / the pressed key
    if (event.repeat) return;
    if (event.code === "Escape") {
      prefs.setCapture(null);
      return;
    }
    swallowKeyUp.current = true;
    commitCapture(prefs, port, event.code);
  };
  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!swallowKeyUp.current) return;
    swallowKeyUp.current = false;
    event.preventDefault(); // Space would otherwise click the button again and restart capture
  };

  return (
    <button
      type="button"
      className={`${styles["bindBtn"]} ${capturing ? styles["bindOn"] : ""}`}
      aria-label={label}
      aria-pressed={capturing}
      data-capturing={capturing || undefined}
      data-testid={`bind-${action}-${kind}`}
      onClick={() => prefs.setCapture(capturing ? null : { action, kind })}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={() => {
        const now = prefs.getState().capture;
        if (now?.action === action && now.kind === kind) prefs.setCapture(null);
      }}
    >
      {capturing ? (kind === "key" ? R.pressKey : R.pressPad) : current}
    </button>
  );
}

export function ControlsScreen(): ReactElement {
  const port = useControlsPort();
  const prefs = useUiPrefsStore();
  const close = useCloseControls();
  const note = useUiPrefs((state) => state.note);
  const table = useSyncExternalStore(
    port?.subscribe ?? noSubscribe,
    port?.table ?? emptyTable,
    port?.table ?? emptyTable,
  );
  const headingRef = useCallback((node: HTMLHeadingElement | null): void => {
    node?.focus({ preventScroll: true });
  }, []);

  return (
    <div className={styles["body"]} data-testid="controls-screen">
      <div className={styles["remapHead"]}>
        <div className={styles["remapIntro"]}>
          <h3 ref={headingRef} tabIndex={-1} className={styles["remapTitle"]}>
            {R.title}
          </h3>
          <p className={styles["subtitle"]}>{R.subtitle}</p>
        </div>
        <div className={styles["remapTools"]}>
          <button type="button" className={styles["buy"]} data-testid="controls-back" onClick={close}>
            {R.back}
          </button>
          <button
            type="button"
            className={styles["buy"]}
            data-testid="controls-reset"
            disabled={port === null}
            onClick={() => {
              port?.reset();
              prefs.setCapture(null);
              prefs.setNote({ kind: "reset" });
            }}
          >
            {R.resetAll}
          </button>
        </div>
      </div>

      <p className={styles["remapNote"]} role="status" aria-live="polite" data-testid="controls-note">
        {port === null ? R.noPort : note === null ? "" : remapNoteText(note)}
      </p>

      {port !== null &&
        CONTROL_GROUPS.map((group) => (
          <section key={group.id} className={styles["group"]} aria-label={R.groups[group.id]}>
            <h4 className={styles["groupTitle"]}>{R.groups[group.id]}</h4>
            <div className={styles["bindHead"]} aria-hidden="true">
              <span />
              <span>{R.keyboard}</span>
              <span>{R.gamepad}</span>
            </div>
            {group.actions.map((action) => {
              const pointer = inputsFor(table, action, "pointer");
              return (
                <div key={action} className={styles["bindRow"]} role="group" aria-label={actionName(action)}>
                  <span className={styles["fieldLabel"]}>{actionName(action)}</span>
                  <span className={styles["bindCell"]}>
                    {pointer.length > 0 && (
                      <span className={styles["bindFixed"]}>{pointer.map(inputLabel).join(" / ")}</span>
                    )}
                    <BindButton action={action} kind="key" codes={inputsFor(table, action, "key")} prefs={prefs} />
                  </span>
                  <span className={styles["bindCell"]}>
                    <BindButton action={action} kind="pad" codes={inputsFor(table, action, "pad")} prefs={prefs} />
                  </span>
                </div>
              );
            })}
          </section>
        ))}
    </div>
  );
}
