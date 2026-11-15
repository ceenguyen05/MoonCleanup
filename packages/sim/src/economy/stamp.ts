// Inspector's Stamp payout (progression-and-economy section "Plot credit and the Stamp"; WDS section 4.7). A plot
// that reaches Polished pays Lumens into the shift wallet; the residual dust is never paid as dust.
//
//   player-credited plot:  base x Stamp Premium (by level) x Charge finish (the last dust fell to a Charge tool)
//   Flock / shift credit:  base, or base x Stamp Premium once Golden Handshake extends the premium to those plots
//
// Every number comes from game-data `plot-bonus.json` through SimConfig. The result is rounded to whole Lumens
// (x1.5 twice on 50 gives 112.5): the wallet stays integral, like tool prices.

import type { SimConfig } from "../config/sim-config";

/** The part of SimConfig the Stamp reads. */
export type StampRules = Pick<SimConfig, "stampBaseLm" | "stampPremiumMult" | "chargeFinishMult">;

export interface StampInput {
  /** A player holds the plot's credit (false: the shift / Flock). */
  readonly playerCredited: boolean;
  /** The stroke that finished the plot came from a Charge tool. */
  readonly chargeFinish: boolean;
  /** Stamp Premium level bought on the Promotions Board: 0 = none, 1 .. stampPremiumMult.length. */
  readonly premiumLevel: number;
  /** Golden Handshake: the Stamp Premium multiplier also applies to plots without a player credit. */
  readonly premiumOnFlock: boolean;
}

/** True when the Charge finish multiplier is part of the payout (the "Charged" tag of the Stamp). */
export function stampIsCharged(input: StampInput): boolean {
  return input.playerCredited && input.chargeFinish;
}

/** Lumens paid for one Inspector's Stamp, whole and never negative. */
export function stampPayoutLm(rules: StampRules, input: StampInput): number {
  let lm = rules.stampBaseLm;
  if (input.playerCredited || input.premiumOnFlock) {
    const levels = rules.stampPremiumMult.length;
    const level = input.premiumLevel > levels ? levels : Math.floor(input.premiumLevel);
    if (level >= 1) lm *= rules.stampPremiumMult[level - 1]!;
  }
  if (stampIsCharged(input)) lm *= rules.chargeFinishMult;
  return lm > 0 ? Math.round(lm) : 0;
}
