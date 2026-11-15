// Requisitions Desk (board purchase UI for tools and suit gear): reads `desk`, `wallet`, `holster`; raises
// `purchaseDeskItem` and nothing else. The server answers through the same slices (levelOwned, wallet, desk.pending).

import { Backpack, Brush, Eraser, Info, Lamp, Package } from "lucide-react";
import { type ReactElement } from "react";
import { LumenIcon } from "../icons/custom";
import { Icon, type IconComponent } from "../icons/Icon";
import { formatString, STRINGS } from "../strings";
import { useUiSelector } from "../ui-context";
import { availableLm, deskRowStatus, groupDesk, itemBlurb, itemName, lm, replacedToolName } from "./menu-model";
import { useUiIntents } from "./intents";
import { MenuRow } from "./MenuRow";
import styles from "./Menus.module.css";

const D = STRINGS.menus.desk;

const ICONS: Readonly<Record<string, IconComponent>> = {
  "tool.desk_duster": Brush,
  "tool.crescent_squeegee": Eraser,
  "gear.holster_rig": Backpack,
  "gear.crown_lamp": Lamp,
};

export function RequisitionsDesk(): ReactElement {
  const items = useUiSelector((state) => state.desk.items);
  const pending = useUiSelector((state) => state.desk.pending);
  const wallet = useUiSelector((state) => state.wallet);
  const holster = useUiSelector((state) => state.holster);
  const intents = useUiIntents();
  const available = availableLm(wallet);
  const groups = groupDesk(items);

  return (
    <div className={styles["body"]}>
      <p className={styles["subtitle"]}>{D.subtitle}</p>
      <p className={styles["balance"]} data-testid="desk-balance">
        <Icon icon={LumenIcon} size={24} />
        <span className={styles["balanceValue"]}>{lm(available)}</span>
        <span className={styles["balanceUnit"]}>{STRINGS.menus.lumensAvailable}</span>
      </p>
      {holster.slotCount <= 1 && (
        <p className={styles["note"]} data-testid="desk-one-slot">
          <Icon icon={Info} size={20} />
          <span>{D.oneSlotNote}</span>
        </p>
      )}
      {groups.length === 0 && <p className={styles["empty"]}>{D.empty}</p>}
      {groups.map((group) => (
        <section key={group.category} className={styles["group"]} aria-label={D.categories[group.category]}>
          <h3 className={styles["groupTitle"]}>{D.categories[group.category]}</h3>
          <ul className={styles["list"]}>
            {group.items.map((item) => {
              const name = itemName(item.itemId) ?? "";
              const status = deskRowStatus(item, available, pending.length > 0);
              const replaced =
                status.kind === "buy" || status.kind === "short" ? replacedToolName(item, holster) : null;
              const rebated = item.priceLm < item.listPriceLm;
              return (
                <MenuRow
                  key={item.itemId}
                  testId={`desk-row-${item.itemId}`}
                  icon={ICONS[item.itemId] ?? Package}
                  name={name}
                  blurb={itemBlurb(item.itemId)}
                  hint={replaced === null ? null : formatString(D.replaces, { name: replaced })}
                  pips={item.levelMax > 1 ? { on: item.levelOwned, max: item.levelMax } : null}
                  levelText={
                    item.levelMax > 1 ? formatString(D.levelOf, { owned: item.levelOwned, max: item.levelMax }) : null
                  }
                  priceLm={item.levelOwned >= item.levelMax ? null : item.priceLm}
                  priceNote={rebated ? formatString(D.rebate, { list: lm(item.listPriceLm) }) : null}
                  status={status}
                  labels={D}
                  level={item.levelOwned}
                  onAct={() => intents.purchaseDeskItem(item.itemId)}
                />
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
