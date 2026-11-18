// Glue between the gameplay module and the TrundlePredictor (M1-W7-T01): follows the own actor's vehicle events and
// ShiftState upgrades, forwards inputs / Selfs, and samples the predicted chassis pose plus the driver's handle point
// for the rig. Kept in vehicles/ so the module needs only a few calls (see the W7-T01 report for the wiring).
// Allocation-free per frame and per input; events and ShiftState are rare and may allocate.

import type { SimInputCommand } from "@moon-cleanup/shared";
import { PredictedVehiclePose, TrundlePredictor, type VehicleSelfLike } from "./trundle-predictor";

/** What the glue reads of a ShiftState (shared `ShiftState` satisfies it). */
export interface ShiftVehiclesLike {
  readonly vehicles: readonly {
    readonly entityId: number;
    readonly upgrades: Readonly<Record<string, number>>;
  }[];
}

/** What the glue reads of a sim event (shared `RoomSimEvent` satisfies it for the two vehicle events). */
export interface VehicleEventLike {
  readonly name: string;
  readonly payload: unknown;
}

export class SeatedTrundle {
  readonly pose = new PredictedVehiclePose();
  /** Driver's handle point of the last successful `sample`. */
  readonly feet = new Float64Array(3);
  private predictor: TrundlePredictor | null = null;
  private entityId = -1;
  private kindId = "";

  constructor(private readonly ownSlot = 0) {}

  get ready(): boolean {
    return this.predictor !== null && this.predictor.ready;
  }

  get stats(): TrundlePredictor["stats"] | null {
    return this.predictor?.stats ?? null;
  }

  /** The predictor once the sim config and tuning are loaded (lazy chunk). Starts at once if already seated. */
  attach(predictor: TrundlePredictor | null): void {
    this.predictor = predictor;
    if (predictor !== null && this.entityId >= 0) predictor.begin(this.kindId);
  }

  /** `vehicle.entered` / `vehicle.exited` of the own actor. Returns true when the seat changed. */
  onEvent(e: VehicleEventLike): boolean {
    if (e.name !== "vehicle.entered" && e.name !== "vehicle.exited") return false;
    const p = e.payload as { actorSlot: number; vehicleId: number; kindId: string };
    if (p.actorSlot !== this.ownSlot) return false;
    if (e.name === "vehicle.entered") {
      this.entityId = p.vehicleId;
      this.kindId = p.kindId;
      this.predictor?.begin(p.kindId);
    } else {
      this.reset();
    }
    return true;
  }

  /** Upgrade levels of the driven vehicle from ShiftState. */
  onShiftState(state: ShiftVehiclesLike): void {
    if (this.entityId < 0 || this.predictor === null) return;
    for (const v of state.vehicles) if (v.entityId === this.entityId) this.predictor.setUpgrades(v.upgrades);
  }

  /** Host changed or the seat was lost. */
  reset(): void {
    this.entityId = -1;
    this.kindId = "";
    this.predictor?.end();
  }

  predict(cmd: SimInputCommand): void {
    this.predictor?.predict(cmd);
  }

  reconcile(self: VehicleSelfLike, ackSeq: number): void {
    this.predictor?.reconcile(self, ackSeq);
  }

  /** Samples the predicted chassis into `pose` and its handle into `feet`; false when not predicting. */
  sample(t: { readonly nowMs: number }): boolean {
    const p = this.predictor;
    if (p === null || !p.sample(t, this.pose)) return false;
    p.handleOf(this.pose, this.feet);
    return true;
  }
}
