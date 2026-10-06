import { getPrincipalPolicyOperation } from "@tearleads/validators/operation";
import {
  type PrincipalPolicyPageResponse,
  PrincipalPolicyPageResponseSchema,
} from "@tearleads/validators/response";
import { routeApp } from "../../src/routeApp";

/** Follow only a validated rollback continuation, keeping request bytes fixed. */
export async function requestPreparedPrincipalPolicy(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const progress = new Set<string>();
  while (true) {
    const response = await routeApp.request(path, init);
    if (response.status !== 202) return response;
    const pending = getPrincipalPolicyOperation.responses[202].parse(
      await response.json(),
    );
    if (progress.has(pending.progressToken))
      throw new Error("Principal policy fixture preparation stalled");
    progress.add(pending.progressToken);
  }
}

/** Test SDK facades consume a full bundle; route contract tests read raw pages. */
export async function requestFullPrincipalPolicy(
  path: string,
  init: RequestInit,
): Promise<Response> {
  let pinned: PrincipalPolicyPageResponse | undefined;
  let nextPath = path;
  const previousStates: PrincipalPolicyPageResponse["previousStates"] = [];
  while (true) {
    const response = await requestPreparedPrincipalPolicy(nextPath, init);
    if (response.status !== 200) return response;
    const page = PrincipalPolicyPageResponseSchema.parse(await response.json());
    pinned ??= page;
    if (
      page.currentState.stateHash !== pinned.currentState.stateHash ||
      page.historyPage.afterVersion !== previousStates.length
    )
      throw new Error(
        "Principal policy fixture page changed its head or cursor",
      );
    previousStates.push(...page.previousStates);
    const next = page.historyPage.nextAfterVersion;
    if (next === null) {
      if (previousStates.length !== pinned.currentState.version - 1)
        throw new Error("Principal policy fixture history is incomplete");
      return Response.json(
        {
          currentState: pinned.currentState,
          currentPayload: pinned.currentPayload,
          currentProjection: pinned.currentProjection,
          currentGrants: pinned.currentGrants,
          currentMemberEnvelopes: pinned.currentMemberEnvelopes,
          previousStates,
        },
        { headers: response.headers },
      );
    }
    if (next !== previousStates.length || page.previousStates.length === 0)
      throw new Error("Principal policy fixture page did not advance");
    nextPath = `${path}?afterVersion=${next}&stateHash=${pinned.currentState.stateHash}`;
  }
}
