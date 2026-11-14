// LoadTestRoom create options (M0-W2-T03). Bounded and zod-validated at the edge (the join route) and again in
// `onCreate`. Rates come from the request, never magic numbers in the loop. The spike only exists when the composition
// root passes `loadTest` to createGameServer, which it does only for NET_SPIKE=1 (default 0).

import { z } from "zod";

/** Simulation rates the spike measures (card: tickHz in {20, 30}). */
export const SPIKE_TICK_HZ = [20, 30] as const;
/** Snapshot rates (card: {10, 20}; 15 and 30 added for the local-feel comparison). Must divide tickHz. */
export const SPIKE_SNAPSHOT_HZ = [10, 15, 20, 30] as const;

/** Kinematic bodies stepped per tick with height sampling (netcode.md section 15: 32 in the 16-player table). */
export const SPIKE_BODIES_DEFAULT = 32;
export const SPIKE_BODIES_MAX = 64;
/** Robots moved every tick and streamed every second frame (netcode.md section 14: 32 robots in interest). */
export const SPIKE_ROBOTS_DEFAULT = 32;
export const SPIKE_ROBOTS_MAX = 64;
/** Shared vehicles streamed as entities (netcode.md section 14: 8 vehicles moving). Bodies after the seats. */
export const SPIKE_VEHICLES = 8;

export const SpikeRoomOptionsSchema = z
  .object({
    tickHz: z.union([z.literal(20), z.literal(30)]).default(20),
    snapshotHz: z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30)]).default(10),
    bodies: z.int().min(1).max(SPIKE_BODIES_MAX).default(SPIKE_BODIES_DEFAULT),
    robots: z.int().min(0).max(SPIKE_ROBOTS_MAX).default(SPIKE_ROBOTS_DEFAULT),
  })
  // Same rule as the env (SNAPSHOT_HZ divides SIM_TICK_HZ): an even frame cadence. 30/15 is the high-rate profile.
  .refine((o) => o.snapshotHz <= o.tickHz && o.tickHz % o.snapshotHz === 0, {
    message: "snapshotHz must divide tickHz",
    path: ["snapshotHz"],
  });

export type SpikeRoomOptions = z.infer<typeof SpikeRoomOptionsSchema>;
