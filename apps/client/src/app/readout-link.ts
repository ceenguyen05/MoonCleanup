// Links the published room host to the HUD read-out writers (integrator round 5, Job A). The Solo host
// (`LocalRoomHostImpl`) exposes a worker-fed cache (`readouts`) and `setReadoutRequest`; a remote host has neither, so
// online play stays unfed. The link owns the request state (inspect flag, quoted item ids), attaches the cache as the
// `SimReadoutSource` while a readout-capable host is published and detaches it otherwise.

import type { RoomHost } from "@moon-cleanup/shared";
import type { ParcelReadoutSource } from "./parcel-feed";
import type { SimReadoutSource } from "./readout-writer";

/** Everything the Solo host cache answers: HUD read-outs plus Near Parcels / outposts. */
export type HostReadoutSource = SimReadoutSource & ParcelReadoutSource;

/** What a host must offer to feed the HUD read-outs (the Solo host does; a remote host does not). */
export interface ReadoutHost {
  readonly readouts: HostReadoutSource;
  setReadoutRequest(inspecting: boolean, itemIds: readonly string[]): void;
}

export function hasReadouts(host: RoomHost | null): host is RoomHost & ReadoutHost {
  return host !== null && "readouts" in host && "setReadoutRequest" in host;
}

export class ReadoutLink {
  private host: ReadoutHost | null = null;
  private inspecting = false;
  private itemIds: readonly string[] = [];

  /** `attach` is `interactionPump.attachSimReadouts`. */
  constructor(private readonly attach: (source: HostReadoutSource | null) => void) {}

  /** Follows `roomHost.onChange` / `roomHost.current`. */
  setHost(host: RoomHost | null): void {
    const next = hasReadouts(host) ? host : null;
    if (next === this.host) return;
    this.host = next;
    if (next === null) {
      this.attach(null);
      return;
    }
    next.setReadoutRequest(this.inspecting, this.itemIds);
    this.attach(next.readouts);
  }

  /** Plot Card open (the worker then reads the plot in front of the avatar). */
  setInspecting(on: boolean): void {
    if (on === this.inspecting) return;
    this.inspecting = on;
    this.host?.setReadoutRequest(on, this.itemIds);
  }

  /** Desk / Board item ids to quote. */
  setItemIds(itemIds: readonly string[]): void {
    this.itemIds = itemIds;
    this.host?.setReadoutRequest(this.inspecting, itemIds);
  }
}
