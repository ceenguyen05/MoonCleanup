// Settings > Save and sync: where progress is right now (the same sentence the indicator abbreviates), why the cloud
// copy is paused if it is, the way back into a postponed "Which copy?" prompt, and the backup slot with a confirmed
// restore. Restoring replaces current progress, so it takes two steps (Restore, then "Restore now") and focus lands on
// the SAFE button of the confirmation. Everything goes through the store (`saveSync.restoreBackup`); native buttons only,
// so keyboard and gamepad navigation work in DOM / spatial order.

import { useEffect, useRef, useState, type ReactElement } from "react";
import { useUiPrefsStore } from "../menus/ui-local";
import { formatString, STRINGS } from "../strings";
import { useUi, useUiSelector } from "../ui-context";
import { errorText, formatAge, formatDate, hasConflict, indicatorView } from "./save-sync-model";
import { SyncGlyph } from "./SyncGlyph";
import { useNow } from "./use-now";
import menus from "../menus/Menus.module.css";
import styles from "./SaveSettings.module.css";

const S = STRINGS.saveSync;
const SENT_MS = 8_000;

export function SaveSettings(): ReactElement {
  const { store } = useUi();
  const prefs = useUiPrefsStore();
  const save = useUiSelector((state) => state.saveSync);
  const nowMs = useNow(30_000);
  const [confirming, setConfirming] = useState(false);
  const [sent, setSent] = useState(false);
  const restoreRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const view = indicatorView(save.state);
  const error = errorText(save);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus({ preventScroll: true });
  }, [confirming]);
  // The slot emptying (the restore went through, or the 7 days ran out) ends any open confirmation.
  useEffect(() => {
    if (!save.backupAvailable) setConfirming(false);
  }, [save.backupAvailable]);
  useEffect(() => {
    if (!sent) return undefined;
    const id = window.setTimeout(() => setSent(false), SENT_MS);
    return () => window.clearTimeout(id);
  }, [sent]);

  const ageLine =
    save.pendingSinceMs !== null && (save.state === "pending" || save.state === "offline" || save.state === "error")
      ? formatString(S.pendingSince, { age: formatAge(save.pendingSinceMs, nowMs) })
      : save.lastSyncedAtMs !== null
        ? formatString(S.lastSynced, { age: formatAge(save.lastSyncedAtMs, nowMs) })
        : S.neverSynced;

  return (
    <section className={menus["group"]} aria-label={S.settings.group} data-testid="settings-save">
      <h3 className={menus["groupTitle"]}>{S.settings.group}</h3>

      <div className={styles["status"]} role="status" aria-live="polite" data-testid="settings-save-status">
        <span className={styles["statusGlyph"]}>
          <SyncGlyph glyph={view.glyph} size={24} />
        </span>
        <span className={styles["statusBody"]}>
          <span className={styles["statusText"]}>{view.text}</span>
          <span className={menus["rowBlurb"]} data-testid="settings-save-age">
            {ageLine}
          </span>
          {error !== null && (
            <span className={styles["problem"]} data-testid="settings-save-error">
              {error}
            </span>
          )}
          {save.storageWarning !== null && (
            <span className={styles["problem"]} data-testid="settings-save-storage">
              {S.storageWarnings[save.storageWarning]}
            </span>
          )}
        </span>
      </div>

      {hasConflict(save) && (
        <div className={menus["field"]}>
          <span className={menus["fieldLabel"]}>
            {S.settings.reopenPrompt}
            <span className={menus["rowBlurb"]}>{S.settings.reopenHint}</span>
          </span>
          <button
            type="button"
            className={`${menus["buy"]} ${menus["buyReady"]}`}
            data-testid="settings-save-reopen"
            onClick={() => prefs.setSavePromptDismissed(false)}
          >
            {S.settings.reopenPrompt}
          </button>
        </div>
      )}

      <div className={menus["field"]} data-testid="settings-save-backup">
        <span className={menus["fieldLabel"]}>
          {S.settings.backupTitle}
          <span className={menus["rowBlurb"]}>
            {save.backupAvailable
              ? save.backupExpiresAtMs !== null
                ? formatString(S.settings.backupHint, { date: formatDate(save.backupExpiresAtMs) })
                : S.settings.backupHintNoDate
              : S.settings.backupNone}
          </span>
        </span>
        {save.backupAvailable && !confirming && (
          <button
            ref={restoreRef}
            type="button"
            className={`${menus["buy"]} ${menus["buyReady"]}`}
            id="mc-settings-restore"
            data-testid="settings-save-restore"
            onClick={() => setConfirming(true)}
          >
            {S.settings.restore}
          </button>
        )}
      </div>

      {save.backupAvailable && confirming && (
        <div
          className={styles["confirm"]}
          role="alertdialog"
          aria-label={S.settings.restore}
          data-testid="settings-save-confirm"
        >
          <p className={styles["confirmText"]}>{S.settings.restoreWarn}</p>
          <div className={styles["confirmActions"]}>
            <button
              ref={cancelRef}
              type="button"
              className={`${menus["buy"]} ${menus["buyReady"]}`}
              data-testid="settings-save-restore-cancel"
              onClick={() => {
                setConfirming(false);
                window.requestAnimationFrame(() => restoreRef.current?.focus({ preventScroll: true }));
              }}
            >
              {S.settings.restoreCancel}
            </button>
            <button
              type="button"
              className={styles["danger"]}
              data-testid="settings-save-restore-confirm"
              onClick={() => {
                setConfirming(false);
                setSent(true);
                store.dispatch({ type: "saveSync.restoreBackup" });
                window.requestAnimationFrame(() => restoreRef.current?.focus({ preventScroll: true }));
              }}
            >
              {S.settings.restoreConfirm}
            </button>
          </div>
        </div>
      )}
      <p className={styles["sent"]} role="status" aria-live="polite" data-testid="settings-save-sent">
        {sent ? S.settings.restoreSent : ""}
      </p>
    </section>
  );
}
