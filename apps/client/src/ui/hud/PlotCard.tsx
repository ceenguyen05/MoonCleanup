// Plot Card overlay (HUD): the plot under the reticle. Reads the `plotCard` slice (gameplay writes it while the player
// inspects a plot) and `roster` for the credited name. State is a word plus a distinct glyph, colour is secondary
// (Grimy umber / Opened cyan / Polished ivory).

import { Check, CircleDashed, CircleDot, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, type ReactElement } from "react";
import { GlassPanel } from "../components/GlassPanel";
import { Icon, type IconComponent } from "../icons/Icon";
import { fadeTransition } from "../motion/presets";
import { formatString, STRINGS } from "../strings";
import { useReducedMotion, useSpring, useUiSelector } from "../ui-context";
import { percent } from "./hud-model";
import styles from "./Compass.module.css";

const P = STRINGS.menus.plotCard;
const STATE_ICON: Readonly<Record<number, IconComponent>> = {
  0: CircleDashed,
  1: CircleDot,
  2: Check,
  3: Sparkles,
};

export const PlotCard = memo(function PlotCard(): ReactElement {
  const card = useUiSelector((state) => state.plotCard);
  const players = useUiSelector((state) => state.roster.players);
  const reduced = useReducedMotion();
  const spring = useSpring("ui");
  const stateName = card.state === null ? null : ((P.states as Readonly<Record<number, string>>)[card.state] ?? null);
  const terrain =
    card.terrainId === null ? null : ((P.terrains as Readonly<Record<string, string>>)[card.terrainId] ?? null);
  const credited = card.creditedSlot === null ? null : players.find((player) => player.slot === card.creditedSlot);
  const show = card.open && card.state !== null && stateName !== null;
  const remaining = percent(card.remainingPct / 100);
  return (
    <AnimatePresence>
      {show && card.state !== null && (
        <motion.div
          key="plot-card"
          initial={reduced ? { opacity: 0 } : { opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, transition: fadeTransition("out", reduced) }}
          transition={spring}
        >
          <GlassPanel as="section" className={styles["plot"] ?? ""} aria-label={P.region} data-testid="hud-plot-card">
            <span className={styles["plotHead"]}>
              <span className={styles["swatch"]} data-state={card.state}>
                <Icon icon={STATE_ICON[card.state] ?? CircleDashed} size={16} />
              </span>
              <span>{formatString(P.plot, { label: card.label })}</span>
            </span>
            <p className={styles["plotLine"]}>{terrain === null ? stateName : `${stateName} · ${terrain}`}</p>
            <span
              className={styles["plotMeter"]}
              role="progressbar"
              aria-label={formatString(P.remaining, { pct: remaining })}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={remaining}
            >
              <span className={styles["plotFill"]} style={{ transform: `scaleX(${remaining / 100})` }} />
            </span>
            <p className={styles["plotLine"]}>{formatString(P.remaining, { pct: remaining })}</p>
            {credited != null && (
              <p className={styles["plotLine"]}>{formatString(P.creditedTo, { name: credited.name })}</p>
            )}
          </GlassPanel>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
