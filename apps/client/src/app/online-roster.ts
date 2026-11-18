// Roster port of the online entry UI (M1-W8-T01 hook): the open room's session roster, its change feed and the
// Holder's kick / ban. Reads the app's online room slot at call time, so the port exists in every build (solo pays
// nothing: no room, no session, no listener). The UI subscribes on the on-shift view, i.e. while a room is open; a
// subscription made with no room open is a no-op.

import type { OnlineEntryPort } from "../ui";

// The UI barrel exports the entry port only; the roster types are read off it.
type OnlineRosterPort = NonNullable<OnlineEntryPort["roster"]>;
type RosterRow = ReturnType<OnlineRosterPort["current"]>[number];
type KickReason = Parameters<OnlineRosterPort["kick"]>[1];

/** What the port needs of an open room (`OnlineRoom.session`, structural). */
export interface RosterRoomLike {
  readonly session: {
    roster(): readonly RosterRow[];
    onRoster(listener: (rows: readonly RosterRow[]) => void): () => void;
    sendKick(playerId: string, reasonCode: KickReason, ban?: boolean): boolean;
  };
}

const NO_ROWS: readonly RosterRow[] = Object.freeze([]);

export function createRosterPort(slot: { readonly current: RosterRoomLike | null }): OnlineRosterPort {
  return {
    current: () => slot.current?.session.roster() ?? NO_ROWS,
    subscribe: (listener) => slot.current?.session.onRoster(listener) ?? (() => undefined),
    kick: (playerId, reason, ban) => slot.current?.session.sendKick(playerId, reason, ban) ?? false,
  };
}
