// The in-game HUD (M1-W6-T04): Lumens wallet, Shine, Holster with Dust Cell gauges, suit readouts (Crown Lamp, Hop, day
// ring), Next Requisition tracker, interaction prompt and DOT notices. Display only: every value comes from the typed UI
// store (`useUiSelector` on whole slices, so a flush that did not touch a slice re-renders nothing) and the writers
// (gameplay, net) own the numbers. No per-frame work: React renders only when a slice object changes (store flush, at
// most 15 Hz); the Lumens count-up and the bars animate locally with transform / opacity only.

import { AnimatePresence, motion } from "motion/react";
import { Brush, Eraser, Lamp, Moon, Rocket, Sun } from "lucide-react";
import { memo, useEffect, useRef, useState, type ReactElement } from "react";
import type { UiHolsterSlot, UiNotice } from "@moon-cleanup/shared";
import { GlassPanel } from "../components/GlassPanel";
import { TickNumber } from "../components/TickNumber";
import toastStyles from "../components/ToastStack.module.css";
import { DustCellIcon, LumenIcon, ShineIcon } from "../icons/custom";
import { Icon, type IconComponent } from "../icons/Icon";
import { EASE, fadeTransition } from "../motion/presets";
import { SyncIndicator } from "../save/SyncIndicator";
import { formatString, STRINGS } from "../strings";
import { useReducedMotion, useSpring, useUi, useUiSelector } from "../ui-context";
import {
  cellFraction,
  dayText,
  floaterOf,
  formatLm,
  formatShinePct,
  noticeText,
  percent,
  promptText,
  slotLabel,
  toolName,
  type WalletFloater,
} from "./hud-model";
import { AchievementToasts } from "../onboarding/AchievementToasts";
import { DotSubtitle } from "../onboarding/DotSubtitle";
import { InductionChecklist } from "../onboarding/InductionChecklist";
import { CompassStrip } from "./CompassStrip";
import { PlotCard } from "./PlotCard";
import styles from "./Hud.module.css";

const TOOL_ICON: Readonly<Record<string, IconComponent>> = {
  "tool.desk_duster": Brush,
  "tool.crescent_squeegee": Eraser,
};

const FLOATER_MS = 950;

const Wallet = memo(function Wallet(): ReactElement {
  const lm = useUiSelector((state) => state.wallet.lm);
  const newest = useUiSelector((state) => state.wallet.lastDeltas[state.wallet.lastDeltas.length - 1]);
  const reduced = useReducedMotion();
  const [floaters, setFloaters] = useState<readonly WalletFloater[]>([]);
  const lastKey = useRef<string | null>(floaterOf(newest)?.key ?? null);

  useEffect(() => {
    const floater = floaterOf(newest);
    if (floater === null || floater.key === lastKey.current) return undefined;
    lastKey.current = floater.key;
    if (reduced) return undefined;
    setFloaters((list) => [...list.slice(-2), floater]);
    const id = window.setTimeout(
      () => setFloaters((list) => list.filter((item) => item.key !== floater.key)),
      FLOATER_MS,
    );
    return () => window.clearTimeout(id);
  }, [newest, reduced]);

  return (
    <GlassPanel
      as="section"
      className={styles["wallet"]}
      aria-label={`${STRINGS.hud.lumensLabel}: ${formatLm(lm)} ${STRINGS.hud.lumens}`}
      data-testid="hud-wallet"
    >
      <span className={styles["walletIcon"]}>
        <Icon icon={LumenIcon} size={32} />
      </span>
      <div className={styles["walletBody"]} aria-hidden="true">
        <span className={styles["caption"]}>{STRINGS.hud.lumensLabel}</span>
        <span className={styles["walletValue"]}>
          <TickNumber value={lm} />
          <span className={styles["unit"]}>{STRINGS.hud.lumens}</span>
        </span>
        <span className={styles["floaters"]}>
          <AnimatePresence>
            {floaters.map((floater) => (
              <motion.span
                key={floater.key}
                className={`${styles["floater"]} ${floater.gain ? "" : styles["floaterSpend"]}`}
                initial={{ opacity: 0, y: 0 }}
                animate={{ opacity: [0, 1, 1, 0], y: -24 }}
                transition={{ duration: FLOATER_MS / 1000, ease: [...EASE.outCubic], times: [0, 0.15, 0.7, 1] }}
              >
                {floater.text}
              </motion.span>
            ))}
          </AnimatePresence>
        </span>
      </div>
    </GlassPanel>
  );
});

const NextRequisition = memo(function NextRequisition(): ReactElement | null {
  const next = useUiSelector((state) => state.nextReq);
  const name = toolName(next.itemId);
  if (next.itemId === null || name === null) return null;
  const funded = percent(next.fundedPct / 100);
  return (
    <GlassPanel as="section" className={styles["next"]} aria-label={STRINGS.hud.nextRequisition} data-testid="hud-next">
      <span className={styles["caption"]}>{STRINGS.hud.nextRequisition}</span>
      <span className={styles["nextName"]}>{name}</span>
      <span
        className={styles["meter"]}
        role="progressbar"
        aria-label={formatString(STRINGS.hud.nextRequisitionValue, { funded, price: formatLm(next.priceLm) })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={funded}
      >
        <span className={styles["meterFill"]} style={{ transform: `scaleX(${funded / 100})` }} />
      </span>
      <span className={styles["nextFoot"]}>
        {funded}% · {formatLm(next.priceLm)} {STRINGS.hud.lumens}
      </span>
    </GlassPanel>
  );
});

const ShinePanel = memo(function ShinePanel(): ReactElement {
  const shine = useUiSelector((state) => state.shine);
  const pct = formatShinePct(shine.pct);
  return (
    <GlassPanel
      as="section"
      className={styles["shine"]}
      aria-label={formatString(STRINGS.hud.shineValue, {
        pct: shine.pct.toFixed(4),
        polished: formatLm(shine.polished),
        total: formatLm(shine.total),
      })}
      data-testid="hud-shine"
    >
      <span className={styles["shineHead"]}>
        <Icon icon={ShineIcon} size={20} />
        <span className={styles["caption"]}>{STRINGS.hud.shine}</span>
      </span>
      <span className={styles["shineValue"]} aria-hidden="true">
        <TickNumber value={shine.pct} format={formatShinePct} flash={false} />
      </span>
      <span
        className={styles["meter"]}
        role="progressbar"
        aria-label={STRINGS.hud.shine}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Number(pct.slice(0, -1))}
      >
        <span className={styles["meterFill"]} style={{ transform: `scaleX(${Math.min(1, shine.pct / 100)})` }} />
      </span>
    </GlassPanel>
  );
});

function SlotView({ slot, index, active }: { slot: UiHolsterSlot; index: number; active: boolean }): ReactElement {
  const name = toolName(slot.toolId);
  const filled = name !== null && slot.owned;
  const cell = percent(cellFraction(slot));
  const IconFor = (slot.toolId !== null ? TOOL_ICON[slot.toolId] : undefined) ?? Brush;
  return (
    <li
      className={`${styles["slot"]} ${active ? styles["slotActive"] : ""} ${filled ? "" : styles["slotEmpty"]}`}
      aria-label={slotLabel(slot, index, active)}
      aria-current={active ? "true" : undefined}
      data-active={active}
    >
      <span className={styles["slotKey"]} aria-hidden="true">
        {index + 1}
      </span>
      {filled && <Icon icon={IconFor} size={active ? 32 : 24} />}
      <span className={styles["slotName"]} aria-hidden="true">
        {filled && active ? name : ""}
      </span>
      {filled && (
        <span className={styles["cell"]} aria-hidden="true">
          <Icon icon={DustCellIcon} size={16} />
          <span className={styles["cellBar"]}>
            <span className={styles["cellFill"]} style={{ transform: `scaleX(${cell / 100})` }} />
          </span>
          <span className={styles["cellPct"]}>{cell}%</span>
        </span>
      )}
    </li>
  );
}

const Holster = memo(function Holster(): ReactElement | null {
  const holster = useUiSelector((state) => state.holster);
  if (holster.slots.length === 0) return null;
  return (
    <GlassPanel as="aside" aria-label={STRINGS.hud.holster} className={styles["holster"]} data-testid="hud-holster">
      <ul className={styles["slots"]}>
        {holster.slots.slice(0, holster.slotCount).map((slot, index) => (
          <SlotView key={index} slot={slot} index={index} active={index === holster.active} />
        ))}
      </ul>
    </GlassPanel>
  );
});

const SuitRow = memo(function SuitRow(): ReactElement {
  const suit = useUiSelector((state) => state.suit);
  const lampOn = suit.lampLevel > 0 && suit.lampMode !== "off";
  const hop = suit.hop;
  return (
    <div className={styles["suit"]} role="group" aria-label={STRINGS.hud.dayRing} data-testid="hud-suit">
      {suit.lampLevel > 0 && (
        <span
          className={`${styles["gear"]} ${lampOn ? styles["gearOn"] : ""}`}
          role="img"
          aria-label={lampOn ? STRINGS.hud.lampOn : STRINGS.hud.lampOff}
          title={STRINGS.hud.lamp}
        >
          <Icon icon={Lamp} size={24} />
          {lampOn && <span className={styles["gearTick"]} aria-hidden="true" />}
        </span>
      )}
      {hop !== null && (
        <span
          className={styles["gear"]}
          role="img"
          aria-label={`${formatString(STRINGS.hud.hopCharges, { bursts: hop.bursts, max: hop.max })}${
            hop.bursts < hop.max
              ? `, ${formatString(STRINGS.hud.hopRecharging, { pct: Math.round(hop.rechargePct) })}`
              : ""
          }`}
          title={STRINGS.hud.hop}
        >
          <Icon icon={Rocket} size={24} />
          <span className={styles["pips"]} aria-hidden="true">
            {Array.from({ length: hop.max }, (_, i) => (
              <span key={i} className={`${styles["pip"]} ${i < hop.bursts ? styles["pipOn"] : ""}`} />
            ))}
          </span>
        </span>
      )}
      <span className={styles["day"]} title={suit.day.isDay ? STRINGS.hud.dayLabel : STRINGS.hud.nightLabel}>
        <Icon icon={suit.day.isDay ? Sun : Moon} size={20} />
        <span>{dayText(suit.day.isDay, suit.day.minutesToTerminator)}</span>
      </span>
    </div>
  );
});

const Prompt = memo(function Prompt(): ReactElement | null {
  const prompt = useUiSelector((state) => state.interaction.prompt);
  const text = prompt === null ? null : promptText(prompt.labelId);
  if (prompt === null || text === null) return null;
  const blocked = prompt.blockedReasonId !== null;
  return (
    <div
      className={`${styles["prompt"]} ${blocked ? styles["promptBlocked"] : ""}`}
      role="status"
      aria-live="polite"
      data-testid="hud-prompt"
    >
      <span className={styles["promptText"]}>{text}</span>
      {prompt.hold && <span className={styles["promptHold"]}>{STRINGS.hud.holdToUse}</span>}
      {blocked && <span className={styles["promptHold"]}>{STRINGS.hud.interactionBlocked}</span>}
    </div>
  );
});

function NoticeLine({ notice, text }: { notice: UiNotice; text: string }): ReactElement {
  const reduced = useReducedMotion();
  const pop = useSpring("pop");
  return (
    <motion.div
      layout={reduced ? false : "position"}
      className={`${toastStyles["toast"]} ${toastStyles[notice.priority === "action" ? "warn" : "ok"]}`}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, transition: fadeTransition("out", reduced) }}
      transition={pop}
    >
      <span className={toastStyles["text"]}>{text}</span>
    </motion.div>
  );
}

/** DOT notices: the store decides which are visible; the HUD dismisses each when its own TTL runs out. */
const Notices = memo(function Notices(): ReactElement {
  const { store } = useUi();
  const notices = useUiSelector((state) => state.notices);
  const shown: { notice: UiNotice; text: string }[] = [];
  for (const id of notices.visible) {
    const notice = notices.queue.find((candidate) => candidate.id === id);
    const text = notice === undefined ? null : noticeText(notice);
    if (notice !== undefined && text !== null) shown.push({ notice, text });
  }
  const visibleKey = notices.visible.join(",");
  useEffect(() => {
    const timers: number[] = [];
    for (const id of notices.visible) {
      const notice = notices.queue.find((candidate) => candidate.id === id);
      if (notice === undefined || notice.ttlMs <= 0) continue;
      timers.push(window.setTimeout(() => store.dispatch({ type: "notices.dismiss", id }), notice.ttlMs));
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
    // Re-armed only when the visible set (or a merged notice's count) changes.
  }, [store, visibleKey, notices.queue.length]);
  return (
    <div
      className={styles["notices"]}
      role="status"
      aria-live="polite"
      aria-relevant="additions"
      data-testid="hud-notices"
    >
      <AnimatePresence initial={false} mode="popLayout">
        {shown.map(({ notice, text }) => (
          <NoticeLine key={notice.id} notice={notice} text={text} />
        ))}
      </AnimatePresence>
    </div>
  );
});

/** Mounted by UiRoot while a shift is playable. Pointer-transparent; nothing here takes focus. */
export function Hud(): ReactElement {
  return (
    <div className={styles["hud"]} role="region" aria-label={STRINGS.hud.region} data-testid="hud">
      <div className={styles["topLeft"]}>
        <Wallet />
        <NextRequisition />
        <InductionChecklist />
      </div>
      <div className={styles["topCenter"]}>
        <CompassStrip />
        <Notices />
        <AchievementToasts />
      </div>
      <div className={styles["topRight"]}>
        <ShinePanel />
        <PlotCard />
      </div>
      <div className={styles["bottomLeft"]}>
        <SyncIndicator />
        <SuitRow />
      </div>
      <div className={styles["bottomCenter"]}>
        <Prompt />
        <DotSubtitle />
      </div>
      <div className={styles["bottomRight"]}>
        <Holster />
      </div>
    </div>
  );
}
