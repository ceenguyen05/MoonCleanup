// Purchase rules shared by every item kind (M1-W6-T02): the Rebate price, idempotent replays and race resolution.
//
// Server-side race resolution (security T2, netcode section 2 step 2): purchases are applied one at a time in arrival
// order inside a tick, so the wallet can never be spent twice. A `purchase` intent names an item, not a level, so
// when two members press "buy" on the same levelled item (a board node, a suit-gear line) at about the same time the
// second press would silently buy the next level. The guard refuses it with `pending_other` when a *different* member
// bought that item less than `PURCHASE_RACE_WINDOW_S` ago; the same member buying level after level is never refused.
//
// Replays: a request is idempotent by `requestId` (netcode `purchase`). A completed purchase is remembered per
// (actor, requestId, itemId) in a small ring; the same request again returns the stored outcome without charging,
// changing state or emitting events. Refusals are not remembered: a refused request changed nothing, so evaluating
// it again is harmless.
//
// Neither the ring nor the race window is saved: both are transient and only shape outcomes for a fraction of a
// second. The window is a netcode guard, not a balance value, so it lives here and not in game-data.

/** A different member's purchase of the same levelled item this recently refuses the request (`pending_other`). */
export const PURCHASE_RACE_WINDOW_S = 0.5;
/** Completed purchases remembered for replay detection. */
export const PURCHASE_REPLAY_RING = 64;

/** Price after a discount fraction (Rebate), whole Lumens and never negative. */
export function discountedPriceLm(listLm: number, discountFrac: number): number {
  const d = discountFrac > 0 ? (discountFrac < 1 ? discountFrac : 1) : 0;
  const p = Math.round(listLm * (1 - d));
  return p > 0 ? p : 0;
}

const NEVER = -0x80000000;

/** Race window and replay ring of one room. Items are indexed 0 .. itemCount - 1 by the caller. */
export class PurchaseGuard {
  readonly windowTicks: number;
  private readonly lastTick: Int32Array;
  private readonly lastActor: Int8Array;
  private readonly ringActor = new Int8Array(PURCHASE_REPLAY_RING).fill(-1);
  private readonly ringRequest: string[] = new Array<string>(PURCHASE_REPLAY_RING).fill("");
  private readonly ringItem: string[] = new Array<string>(PURCHASE_REPLAY_RING).fill("");
  private readonly ringWallet = new Float64Array(PURCHASE_REPLAY_RING);
  private ringHead = 0;

  constructor(itemCount: number, tickHz: number) {
    this.windowTicks = Math.max(1, Math.round(PURCHASE_RACE_WINDOW_S * tickHz));
    this.lastTick = new Int32Array(itemCount).fill(NEVER);
    this.lastActor = new Int8Array(itemCount).fill(-1);
  }

  /** Wallet after the remembered completed purchase of this exact request, or -1 when it is not a replay. */
  replayWalletAfter(actor: number, requestId: string, itemId: string): number {
    for (let k = 0; k < PURCHASE_REPLAY_RING; k++) {
      if (this.ringActor[k] === actor && this.ringRequest[k] === requestId && this.ringItem[k] === itemId) {
        return this.ringWallet[k]!;
      }
    }
    return -1;
  }

  /** Remembers a completed purchase for replay detection. */
  remember(actor: number, requestId: string, itemId: string, walletAfter: number): void {
    const k = this.ringHead;
    this.ringActor[k] = actor;
    this.ringRequest[k] = requestId;
    this.ringItem[k] = itemId;
    this.ringWallet[k] = walletAfter;
    this.ringHead = (k + 1) % PURCHASE_REPLAY_RING;
  }

  /** True when a different member bought levelled item `item` less than the race window before `tick`. */
  raced(item: number, actor: number, tick: number): boolean {
    const by = this.lastActor[item]!;
    return by >= 0 && by !== actor && tick - this.lastTick[item]! < this.windowTicks;
  }

  /** Records that `actor` bought a level of item `item` on `tick`. */
  noteBought(item: number, actor: number, tick: number): void {
    this.lastTick[item] = tick;
    this.lastActor[item] = actor;
  }

  /** Forgets every window and replay (checkpoint restore: the restored state starts a new history). */
  reset(): void {
    this.lastTick.fill(NEVER);
    this.lastActor.fill(-1);
    this.ringActor.fill(-1);
    this.ringRequest.fill("");
    this.ringItem.fill("");
    this.ringHead = 0;
  }
}
