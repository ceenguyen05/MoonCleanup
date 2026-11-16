// Compass strip (HUD-04): a fixed-width window onto a track of cardinal ticks. The heading is a per-frame value and is NOT
// in the store (ui/slices note): the owner of the player's heading calls `UiModule.setCompassHeading(deg)`, which writes
// one whole-pixel translateX to the track element (`createCompassWriter`), no React render. The store supplies what is
// not per-frame: outposts, the Pilot Fence bearing (a fixed marker on the track), the Induction objective chip, pings.

import { Check, Circle, Flag, Landmark, MapPin, Package, type LucideIcon } from "lucide-react";
import { memo, type ReactElement } from "react";
import { Icon } from "../icons/Icon";
import { useParcels } from "./parcels-store";
import { formatString, STRINGS } from "../strings";
import { useUiSelector } from "../ui-context";
import { COMPASS_CYCLE_PX, COMPASS_PX_PER_DEG, compassShiftPx, pingText } from "../menus/menu-model";
import styles from "./Compass.module.css";

const C = STRINGS.menus.compass;
export const COMPASS_TRACK_ATTR = "data-mc-compass-track";
const COPIES = [0, 1, 2] as const;
const TICKS = Array.from({ length: 24 }, (_, i) => i * 15);

/** Direct-DOM writer for the compass track. Returns a function taking the heading in degrees (0 = north, clockwise). */
export function createCompassWriter(host: ParentNode): (headingDeg: number) => void {
  let track: HTMLElement | null = null;
  let last = Number.NaN;
  return (headingDeg) => {
    if (track === null || !track.isConnected) {
      track = host.querySelector<HTMLElement>(`[${COMPASS_TRACK_ATTR}]`);
      last = Number.NaN;
    }
    if (track === null) return;
    const shift = compassShiftPx(headingDeg);
    if (shift === last) return;
    last = shift;
    track.style.transform = `translate3d(${shift}px,0,0)`;
  };
}

/** A bearing marker repeated on the three track copies (same whole-px positions as the ticks). */
function Marker({
  id,
  deg,
  className,
  label,
  icon,
}: {
  readonly id: string;
  readonly deg: number;
  readonly className: string | undefined;
  readonly label: string;
  readonly icon: LucideIcon;
}): ReactElement {
  return (
    <>
      {COPIES.map((copy) => (
        <span
          key={`${id}-${copy}`}
          className={className}
          style={{ left: `${copy * COMPASS_CYCLE_PX + deg * COMPASS_PX_PER_DEG}px` }}
          title={label}
        >
          <Icon icon={icon} size={16} />
        </span>
      ))}
    </>
  );
}

const Track = memo(function Track({ fenceDeg }: { fenceDeg: number | null }): ReactElement {
  const parcels = useParcels((state) => state.bearings);
  const outposts = useParcels((state) => state.outposts);
  const markers = useParcels((state) => state.markers);
  const outpostIds = Object.keys(outposts);
  return (
    <div className={styles["track"]} {...{ [COMPASS_TRACK_ATTR]: "" }}>
      {COPIES.map((copy) =>
        TICKS.map((deg) => {
          const cardinal = (C.cardinals as Readonly<Record<number, string>>)[deg];
          return (
            <span
              key={`${copy}-${deg}`}
              className={`${styles["tick"]} ${cardinal !== undefined ? styles["tickMajor"] : ""}`}
              style={{ left: `${copy * COMPASS_CYCLE_PX + deg * COMPASS_PX_PER_DEG}px` }}
            >
              {cardinal !== undefined && <span className={styles["cardinal"]}>{cardinal}</span>}
            </span>
          );
        }),
      )}
      {fenceDeg !== null &&
        COPIES.map((copy) => (
          <span
            key={`fence-${copy}`}
            className={styles["fence"]}
            style={{ left: `${copy * COMPASS_CYCLE_PX + fenceDeg * COMPASS_PX_PER_DEG}px` }}
            title={C.fence}
          >
            <Icon icon={Flag} size={16} />
          </span>
        ))}
      {outpostIds.map((id) => {
        const name = (C.outposts as Readonly<Record<string, string>>)[id];
        if (name === undefined) return null;
        return (
          <Marker
            key={`outpost-${id}`}
            id={`outpost-${id}`}
            deg={outposts[id] as number}
            className={styles["outpostMark"]}
            label={name}
            icon={Landmark}
          />
        );
      })}
      {Object.entries(markers).map(([id, deg]) => {
        const name = (C.objectives as Readonly<Record<string, string>>)[id];
        if (name === undefined) return null;
        return (
          <Marker
            key={`objective-${id}`}
            id={`objective-${id}`}
            deg={deg}
            className={styles["objectiveMark"]}
            label={formatString(C.markerLabel, { name })}
            icon={MapPin}
          />
        );
      })}
      {parcels.map((deg, k) =>
        deg === null ? null : (
          <Marker
            key={`parcel-${k}`}
            id={`parcel-${k}`}
            deg={deg}
            className={styles["parcelMark"]}
            label={C.parcel}
            icon={Package}
          />
        ),
      )}
    </div>
  );
});

/** "Parcels 2/6" with one pip per parcel: a check when collected, a hollow ring when not (shape, not colour). */
const ParcelChip = memo(function ParcelChip(): ReactElement | null {
  const count = useParcels((state) => state.count);
  const collected = useParcels((state) => state.collected);
  const mask = useParcels((state) => state.collectedMask);
  const rewardLm = useParcels((state) => state.rewardLm);
  if (count === 0) return null;
  const pips = Array.from({ length: count }, (_, k) => ((mask >>> k) & 1) === 1);
  return (
    <span
      className={`${styles["chip"]} ${styles["chipParcels"]}`}
      data-testid="hud-parcels"
      data-complete={collected === count}
      aria-label={formatString(C.parcelsLabel, {
        collected: String(collected),
        count: String(count),
        lm: String(rewardLm),
      })}
    >
      <Icon icon={Package} size={16} />
      <span aria-hidden="true">
        {formatString(C.parcelsCount, { collected: String(collected), count: String(count) })}
      </span>
      <span className={styles["pips"]} aria-hidden="true">
        {pips.map((done, k) => (
          <span key={k} className={styles["pip"]} data-done={done} />
        ))}
      </span>
    </span>
  );
});

export const CompassStrip = memo(function CompassStrip(): ReactElement {
  const compass = useUiSelector((state) => state.compass);
  const objective =
    compass.objectiveMarkerId === null
      ? null
      : ((C.objectives as Readonly<Record<string, string>>)[compass.objectiveMarkerId] ?? null);
  const pings = pingText(compass.pings.length);
  return (
    <div className={styles["compass"]} data-testid="hud-compass">
      <div className={styles["strip"]} role="img" aria-label={C.region}>
        <Track fenceDeg={compass.fenceBearingDeg} />
        <span className={styles["caret"]} aria-hidden="true" />
      </div>
      <div className={styles["chips"]}>
        {compass.outposts.map((outpost) => {
          const name = (C.outposts as Readonly<Record<string, string>>)[outpost.id];
          if (name === undefined) return null;
          return (
            <span
              key={outpost.id}
              className={styles["chip"]}
              data-visited={outpost.visited}
              aria-label={formatString(outpost.visited ? C.outpostVisited : C.outpostNew, { name })}
            >
              <Icon icon={outpost.visited ? Check : Circle} size={16} />
              <span aria-hidden="true">{name}</span>
            </span>
          );
        })}
        {objective !== null && (
          <span className={`${styles["chip"]} ${styles["chipObjective"]}`} data-testid="hud-objective">
            <Icon icon={MapPin} size={16} />
            <span>{objective}</span>
          </span>
        )}
        <ParcelChip />
        {pings !== null && <span className={styles["chip"]}>{pings}</span>}
      </div>
    </div>
  );
});
