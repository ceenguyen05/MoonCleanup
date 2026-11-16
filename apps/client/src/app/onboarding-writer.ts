// Onboarding store writer (composition root glue, W7-T03): drives the Induction Checklist (`checklist`), DOT subtitle
// lines (`dot.say`) and the achievements slice from REAL room events, never from timers or UI state.
//
// - Induction steps and their triggers come from game-data `onboarding.json` (`setCatalog`); nothing is hard-coded but
//   the mapping from a trigger name to the sim event that satisfies it (`TRIGGERS`). Steps are suggestions: nothing here
//   locks anything, and every step completes at most once (progress persists in `storage`, so a returning player does
//   not replay the checklist).
// - Events are rare and discrete: they dispatch straight away (the store applies them at its <= 15 Hz flush). Nothing
//   runs per frame, so there is no solo frame cost.
// - The sim does not emit `onboarding.step_completed` yet; when it does, the writer completes that step too (idempotent).
// - Text ids are the UI catalog's (`dot.*`); the checklist item `id` is `onboarding.<id>` and doubles as the label id.

import type {
  RoomHost,
  RoomHostService,
  RoomSimEvent,
  UiAchievementItem,
  UiChecklistItem,
  UiStore,
  Unsubscribe,
} from "@moon-cleanup/shared";

export interface InductionStepDef {
  /** `onboarding.<id>` of game-data. */
  readonly id: string;
  /** game-data trigger name (`firstStroke`, `cellFull`, ...). */
  readonly trigger: string;
}

export interface OnboardingCatalog {
  readonly induction: readonly InductionStepDef[];
  /** `achievement.<id>` of game-data; seeds the slice so the toasts treat later unlocks as fresh. */
  readonly achievementIds: readonly string[];
}

/** Where finished Induction step ids persist (localStorage in the app). Reads must not throw. */
export interface OnboardingStorage {
  read(): readonly string[];
  write(doneIds: readonly string[]): void;
}

export interface OnboardingWriterOptions {
  readonly store: Pick<UiStore, "dispatch" | "getState">;
  readonly wallMs?: () => number;
  readonly storage?: OnboardingStorage;
}

/** game-data trigger -> the first Induction steps' meaning. The comments say which event satisfies it. */
export const TRIGGERS = {
  /** Own `dust.collected` with grams > 0 (the sim reports a stroke as dust moved into the Cell). */
  firstStroke: "firstStroke",
  /** Own `cell.full`. */
  cellFull: "cellFull",
  /** Own `cargo.sold` at the Assay Counter. */
  assayPour: "assayPour",
  /** The player opened the Plot Card (UiFrameBridge `onInspect(true)`), see `plotCardOpened()`. */
  plotCardOpened: "plotCardOpened",
  /** Own `plot.polished`. */
  plotPolished: "plotPolished",
  /** Own `purchase.completed` of `tool.crescent_squeegee`. */
  boughtCrescentSqueegee: "boughtCrescentSqueegee",
  /** Own `purchase.completed` of a `node.dust_cell_*` Promotions Board node. */
  boughtDustCell: "boughtDustCell",
  /** Own `collectible.found` of a `near_parcel` Stray Cargo. */
  nearParcelFound: "nearParcelFound",
} as const;

const CRESCENT_SQUEEGEE = "tool.crescent_squeegee";
const DUST_CELL_NODE_PREFIX = "node.dust_cell_";
const DOT_DURATION_MS = 5000;
const DOT_INDUCTION_MS = 7000;

export const ONBOARDING_STORAGE_KEY = "mc.onboarding.induction.v1";

export class OnboardingWriter {
  private host: RoomHost | null = null;
  private offHost: Unsubscribe | null = null;
  private catalog: OnboardingCatalog | null = null;
  private readonly done = new Set<string>();
  private readonly said = new Set<string>();
  private achievements: UiAchievementItem[] = [];
  private started = false;

  private readonly onEventFn = (event: RoomSimEvent): void => this.onEvent(event);

  constructor(private readonly options: OnboardingWriterOptions) {
    for (const id of options.storage?.read() ?? []) this.done.add(id);
  }

  follow(service: RoomHostService): Unsubscribe {
    this.bind(service.current);
    return service.onChange((host) => this.bind(host));
  }

  bind(host: RoomHost | null): void {
    if (host === this.host) return;
    this.offHost?.();
    this.offHost = null;
    this.host = host;
    if (host !== null) this.offHost = host.onEvent(this.onEventFn);
    this.maybeStart();
  }

  /** game-data is loaded lazily; the checklist appears once it is here. */
  setCatalog(catalog: OnboardingCatalog): void {
    this.catalog = catalog;
    const items: UiChecklistItem[] = catalog.induction.map((step) => ({
      id: step.id,
      labelId: step.id,
      progress: this.done.has(step.id) ? 1 : 0,
      target: 1,
      done: this.done.has(step.id),
    }));
    const firstOpen = items.findIndex((item) => !item.done);
    this.options.store.dispatch({
      type: "checklist.set",
      patch: { mode: "induction", items, stepIndex: firstOpen === -1 ? items.length : firstOpen },
    });
    this.achievements = catalog.achievementIds.map((id) => ({ id, unlockedAtMs: null, progress01: null }));
    this.options.store.dispatch({ type: "achievements.set", patch: { items: this.achievements } });
    this.maybeStart();
  }

  /** The player opened the Plot Card (Induction step 4). */
  plotCardOpened(): void {
    this.fire(TRIGGERS.plotCardOpened);
  }

  /** Unfinished Induction steps, for tests and the marker feed. */
  get inductionComplete(): boolean {
    return this.catalog !== null && this.catalog.induction.every((s) => this.done.has(s.id));
  }

  /** Id of the step the player should do now (first not done), or `null` when none / no catalog yet. */
  get currentStepId(): string | null {
    return this.catalog?.induction.find((s) => !this.done.has(s.id))?.id ?? null;
  }

  dispose(): void {
    this.bind(null);
  }

  private mySlot(): number {
    return this.host?.kind === "local" ? 0 : this.options.store.getState().shift.mySlot;
  }

  /** Welcome line once the catalog and a host exist, and only while the checklist has steps left. */
  private maybeStart(): void {
    if (this.started || this.host === null || this.catalog === null) return;
    this.started = true;
    if (this.inductionComplete) return;
    this.say("dot.induction_start", {}, DOT_INDUCTION_MS, true);
    this.say("dot.tip_handbook", {}, DOT_DURATION_MS, true);
  }

  private say(textId: string, params: Record<string, string | number>, durationMs: number, keep: boolean): void {
    this.options.store.dispatch({ type: "dot.say", line: { textId, params, durationMs }, keep });
  }

  /** A tip line, once per session. */
  private tipOnce(textId: string, params: Record<string, string | number> = {}): void {
    if (this.said.has(textId)) return;
    this.said.add(textId);
    this.say(textId, params, DOT_DURATION_MS, false);
  }

  private fire(trigger: string): void {
    const step = this.catalog?.induction.find((s) => s.trigger === trigger && !this.done.has(s.id));
    if (step !== undefined) this.complete(step.id);
  }

  private complete(stepId: string): void {
    const catalog = this.catalog;
    if (catalog === null || this.done.has(stepId) || !catalog.induction.some((s) => s.id === stepId)) return;
    this.done.add(stepId);
    this.options.storage?.write([...this.done]);
    this.options.store.dispatch({ type: "checklist.complete", itemId: stepId });
    if (this.inductionComplete) this.say("dot.induction_complete", {}, DOT_INDUCTION_MS, true);
  }

  private unlock(achievementId: string): void {
    const known = this.achievements.find((a) => a.id === achievementId);
    if (known?.unlockedAtMs != null) return;
    const atMs = (this.options.wallMs ?? Date.now)();
    const next: UiAchievementItem = { id: achievementId, unlockedAtMs: atMs, progress01: 1 };
    this.achievements =
      known === undefined
        ? [...this.achievements, next]
        : this.achievements.map((a) => (a.id === achievementId ? next : a));
    this.options.store.dispatch({ type: "achievements.set", patch: { items: this.achievements } });
  }

  private onEvent(event: RoomSimEvent): void {
    const me = this.mySlot();
    switch (event.name) {
      case "dust.collected":
        if (event.payload.actorSlot === me && event.payload.grams > 0) this.fire(TRIGGERS.firstStroke);
        return;
      case "cell.full":
        if (event.payload.actorSlot !== me) return;
        this.fire(TRIGGERS.cellFull);
        this.tipOnce("dot.tip_cell_full");
        return;
      case "cargo.sold":
        if (event.payload.actorSlot === me && event.payload.source === "assay_counter") this.fire(TRIGGERS.assayPour);
        return;
      case "plot.polished": {
        if (event.payload.creditedSlot !== me) return;
        this.fire(TRIGGERS.plotPolished);
        const total = this.options.store.getState().shine.total;
        const remaining = total - event.payload.polishedCount;
        if (Number.isFinite(remaining) && remaining > 0) this.tipOnce("dot.tip_plot_stamped", { remaining });
        return;
      }
      case "purchase.completed": {
        const p = event.payload;
        if (p.actorSlot !== me) return;
        if (p.itemId === CRESCENT_SQUEEGEE) this.fire(TRIGGERS.boughtCrescentSqueegee);
        else if (p.itemId.startsWith(DUST_CELL_NODE_PREFIX)) this.fire(TRIGGERS.boughtDustCell);
        return;
      }
      case "collectible.found":
        if (
          event.payload.actorSlot === me &&
          event.payload.kind === "stray_cargo" &&
          event.payload.id === "near_parcel"
        )
          this.fire(TRIGGERS.nearParcelFound);
        return;
      case "onboarding.step_completed":
        this.complete(event.payload.stepId);
        return;
      case "achievement.unlocked":
        if (event.payload.actorSlot === me) this.unlock(event.payload.achievementId);
        return;
      case "daynight.changed":
        if (event.payload.phase === "night") this.tipOnce("dot.tip_first_night");
        return;
      case "shine.milestone":
        this.say("dot.tip_shine_milestone", { pct: event.payload.pct }, DOT_DURATION_MS, false);
        return;
      default:
        return;
    }
  }
}

/** localStorage-backed progress; storage errors never reach play (the checklist then restarts next session). */
export function createOnboardingStorage(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  report: (source: string, error: unknown) => void,
): OnboardingStorage {
  return {
    read: () => {
      try {
        const raw = storage?.getItem(ONBOARDING_STORAGE_KEY) ?? null;
        if (raw === null) return [];
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
      } catch (error) {
        report("onboarding progress load", error);
        return [];
      }
    },
    write: (ids) => {
      try {
        storage?.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(ids));
      } catch (error) {
        report("onboarding progress save", error);
      }
    },
  };
}
