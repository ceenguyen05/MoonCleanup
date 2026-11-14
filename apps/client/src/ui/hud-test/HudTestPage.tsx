import { AnimatePresence, motion } from "motion/react";
import { Brush, Compass, Eraser, Glasses, Lamp, Rocket } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { GlassPanel } from "../components/GlassPanel";
import { TickNumber } from "../components/TickNumber";
import { ToastStack } from "../components/ToastStack";
import { createToastQueue, type ToastQueue } from "../components/toast-queue";
import { DustCellIcon, LumenIcon, PlotHexIcon, ShineIcon } from "../icons/custom";
import { Icon, type IconComponent } from "../icons/Icon";
import { EASE } from "../motion/presets";
import { STRINGS } from "../strings";
import { formatDpr } from "../tokens/display-metrics";
import { useReducedMotion, useSpring, useUi } from "../ui-context";
import { measureFrameIntervals, type FrameSummary } from "./glass-probe";
import styles from "./HudTestPage.module.css";

const INCOME_STEPS = [25, 140, 1_250, 8_800] as const;
const TOAST_LINES = [STRINGS.toasts.requisitionApproved, STRINGS.toasts.plotStamped, STRINGS.toasts.railshotAway];

interface Slot {
  readonly id: string;
  readonly name: string;
  readonly icon: IconComponent;
  readonly cell: number;
}

const SLOTS: readonly Slot[] = [
  { id: "desk-duster", name: STRINGS.items.deskDuster, icon: Brush, cell: 0.72 },
  { id: "crescent-squeegee", name: STRINGS.items.crescentSqueegee, icon: Eraser, cell: 0.38 },
];

const GEAR: readonly { readonly id: string; readonly label: string; readonly icon: IconComponent }[] = [
  { id: "lamp", label: STRINGS.hud.lamp, icon: Lamp },
  { id: "visor", label: STRINGS.hud.visor, icon: Glasses },
  { id: "hop", label: STRINGS.hud.hop, icon: Rocket },
];

const formatShine = (value: number): string => `${value.toFixed(2)}%`;

/** The capture hook the render module installs on `window` (read-only here; the ui never imports the render module). */
interface RenderInfoHook {
  readonly __mcInfo?: () => { readonly renderScale: number };
}

function useDisplayReadout(): { dpr: number; hairlinePx: number; hudScale: string; renderScale: string } {
  const { host } = useUi();
  const [readout, setReadout] = useState({ dpr: 1, hairlinePx: 1, hudScale: "1", renderScale: "-" });
  useEffect(() => {
    const read = (): void => {
      const style = host.ownerDocument.defaultView?.getComputedStyle(host);
      const dpr = Number(style?.getPropertyValue("--mc-dpr") ?? "1") || 1;
      // The scene's resolution scale (what the dynamic-resolution controller drives), not the canvas backing store:
      // the canvas keeps its size and the pipeline renders the scene at `renderScale` of it.
      const hook = host.ownerDocument.defaultView as (Window & RenderInfoHook) | null;
      const scale = hook?.__mcInfo?.().renderScale;
      setReadout({
        dpr,
        hairlinePx: Math.round(dpr * (parseFloat(style?.getPropertyValue("--mc-px") ?? "1") || 1)),
        hudScale: (style?.getPropertyValue("--mc-hud-scale") ?? "1").trim(),
        renderScale: scale === undefined || !Number.isFinite(scale) ? "-" : scale.toFixed(2),
      });
    };
    read();
    const id = host.ownerDocument.defaultView?.setInterval(read, 500);
    return () => {
      if (id !== undefined) host.ownerDocument.defaultView?.clearInterval(id);
    };
  }, [host]);
  return readout;
}

function Wallet({ onIncome }: { readonly onIncome: (amount: number) => void }): ReactElement {
  const [lumens, setLumens] = useState(12_480);
  const [floaters, setFloaters] = useState<readonly { id: number; amount: number }[]>([]);
  const reduced = useReducedMotion();
  const step = useRef(0);
  const nextId = useRef(1);

  const add = (): void => {
    const amount = INCOME_STEPS[step.current % INCOME_STEPS.length] ?? 25;
    step.current += 1;
    setLumens((value) => value + amount);
    onIncome(amount);
    if (!reduced) {
      const id = nextId.current++;
      setFloaters((list) => [...list.slice(-3), { id, amount }]);
      window.setTimeout(() => setFloaters((list) => list.filter((item) => item.id !== id)), 950);
    }
  };

  return (
    <GlassPanel as="header" className={styles["wallet"]} aria-label={STRINGS.hud.lumensLabel}>
      <span className={styles["walletIcon"]}>
        <Icon icon={LumenIcon} size={32} />
      </span>
      <div className={styles["walletBody"]}>
        <span className={styles["caption"]}>{STRINGS.hud.lumensLabel}</span>
        <span className={styles["walletValue"]}>
          <TickNumber value={lumens} />
          <span className={styles["unit"]}>{STRINGS.hud.lumens}</span>
        </span>
        <span className={styles["floaters"]} aria-hidden="true">
          <AnimatePresence>
            {floaters.map((floater) => (
              <motion.span
                key={floater.id}
                className={styles["floater"]}
                initial={{ opacity: 0, y: 0 }}
                animate={{ opacity: [0, 1, 1, 0], y: -24 }}
                transition={{ duration: 0.9, ease: [...EASE.outCubic], times: [0, 0.15, 0.7, 1] }}
              >
                +{floater.amount} {STRINGS.hud.lumens}
              </motion.span>
            ))}
          </AnimatePresence>
        </span>
      </div>
      <button type="button" className={styles["chipButton"]} onClick={add}>
        {STRINGS.hudTest.addIncome}
      </button>
    </GlassPanel>
  );
}

function ShinePanel(): ReactElement {
  const [shine, setShine] = useState(4.27);
  useEffect(() => {
    const id = window.setInterval(() => setShine((value) => (value >= 96 ? 4.27 : value + 0.43)), 4000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <GlassPanel as="aside" className={styles["shine"]} aria-label={STRINGS.hud.shine}>
      <span className={styles["shineHead"]}>
        <Icon icon={ShineIcon} size={20} />
        <span className={styles["caption"]}>{STRINGS.hud.shine}</span>
      </span>
      <span className={styles["shineValue"]}>
        <TickNumber value={shine} format={formatShine} flash={false} />
      </span>
      <span
        className={styles["meter"]}
        role="progressbar"
        aria-label={STRINGS.hud.shine}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(shine)}
      >
        <span className={styles["meterFill"]} style={{ width: `${Math.min(100, shine)}%` }} />
      </span>
    </GlassPanel>
  );
}

function Holster(): ReactElement {
  const [active, setActive] = useState(0);
  const snap = useSpring("snap");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const select = useCallback((index: number, focus: boolean) => {
    const next = (index + SLOTS.length) % SLOTS.length;
    setActive(next);
    if (focus) refs.current[next]?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= SLOTS.length) setActive(digit - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      select(active + 1, true);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      select(active - 1, true);
    }
  };

  return (
    <GlassPanel
      as="aside"
      className={styles["holster"]}
      role="radiogroup"
      aria-label={STRINGS.hud.holster}
      onKeyDown={onKeyDown}
    >
      {SLOTS.map((slot, index) => {
        const isActive = index === active;
        return (
          <motion.button
            key={slot.id}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={`${slot.name}, ${STRINGS.hud.cell} ${Math.round(slot.cell * 100)}%`}
            tabIndex={isActive ? 0 : -1}
            className={`${styles["slot"]} ${isActive ? styles["slotActive"] : ""}`}
            layout="size"
            transition={snap}
            onClick={() => select(index, false)}
          >
            <span className={styles["slotKey"]}>{index + 1}</span>
            <Icon icon={slot.icon} size={isActive ? 32 : 24} />
            <span className={styles["slotName"]}>{isActive ? slot.name : ""}</span>
            <span className={styles["cell"]} aria-hidden="true">
              <Icon icon={DustCellIcon} size={16} />
              <span className={styles["cellBar"]}>
                <span className={styles["cellFill"]} style={{ width: `${Math.round(slot.cell * 100)}%` }} />
              </span>
            </span>
          </motion.button>
        );
      })}
    </GlassPanel>
  );
}

function GearRow(): ReactElement {
  const [on, setOn] = useState<ReadonlySet<string>>(new Set(["lamp"]));
  return (
    <div className={styles["gear"]} role="group" aria-label={STRINGS.hud.lamp}>
      {GEAR.map((item) => {
        const pressed = on.has(item.id);
        return (
          <button
            key={item.id}
            type="button"
            className={`${styles["gearButton"]} ${pressed ? styles["gearOn"] : ""}`}
            aria-pressed={pressed}
            aria-label={item.label}
            title={item.label}
            onClick={() =>
              setOn((previous) => {
                const next = new Set(previous);
                if (!next.delete(item.id)) next.add(item.id);
                return next;
              })
            }
          >
            <Icon icon={item.icon} size={24} />
            {pressed && <span className={styles["gearTick"]} aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

function CompassStrip(): ReactElement {
  return (
    <div className={styles["compass"]} role="img" aria-label={STRINGS.hud.compass}>
      <span className={styles["compassTicks"]} />
      {(["W", "N", "E"] as const).map((letter) => (
        <span key={letter} className={styles["compassLetter"]}>
          {letter}
        </span>
      ))}
      <span className={styles["compassCaret"]} />
    </div>
  );
}

function Bench(): ReactElement {
  const { glass, setGlass, host } = useUi();
  const readout = useDisplayReadout();
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<{ blur: FrameSummary; solid: FrameSummary } | null>(null);
  const win = host.ownerDocument.defaultView;

  const runProbe = async (): Promise<void> => {
    if (win === null || running) return;
    setRunning(true);
    const previous = glass;
    setGlass("blur");
    const blur = await measureFrameIntervals(win, 120, 20);
    setGlass("solid");
    const solid = await measureFrameIntervals(win, 120, 20);
    setGlass(previous);
    setResults({ blur, solid });
    setRunning(false);
  };

  const mode = glass === "solid" ? "solid" : "blur";
  return (
    <GlassPanel as="section" className={styles["bench"]} aria-label={STRINGS.hudTest.pageTitle}>
      <h2 className={styles["benchTitle"]}>{STRINGS.hudTest.pageTitle}</h2>

      <div className={styles["group"]}>
        <h3 className={styles["caption"]}>{STRINGS.hudTest.textSamples}</h3>
        <p className={styles["sample14"]}>14 {STRINGS.hudTest.sampleSentence}</p>
        <p className={styles["sample16"]}>16 {STRINGS.hudTest.sampleSentence}</p>
        <p className={styles["sample18"]}>18 {STRINGS.hudTest.sampleSentence}</p>
        <p className={styles["sample22"]}>22 {STRINGS.hudTest.numerals}</p>
      </div>

      <div className={styles["group"]}>
        <h3 className={styles["caption"]}>{STRINGS.hudTest.hairlines}</h3>
        <div className={styles["hairlines"]} aria-hidden="true">
          <span className={styles["hairStack"]}>
            <span className={styles["hairH"]} />
            <span className={styles["hairH"]} />
            <span className={styles["hairH"]} />
          </span>
          <span className={styles["hairChecker"]} />
          <span className={styles["hairBox"]} />
        </div>
      </div>

      <div className={styles["group"]}>
        <h3 className={styles["caption"]}>{STRINGS.hudTest.icons}</h3>
        <div className={styles["iconRow"]}>
          <Icon icon={Compass} size={16} />
          <Icon icon={Compass} size={20} />
          <Icon icon={Compass} size={24} />
          <Icon icon={Compass} size={32} />
          <span className={styles["divider"]} aria-hidden="true" />
          <Icon icon={LumenIcon} size={24} />
          <Icon icon={DustCellIcon} size={24} />
          <Icon icon={PlotHexIcon} size={24} />
          <Icon icon={ShineIcon} size={24} />
        </div>
      </div>

      <dl className={styles["readout"]} aria-label={STRINGS.hudTest.readout}>
        <dt>{STRINGS.hudTest.dprLabel}</dt>
        <dd data-testid="readout-dpr">{formatDpr(readout.dpr)}</dd>
        <dt>{STRINGS.hudTest.hairlineLabel}</dt>
        <dd data-testid="readout-hairline">
          {readout.hairlinePx} {STRINGS.hudTest.devicepx}
        </dd>
        <dt>{STRINGS.hudTest.scaleLabel}</dt>
        <dd data-testid="readout-hud-scale">{readout.hudScale}</dd>
        <dt>{STRINGS.hudTest.renderScaleLabel}</dt>
        <dd data-testid="readout-canvas-scale">{readout.renderScale} x</dd>
      </dl>

      <div className={styles["group"]}>
        <div className={styles["glassRow"]}>
          <span className={styles["caption"]}>{STRINGS.hudTest.glassLabel}</span>
          <div
            className={styles["segmented"]}
            role="radiogroup"
            aria-label={STRINGS.hudTest.glassLabel}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
              event.preventDefault();
              const next = mode === "blur" ? "solid" : "blur";
              setGlass(next);
              event.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next}"]`)?.focus();
            }}
          >
            {(["blur", "solid"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                tabIndex={mode === value ? 0 : -1}
                data-value={value}
                className={`${styles["segment"]} ${mode === value ? styles["segmentOn"] : ""}`}
                onClick={() => setGlass(value)}
              >
                {value === "blur" ? STRINGS.hudTest.glassBlur : STRINGS.hudTest.glassSolid}
              </button>
            ))}
          </div>
          <button type="button" className={styles["chipButton"]} onClick={() => void runProbe()} disabled={running}>
            {running ? STRINGS.hudTest.probeRunning : STRINGS.hudTest.probeRun}
          </button>
        </div>
        {results !== null && (
          <p className={styles["probe"]} data-testid="glass-probe" role="status">
            {STRINGS.hudTest.glassBlur} {results.blur.meanMs.toFixed(2)} ms (p95 {results.blur.p95Ms.toFixed(1)}) ·{" "}
            {STRINGS.hudTest.glassSolid} {results.solid.meanMs.toFixed(2)} ms (p95 {results.solid.p95Ms.toFixed(1)}) ·{" "}
            {results.blur.frames} {STRINGS.hudTest.framesEach}
          </p>
        )}
        <p className={styles["note"]}>{STRINGS.hudTest.probeNote}</p>
      </div>
    </GlassPanel>
  );
}

/**
 * `?scene=hud-test` (VT-M0-10): sample HUD panels, icons, numerals and a toast over the live canvas, plus a bench with
 * native-resolution text, device-pixel hairlines and a glass cost probe. Run it with `&preset=low&scale=floor` so the
 * canvas renders at 0.5 while this layer stays at full device DPR.
 */
export function HudTestPage(): ReactElement {
  const queue = useMemo<ToastQueue>(
    () =>
      createToastQueue({
        setTimeout: (handler, ms) => window.setTimeout(handler, ms),
        clearTimeout: (id) => window.clearTimeout(id),
      }),
    [],
  );
  const toastIndex = useRef(0);
  useEffect(() => {
    const first = window.setTimeout(() => queue.push(STRINGS.toasts.requisitionApproved), 500);
    return () => {
      window.clearTimeout(first);
      queue.dispose();
    };
  }, [queue]);

  const showToast = (): void => {
    const line = TOAST_LINES[toastIndex.current % TOAST_LINES.length] ?? STRINGS.toasts.plotStamped;
    toastIndex.current += 1;
    queue.push(line, toastIndex.current % 2 === 0 ? "info" : "ok");
  };

  return (
    <div className={styles["page"]} data-testid="hud-test">
      <div className={styles["topLeft"]}>
        <Wallet onIncome={() => undefined} />
        <Bench />
      </div>
      <div className={styles["topCenter"]}>
        <CompassStrip />
        <ToastStack queue={queue} />
        <button type="button" className={styles["chipButton"]} onClick={showToast}>
          {STRINGS.hudTest.toastDemo}
        </button>
      </div>
      <div className={styles["topRight"]}>
        <ShinePanel />
      </div>
      <div className={styles["bottomLeft"]}>
        <GearRow />
      </div>
      <div className={styles["bottomRight"]}>
        <Holster />
      </div>
    </div>
  );
}
