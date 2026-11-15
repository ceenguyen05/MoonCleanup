// Online entry: the only online-related UI in the main chunk. A small launcher ("Play online") while no online room is
// open, a connection indicator while one is. The panel (sign-in status, Solo / Private Shift, join by code, errors) is
// a lazy chunk fetched on first open, so solo play pays one static button and no per-frame work. Mounted by UiRoot only
// when the app passes an `OnlineEntryPort`; the port is the only road to the online code (dynamic import in the app).

import { Users } from "lucide-react";
import { lazy, Suspense, useCallback, useRef, useState, type ReactElement } from "react";
import { Icon } from "../icons/Icon";
import { STRINGS } from "../strings";
import { useUiSelector } from "../ui-context";
import { ConnGlyph } from "./ConnGlyph";
import styles from "./OnlineEntry.module.css";
import { connView, failureOfCloseCode, isOnlineActive, type OnlineEntryPort } from "./online-model";

const OnlinePanel = lazy(() => import("./OnlinePanel"));

const T = STRINGS.online;

export function OnlineEntry({ port }: { readonly port: OnlineEntryPort }): ReactElement {
  const conn = useUiSelector((state) => state.session.conn);
  const rttMs = useUiSelector((state) => state.session.rttMs);
  const closeCode = useUiSelector((state) => state.session.closeCode);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const active = isOnlineActive(conn);
  const view = connView(conn, rttMs);
  const lostReason = conn === "lost" ? failureOfCloseCode(closeCode) : null;

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const connLabel = T.conn[view.label];
  const rttText = conn === "connected" && rttMs !== null ? `${Math.round(rttMs)} ${T.conn.rtt}` : null;

  return (
    <>
      <div className={styles["dock"]}>
        {active ? (
          <button
            ref={triggerRef}
            type="button"
            className={styles["chip"]}
            data-testid="online-chip"
            data-conn={conn}
            data-tone={view.tone}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={`${T.conn.label}: ${connLabel}${rttText === null ? "" : `, ${rttText}`}`}
            onClick={() => setOpen(true)}
          >
            <ConnGlyph shape={view.shape} className={styles["glyph"] ?? ""} />
            <span className={styles["chipLabel"]}>{connLabel}</span>
            {rttText !== null && <span className={styles["rtt"]}>{rttText}</span>}
            {view.tone === "warn" && <span className={styles["rtt"]}>{T.conn.slow}</span>}
          </button>
        ) : (
          <button
            ref={triggerRef}
            type="button"
            className={styles["launcher"]}
            data-testid="online-launcher"
            aria-haspopup="dialog"
            aria-expanded={open}
            title={T.launcherHint}
            onClick={() => setOpen(true)}
          >
            <Icon icon={Users} size={20} />
            <span>{T.launcher}</span>
          </button>
        )}
        <div className={styles["reason"]} role="status" aria-live="polite" aria-label={T.a11y.status}>
          {lostReason !== null && <span data-testid="online-lost-reason">{T.errors[lostReason]}</span>}
        </div>
      </div>
      {open && (
        <Suspense fallback={null}>
          <OnlinePanel port={port} onClose={close} />
        </Suspense>
      )}
    </>
  );
}
