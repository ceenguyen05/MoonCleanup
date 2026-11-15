// Ops Console (Promotions Board subset): reads `board` and `wallet`, raises `purchaseBoardNode`. Departments are groups;
// each node shows level pips, the next cost and, when blocked, the plain-language reason.

import { Info, TrendingUp } from "lucide-react";
import type { ReactElement } from "react";
import { LumenIcon } from "../icons/custom";
import { Icon } from "../icons/Icon";
import { formatString, STRINGS } from "../strings";
import { useUiSelector } from "../ui-context";
import { availableLm, departmentName, groupBoard, lm, nodeName, nodeRowStatus } from "./menu-model";
import { useUiIntents } from "./intents";
import { MenuRow } from "./MenuRow";
import styles from "./Menus.module.css";

const C = STRINGS.menus.console;
const LABELS = {
  buy: C.promote,
  owned: C.maxed,
  maxed: C.maxed,
  locked: C.locked,
  processing: STRINGS.menus.desk.processing,
  approved: STRINGS.menus.desk.approved,
} as const;

export function OpsConsole(): ReactElement {
  const nodes = useUiSelector((state) => state.board.nodes);
  const caps = useUiSelector((state) => state.board.caps);
  const wallet = useUiSelector((state) => state.wallet);
  const intents = useUiIntents();
  const available = availableLm(wallet);
  const groups = groupBoard(nodes);

  return (
    <div className={styles["body"]}>
      <p className={styles["subtitle"]}>{C.subtitle}</p>
      <p className={styles["balance"]} data-testid="console-balance">
        <Icon icon={LumenIcon} size={24} />
        <span className={styles["balanceValue"]}>{lm(available)}</span>
        <span className={styles["balanceUnit"]}>{STRINGS.menus.lumensAvailable}</span>
      </p>
      <p className={styles["note"]} data-testid="console-caps">
        <Icon icon={Info} size={20} />
        <span>{formatString(C.caps, { name: C.roost, used: caps.roost.used, cap: caps.roost.cap })}</span>
      </p>
      {groups.length === 0 && <p className={styles["empty"]}>{C.empty}</p>}
      {groups.map((group) => (
        <section
          key={group.departmentId}
          className={styles["group"]}
          aria-label={departmentName(group.departmentId) ?? ""}
        >
          <h3 className={styles["groupTitle"]}>{departmentName(group.departmentId)}</h3>
          <ul className={styles["list"]}>
            {group.nodes.map((node) => (
              <MenuRow
                key={node.nodeId}
                testId={`console-row-${node.nodeId}`}
                icon={TrendingUp}
                name={nodeName(node.nodeId) ?? ""}
                pips={{ on: node.level, max: node.max }}
                levelText={formatString(C.levelOf, { level: node.level, max: node.max })}
                priceLm={node.nextCostLm}
                status={nodeRowStatus(node, available)}
                labels={LABELS}
                level={node.level}
                onAct={() => intents.purchaseBoardNode(node.nodeId)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
