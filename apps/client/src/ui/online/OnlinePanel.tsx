// The online panel (lazy chunk): sign-in status, Solo vs Private Shift, start / join by code or Contract id, connection
// status while on shift, and plain-language errors. Keyboard: Tab is trapped in the dialog, Escape closes, Enter submits
// the focused form; every control is a native button or input (gamepad focus navigation walks them in DOM order).

import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Check, Copy, Link2, LogOut, TriangleAlert, User, Users, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { GlassPanel } from "../components/GlassPanel";
import { Icon } from "../icons/Icon";
import { fadeTransition } from "../motion/presets";
import { formatString, STRINGS } from "../strings";
import { useReducedMotion, useSpring, useUiSelector } from "../ui-context";
import { ConnGlyph } from "./ConnGlyph";
import { copyText, inviteUrl } from "./clipboard";
import { runOnlineEntry, type OnlineIntent } from "./online-flow";
import {
  connView,
  groupCode,
  OPEN_STALL_MS,
  spellCode,
  type OnlineEntryPort,
  type OnlineFailure,
} from "./online-model";
import styles from "./OnlinePanel.module.css";
import { initialPanelState, panelReducer } from "./panel-model";
import { RosterList } from "./RosterList";

const T = STRINGS.online;
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export interface OnlinePanelProps {
  readonly port: OnlineEntryPort;
  readonly onClose: () => void;
  /** Canonical invite code from a link: opens on the join form with the code filled in (never auto-redeemed). */
  readonly initialInvite?: string;
}

function ErrorLine({ failure }: { readonly failure: OnlineFailure }): ReactElement {
  const base = T.errors[failure.key];
  const text = failure.retryAfterS > 0 ? `${base} ${formatString(T.retryIn, { seconds: failure.retryAfterS })}` : base;
  return (
    <p className={styles["error"]} role="alert" data-testid="online-error" data-error={failure.key}>
      <Icon icon={TriangleAlert} size={20} className={styles["errorIcon"] ?? ""} />
      <span>{text}</span>
    </p>
  );
}

export default function OnlinePanel({ port, onClose, initialInvite }: OnlinePanelProps): ReactElement {
  const conn = useUiSelector((state) => state.session.conn);
  const rttMs = useUiSelector((state) => state.session.rttMs);
  const storeInvite = useUiSelector((state) => state.shift.inviteCode);
  const reduced = useReducedMotion();
  const spring = useSpring("ui");
  const [state, dispatch] = useReducer(panelReducer, conn !== "asleep", (active) =>
    initialPanelState(active, initialInvite !== undefined),
  );
  const [name, setName] = useState<string>(T.nameDefault);
  const [code, setCode] = useState(initialInvite === undefined ? "" : groupCode(initialInvite));
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const aliveRef = useRef(true);
  const titleId = useId();
  const nameHintId = useId();
  const codeHintId = useId();

  // Sign-in status: read once when the panel opens (the lazy auth source is loaded only because the player asked).
  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;
    port.auth().then(
      (auth) => {
        if (!cancelled) setSignedIn(auth.signedIn);
      },
      () => {
        if (!cancelled) setSignedIn(false);
      },
    );
    return () => {
      cancelled = true;
      aliveRef.current = false;
    };
  }, [port]);

  // Restore focus to whatever opened the panel; announce each view by focusing its heading.
  const openerRef = useRef<Element | null>(null);
  useEffect(() => {
    openerRef.current = document.activeElement;
  }, []);
  // The heading is focused by its callback ref when it mounts: with `AnimatePresence mode="wait"` the new view mounts
  // after the old one has faded out, so an effect keyed on `state.view` would focus the leaving heading and drop focus
  // to <body> (keys then reach the game).
  const setHeading = useCallback((node: HTMLHeadingElement | null): void => {
    headingRef.current = node;
    node?.focus({ preventScroll: true });
  }, []);

  // `open` never throws and leaves the store at `asleep` when the online chunk could not start: report that as stalled.
  const stallTimer = useRef<number | null>(null);
  const armStall = useCallback(() => {
    if (stallTimer.current !== null) window.clearTimeout(stallTimer.current);
    stallTimer.current = window.setTimeout(() => {
      stallTimer.current = null;
      if (aliveRef.current) dispatch({ type: "stalled" });
    }, OPEN_STALL_MS);
  }, []);
  useEffect(() => {
    if (conn !== "asleep" && stallTimer.current !== null) {
      window.clearTimeout(stallTimer.current);
      stallTimer.current = null;
    }
  }, [conn]);
  useEffect(
    () => () => {
      if (stallTimer.current !== null) window.clearTimeout(stallTimer.current);
    },
    [],
  );

  const run = useCallback(
    async (intent: OnlineIntent): Promise<void> => {
      dispatch({ type: "busy", stage: "signin" });
      const result = await runOnlineEntry(intent, {
        port,
        onStage: (stage) => {
          if (aliveRef.current) dispatch({ type: "busy", stage });
        },
      });
      if (!aliveRef.current && !result.ok) return;
      if (aliveRef.current) {
        dispatch({ type: "result", result });
        if (result.ok) {
          setSignedIn(true);
          armStall();
        }
      }
    },
    [port, armStall],
  );

  const onStart = (event: FormEvent): void => {
    event.preventDefault();
    if (state.busy === null) void run({ kind: "create", name: name.trim() });
  };
  const onJoin = (event: FormEvent): void => {
    event.preventDefault();
    if (state.busy === null) void run({ kind: "join", raw: code });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    event.stopPropagation(); // the game must not see typing or Enter / Space on panel controls
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (nodes === undefined || nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (first === undefined || last === undefined) return;
    const current = document.activeElement;
    if (event.shiftKey && (current === first || current === headingRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const copy = (value: string, what: "code" | "link"): void => {
    void copyText(value).then((ok) => {
      if (!ok || !aliveRef.current) return;
      setCopied(what);
      window.setTimeout(() => {
        if (aliveRef.current) setCopied(null);
      }, 2000);
    });
  };
  const copyLink = (code: string): void => copy(inviteUrl(window.location.origin, code), "link");
  const linkButton = (code: string): ReactElement => (
    <button type="button" className={styles["ghost"]} data-testid="copy-invite-link" onClick={() => copyLink(code)}>
      <Icon icon={copied === "link" ? Check : Link2} size={16} />
      {copied === "link" ? T.created.copied : T.created.copyLink}
    </button>
  );

  const leave = (): void => {
    port.close();
    dispatch({ type: "go", view: "choose" });
  };

  const busy = state.busy !== null;
  const view = connView(conn, rttMs);
  const heading = (text: string): ReactElement => (
    <h2 id={titleId} ref={setHeading} tabIndex={-1} className={styles["title"]}>
      {text}
    </h2>
  );

  const accountText = signedIn === null ? T.account.checking : signedIn ? T.account.signedIn : T.account.signedOut;
  const account = (
    <p className={styles["account"]} data-testid="online-account" data-signed-in={String(signedIn)}>
      <span className={styles["accountLabel"]}>{T.account.label}</span>
      <span>{accountText}</span>
    </p>
  );
  const busyLine = (
    <p className={styles["busy"]} role="status" aria-live="polite" data-testid="online-busy">
      {state.busy === null ? "" : T.working[state.busy]}
    </p>
  );

  const invite = state.inviteCode ?? storeInvite;

  return (
    <motion.div
      className={styles["scrim"]}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: fadeTransition("in", reduced) }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        className={`${styles["stage"] ?? ""} ${state.view === "private" ? (styles["stageWide"] ?? "") : ""}`}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
      >
        <GlassPanel
          strong
          as="section"
          className={styles["panel"]}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          data-testid="online-panel"
          data-view={state.view}
        >
          <div ref={rootRef} className={styles["body"]} onKeyDown={onKeyDown} onKeyUp={(e) => e.stopPropagation()}>
            <button type="button" className={styles["closeButton"]} onClick={onClose} aria-label={T.close}>
              <Icon icon={X} size={20} />
            </button>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={state.view}
                className={styles["view"]}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: fadeTransition("in", reduced) }}
                exit={{ opacity: 0, transition: fadeTransition("out", reduced) }}
              >
                {state.view === "choose" && (
                  <>
                    {heading(T.panelTitle)}
                    <p className={styles["lead"]}>{T.panelLead}</p>
                    {account}
                    <div className={styles["choices"]}>
                      <button type="button" className={styles["choice"]} data-testid="choose-solo" onClick={onClose}>
                        <Icon icon={User} size={24} />
                        <span className={styles["choiceTitle"]}>{T.solo}</span>
                        <span className={styles["choiceBody"]}>{T.soloBody}</span>
                      </button>
                      <button
                        type="button"
                        className={styles["choice"]}
                        data-testid="choose-private"
                        onClick={() => dispatch({ type: "go", view: "private" })}
                      >
                        <Icon icon={Users} size={24} />
                        <span className={styles["choiceTitle"]}>{T.private}</span>
                        <span className={styles["choiceBody"]}>{T.privateBody}</span>
                      </button>
                    </div>
                  </>
                )}

                {state.view === "private" && (
                  <>
                    {heading(T.private)}
                    {account}
                    <div className={styles["split"]}>
                      <form className={styles["section"]} onSubmit={onStart} noValidate>
                        <h3 className={styles["sectionTitle"]}>{T.startTitle}</h3>
                        <label className={styles["label"]}>
                          {T.nameLabel}
                          <input
                            className={styles["input"]}
                            type="text"
                            value={name}
                            maxLength={32}
                            autoComplete="off"
                            spellCheck={false}
                            readOnly={busy}
                            aria-describedby={nameHintId}
                            onChange={(e) => setName(e.target.value)}
                          />
                        </label>
                        <p id={nameHintId} className={styles["hint"]}>
                          {T.nameHint}
                        </p>
                        <button
                          type="submit"
                          className={styles["primary"]}
                          aria-disabled={busy}
                          data-testid="start-private"
                        >
                          {T.start}
                        </button>
                      </form>
                      <p className={styles["or"]} aria-hidden="true">
                        <span>{T.or}</span>
                      </p>
                      <form className={styles["section"]} onSubmit={onJoin} noValidate>
                        <h3 className={styles["sectionTitle"]}>{T.joinTitle}</h3>
                        <label className={styles["label"]}>
                          {T.codeLabel}
                          <input
                            className={`${styles["input"] ?? ""} ${styles["codeInput"] ?? ""}`}
                            type="text"
                            value={code}
                            maxLength={40}
                            autoComplete="off"
                            autoCapitalize="characters"
                            spellCheck={false}
                            placeholder={T.codePlaceholder}
                            readOnly={busy}
                            aria-invalid={state.error?.key === "badCode" || state.error?.key === "notFound"}
                            aria-describedby={codeHintId}
                            data-testid="join-code"
                            onChange={(e) => {
                              setCode(e.target.value);
                              dispatch({ type: "clearError" });
                            }}
                          />
                        </label>
                        <p id={codeHintId} className={styles["hint"]}>
                          {T.codeHint}
                        </p>
                        <button
                          type="submit"
                          className={styles["primary"]}
                          aria-disabled={busy}
                          data-testid="join-private"
                        >
                          {T.join}
                        </button>
                      </form>
                    </div>
                    {busyLine}
                    {state.error !== null && <ErrorLine failure={state.error} />}
                    <div className={styles["footer"]}>
                      <button
                        type="button"
                        className={styles["ghost"]}
                        aria-disabled={busy}
                        onClick={() => {
                          if (!busy) dispatch({ type: "go", view: "choose" });
                        }}
                      >
                        <Icon icon={ArrowLeft} size={16} />
                        {T.back}
                      </button>
                    </div>
                  </>
                )}

                {state.view === "recovery" && state.recoveryCode !== null && (
                  <>
                    {heading(T.recovery.title)}
                    <p className={styles["lead"]}>{T.recovery.body}</p>
                    <p className={styles["codeBox"]} data-testid="recovery-code">
                      {state.recoveryCode}
                    </p>
                    <div className={styles["footer"]}>
                      <button
                        type="button"
                        className={styles["ghost"]}
                        onClick={() => copy(state.recoveryCode ?? "", "code")}
                      >
                        <Icon icon={copied === "code" ? Check : Copy} size={16} />
                        {copied === "code" ? T.created.copied : T.created.copy}
                      </button>
                      <button
                        type="button"
                        className={styles["primary"]}
                        data-testid="recovery-confirm"
                        onClick={() => dispatch({ type: "recoveryConfirmed" })}
                      >
                        {T.recovery.confirm}
                      </button>
                    </div>
                  </>
                )}

                {state.view === "created" && state.inviteCode !== null && (
                  <>
                    {heading(T.created.title)}
                    <p className={styles["lead"]}>{T.created.body}</p>
                    <p
                      className={styles["codeBox"]}
                      role="img"
                      aria-label={`${T.a11y.spelledCode}: ${spellCode(state.inviteCode)}`}
                      data-testid="invite-code"
                    >
                      {groupCode(state.inviteCode)}
                    </p>
                    <div className={styles["footer"]}>
                      <button
                        type="button"
                        className={styles["ghost"]}
                        onClick={() => copy(state.inviteCode ?? "", "code")}
                      >
                        <Icon icon={copied === "code" ? Check : Copy} size={16} />
                        {copied === "code" ? T.created.copied : T.created.copy}
                      </button>
                      {linkButton(state.inviteCode)}
                      <button type="button" className={styles["primary"]} onClick={onClose} data-testid="created-done">
                        {T.created.done}
                      </button>
                    </div>
                  </>
                )}

                {state.view === "onShift" && (
                  <>
                    {heading(T.onShift.title)}
                    <p className={styles["connLine"]} data-testid="online-conn" data-conn={conn} data-tone={view.tone}>
                      <ConnGlyph shape={view.shape} className={styles["glyph"] ?? ""} />
                      <span>{T.conn[view.label]}</span>
                      {conn === "connected" && rttMs !== null && (
                        <span className={styles["rtt"]}>{`${Math.round(rttMs)} ${T.conn.rtt}`}</span>
                      )}
                    </p>
                    {invite !== null ? (
                      <div className={styles["inviteRow"]}>
                        <span className={styles["accountLabel"]}>{T.onShift.inviteLabel}</span>
                        <span
                          className={styles["inviteCode"]}
                          role="img"
                          aria-label={`${T.a11y.spelledCode}: ${spellCode(invite)}`}
                        >
                          {groupCode(invite)}
                        </span>
                        <button type="button" className={styles["ghost"]} onClick={() => copy(invite, "code")}>
                          <Icon icon={copied === "code" ? Check : Copy} size={16} />
                          {copied === "code" ? T.created.copied : T.created.copy}
                        </button>
                        {linkButton(invite)}
                      </div>
                    ) : (
                      <p className={styles["lead"]}>{T.onShift.none}</p>
                    )}
                    {port.roster !== undefined && <RosterList roster={port.roster} />}
                    {state.error !== null && <ErrorLine failure={state.error} />}
                    <div className={styles["footer"]}>
                      <button type="button" className={styles["ghost"]} onClick={leave} data-testid="leave-shift">
                        <Icon icon={LogOut} size={16} />
                        {T.onShift.leave}
                      </button>
                      <button type="button" className={styles["primary"]} onClick={onClose}>
                        {T.close}
                      </button>
                    </div>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </GlassPanel>
      </motion.div>
    </motion.div>
  );
}
