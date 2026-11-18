/**
 * Tiny pure launch predicates that boot.ts exports. They live here (no client-graph imports) so tests can import them
 * without pulling the whole boot.ts module graph.
 */
import { planScene, wantsGameWorksite, wantsSoloHost } from "./launch-policy";

/**
 * Whether the checkpoint sync (guest sign-in + upload queue) runs: a configured server URL, or forced with
 * `?sync=1`; `?sync=0` always disables it.
 */
export function wantsCheckpointSync(search: string, serverUrl: string | undefined): boolean {
  const forced = new URLSearchParams(search).get("sync");
  if (forced === "0") return false;
  if (forced === "1") return true;
  return typeof serverUrl === "string" && serverUrl.trim() !== "";
}

/**
 * Player input runs with the Solo host in the default game launch, on `?play=1`, or in the dust scene when its sweeper
 * is off (`&bot=0`).
 */
export function wantsPlayerInput(search: string): boolean {
  if (!wantsSoloHost(search)) return false;
  if (wantsGameWorksite(search)) return true;
  const params = new URLSearchParams(search);
  if (params.get("play") === "1") return true;
  return planScene(search).scene === "dust" && params.get("bot") === "0";
}
