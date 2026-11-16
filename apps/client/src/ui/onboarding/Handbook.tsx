// DOT Handbook (SCR-24): chapters of short semantic articles with per-device control lines and a plot-state diagram, plus
// the DOT log of the last lines DOT said. Rendered inside the menu frame (focus trap, Esc, arrow-key movement), so it
// needs no key listeners of its own. Opening it clears the unread marker. Keyboard: Tab / arrows move focus; Enter or
// Space picks a chapter or tab. The Induction Checklist can be shown or hidden here (the HUD block takes no input).

import { ClipboardList } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";
import { Icon } from "../icons/Icon";
import { STRINGS } from "../strings";
import { useUi, useUiSelector } from "../ui-context";
import {
  CHAPTER_IDS,
  DIAGRAM_CHAPTERS,
  chapterOf,
  dotLogText,
  inductionView,
  type ChapterId,
} from "./onboarding-model";
import styles from "./Onboarding.module.css";

const H = STRINGS.handbook;

type Tab = "handbook" | "log";

/** Three plot states with a pattern each (speckle, stripes, smooth plus check): never colour alone. */
function PlotStatesDiagram(): ReactElement {
  const states = [
    { id: "grimy", label: H.plotStates.grimy, fill: "var(--mc-state-grimy)" },
    { id: "opened", label: H.plotStates.opened, fill: "var(--mc-state-opened)" },
    { id: "polished", label: H.plotStates.polished, fill: "var(--mc-state-polished)" },
  ] as const;
  return (
    <figure className={styles["diagram"]} aria-label={H.diagramLabel}>
      <svg width={0} height={0} aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
        <defs>
          <pattern id="mc-hb-speckle" width="8" height="8" patternUnits="userSpaceOnUse">
            <rect width="8" height="8" fill="#5a4433" />
            <rect x="1" y="1" width="2" height="2" fill="#2a1f17" />
            <rect x="5" y="4" width="2" height="2" fill="#7a6048" />
          </pattern>
          <pattern id="mc-hb-stripe" width="8" height="8" patternUnits="userSpaceOnUse">
            <rect width="8" height="8" fill="#5ed3e8" />
            <path d="M-2 2 2-2M0 8 8 0M6 10 10 6" stroke="#1f7f91" strokeWidth="2" />
          </pattern>
        </defs>
      </svg>
      {states.map((state) => (
        <div key={state.id} className={styles["diagramItem"]}>
          <svg
            width={64}
            height={48}
            viewBox="0 0 64 48"
            role="img"
            aria-label={state.label}
            shapeRendering="crispEdges"
          >
            <rect
              width="64"
              height="48"
              rx="6"
              fill={
                state.id === "grimy" ? "url(#mc-hb-speckle)" : state.id === "opened" ? "url(#mc-hb-stripe)" : state.fill
              }
            />
            {state.id === "polished" && (
              <path d="M20 25 28 33 44 15" fill="none" stroke="#24282d" strokeWidth="4" strokeLinecap="round" />
            )}
          </svg>
          <span className={styles["diagramLabel"]}>{state.label}</span>
        </div>
      ))}
    </figure>
  );
}

function Article({ id }: { readonly id: ChapterId }): ReactElement {
  const device = useUiSelector((state) => state.input.lastDevice);
  const chapter = chapterOf(id);
  return (
    <article className={styles["article"]} aria-labelledby="mc-hb-article-title" data-testid="handbook-article">
      <h3 id="mc-hb-article-title" className={styles["articleTitle"]}>
        {chapter.title}
      </h3>
      {chapter.paragraphs.map((paragraph) => (
        <p key={paragraph} className={styles["para"]}>
          {paragraph}
        </p>
      ))}
      {DIAGRAM_CHAPTERS.includes(id) && <PlotStatesDiagram />}
      <section className={styles["keys"]} aria-label={H.controlsHeading}>
        <span className={styles["keysHead"]}>{H.controlsHeading}</span>
        <span className={styles["keysLine"]}>{chapter.keys[device === "generic" ? "kbm" : device]}</span>
        <p className={styles["keysNote"]}>{H.controlsNote}</p>
      </section>
    </article>
  );
}

function InductionToggle(): ReactElement | null {
  const { store } = useUi();
  const checklist = useUiSelector((state) => state.checklist);
  const view = inductionView(checklist);
  if (checklist.mode !== "induction" || view.total === 0) return null;
  if (view.complete) return <p className={styles["keysNote"]}>{H.inductionDone}</p>;
  const shown = !checklist.hidden;
  return (
    <button
      type="button"
      className={styles["inductionToggle"]}
      aria-pressed={shown}
      data-testid="handbook-induction-toggle"
      onClick={() => store.dispatch({ type: "checklist.set", patch: { hidden: shown } })}
    >
      <Icon icon={ClipboardList} size={20} />
      {shown ? STRINGS.induction.hide : H.showInduction}
    </button>
  );
}

function DotLog(): ReactElement {
  const history = useUiSelector((state) => state.dot.history);
  const lines = history
    .map((textId) => dotLogText(textId))
    .filter((text): text is string => text !== null)
    .reverse();
  if (lines.length === 0) return <p className={styles["empty"]}>{H.logEmpty}</p>;
  return (
    <ol className={styles["log"]} aria-label={H.logLabel} data-testid="handbook-log">
      {lines.map((text, index) => (
        <li key={`${index}-${text}`} className={styles["logLine"]}>
          <span className={styles["dotTag"]}>{STRINGS.dotSubtitle.tag}</span>
          <span>{text}</span>
        </li>
      ))}
    </ol>
  );
}

/** Body of the Handbook surface (the menu frame supplies the title, close button and footer). */
export function Handbook(): ReactElement {
  const { store } = useUi();
  const unread = useUiSelector((state) => state.dot.handbookUnread);
  const [tab, setTab] = useState<Tab>("handbook");
  const [chapter, setChapter] = useState<ChapterId>(CHAPTER_IDS[0]);

  // Opening the Handbook reads the tips: clear the unread marker once.
  useEffect(() => {
    if (unread > 0) store.dispatch({ type: "dot.set", patch: { handbookUnread: 0 } });
  }, [store, unread]);

  return (
    <div className={styles["hbBody"]}>
      <div className={styles["tabs"]} role="tablist" aria-label={H.tabsLabel}>
        {(["handbook", "log"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            className={styles["tab"]}
            aria-selected={tab === id}
            data-testid={`handbook-tab-${id}`}
            onClick={() => setTab(id)}
          >
            {H.tabs[id]}
          </button>
        ))}
      </div>
      {tab === "handbook" ? (
        <div className={styles["split"]} role="tabpanel" aria-label={H.tabs.handbook}>
          <nav aria-label={H.chaptersLabel}>
            <ul className={styles["chapters"]}>
              {CHAPTER_IDS.map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    className={styles["chapter"]}
                    aria-current={chapter === id}
                    data-testid={`handbook-chapter-${id}`}
                    onClick={() => setChapter(id)}
                  >
                    {chapterOf(id).title}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className={styles["articleWrap"]}>
            <Article id={chapter} />
            <InductionToggle />
          </div>
        </div>
      ) : (
        <div role="tabpanel" aria-label={H.tabs.log}>
          <DotLog />
        </div>
      )}
    </div>
  );
}
