// Orchestration of "go online": sign in (guest), resolve the Contract (create a Private Shift, join by code, or use a
// Contract id), then hand `(contractId, accessToken)` to the port's `open` (the `__mcOnline.open` semantics). Plain
// async function over the port: testable without a DOM, loaded only with the lazy panel.

import { createContractsApi, type ContractsApi } from "./contracts-api";
import { parseEntryTarget, type OnlineAuthPort, type OnlineEntryPort, type OnlineFailure } from "./online-model";

export type OnlineIntent =
  { readonly kind: "create"; readonly name: string } | { readonly kind: "join"; readonly raw: string };

/** Where the flow is, for the busy label. */
export type OnlineStage = "signin" | "request" | "opening";

export type OnlineFlowResult =
  | {
      readonly ok: true;
      readonly contractId: string;
      /** Invite code of a Private Shift this player just created (to show once), else `null`. */
      readonly inviteCode: string | null;
      /** One-time recovery code when this flow created the guest account, else `null`. */
      readonly recoveryCode: string | null;
    }
  | { readonly ok: false; readonly failure: OnlineFailure };

const fail = (key: OnlineFailure["key"]): OnlineFlowResult => ({ ok: false, failure: { key, retryAfterS: 0 } });

export interface OnlineFlowDeps {
  readonly port: OnlineEntryPort;
  readonly onStage?: (stage: OnlineStage) => void;
  /** Test seam: replaces the HTTP client. */
  readonly api?: (auth: OnlineAuthPort) => ContractsApi;
}

export async function runOnlineEntry(intent: OnlineIntent, deps: OnlineFlowDeps): Promise<OnlineFlowResult> {
  const { port, onStage } = deps;
  const target = intent.kind === "join" ? parseEntryTarget(intent.raw) : null;
  if (target?.kind === "invalid") return fail("badCode");

  onStage?.("signin");
  let auth: OnlineAuthPort;
  try {
    auth = await port.auth();
  } catch {
    return fail("offline");
  }
  let recoveryCode: string | null = null;
  if (!auth.signedIn) {
    if (!(await auth.signIn())) return fail("signInFailed");
    recoveryCode = auth.takeRecoveryCode?.() ?? null;
  }

  onStage?.("request");
  const api =
    deps.api?.(auth) ??
    createContractsApi({ httpUrl: port.httpUrl, auth, ...(port.fetch === undefined ? {} : { fetch: port.fetch }) });
  let contractId: string;
  let inviteCode: string | null = null;
  if (intent.kind === "create") {
    const created = await api.createPrivateShift(intent.name);
    if (!created.ok) return created;
    contractId = created.value.contractId;
    inviteCode = created.value.inviteCode;
  } else if (target?.kind === "code") {
    const joined = await api.joinByCode(target.code);
    if (!joined.ok) return joined;
    contractId = joined.value.contractId;
  } else if (target?.kind === "contract") {
    contractId = target.id;
  } else {
    return fail("badCode");
  }

  onStage?.("opening");
  let token = await auth.getAccessToken(false);
  token ??= (await auth.signIn()) ? await auth.getAccessToken(false) : null;
  if (token === null) return fail("unauthorized");
  await port.open(contractId, token);
  return { ok: true, contractId, inviteCode, recoveryCode };
}
