// Roster of the open Private Shift with Holder-only moderation: clock a cleaner out (they may rejoin) or remove them for
// the rest of the shift (two-step confirm). Rows come from the port; the server enforces Holder-only regardless.

import { UserX } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";
import { Icon } from "../icons/Icon";
import { formatString, STRINGS } from "../strings";
import { canModerate, type OnlineRosterPort, type RosterRow } from "./online-model";
import styles from "./OnlinePanel.module.css";

const R = STRINGS.online.onShift.roster;

export function RosterList({ roster }: { readonly roster: OnlineRosterPort }): ReactElement | null {
  const [rows, setRows] = useState<readonly RosterRow[]>(() => roster.current());
  const [confirm, setConfirm] = useState<string | null>(null);
  useEffect(() => {
    setRows(roster.current());
    return roster.subscribe(setRows);
  }, [roster]);
  if (rows.length === 0) return null;
  return (
    <div className={styles["roster"]} data-testid="roster">
      <span className={styles["accountLabel"]}>{R.title}</span>
      <ul className={styles["rosterList"]}>
        {rows.map((row) => {
          const name = row.displayName === "" ? row.playerId.slice(0, 8) : row.displayName;
          const mod = canModerate(rows, row);
          return (
            <li key={row.playerId} className={styles["rosterRow"]} data-testid="roster-row" data-player={row.playerId}>
              <span>
                {name}
                {row.self ? ` (${R.you})` : ""}
                {row.role === "holder" ? ` - ${R.holder}` : ""}
                {row.connected ? "" : ` - ${R.away}`}
              </span>
              {mod && confirm !== row.playerId && (
                <span className={styles["rosterActions"]}>
                  <button
                    type="button"
                    className={styles["ghost"]}
                    data-testid="roster-kick"
                    aria-label={formatString(R.kickLabel, { name })}
                    onClick={() => roster.kick(row.playerId, "other", false)}
                  >
                    {R.kick}
                  </button>
                  <button
                    type="button"
                    className={styles["ghost"]}
                    data-testid="roster-ban"
                    aria-label={formatString(R.banLabel, { name })}
                    onClick={() => setConfirm(row.playerId)}
                  >
                    <Icon icon={UserX} size={16} />
                    {R.ban}
                  </button>
                </span>
              )}
              {mod && confirm === row.playerId && (
                <span className={styles["rosterActions"]}>
                  <button
                    type="button"
                    className={styles["ghost"]}
                    data-testid="roster-ban-confirm"
                    onClick={() => {
                      roster.kick(row.playerId, "other", true);
                      setConfirm(null);
                    }}
                  >
                    {R.confirmBan}
                  </button>
                  <button type="button" className={styles["ghost"]} onClick={() => setConfirm(null)}>
                    {R.cancel}
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
