import { serializeKeyingCanonicalJson } from "@tearleads/crypto";
import { getPrincipalPolicyOperation } from "@tearleads/validators/operation";
import type {
  PrincipalPolicyBundleResponse,
  PrincipalPolicyPageResponse,
} from "@tearleads/validators/response";
import type { ApiRequestRuntime } from "./apiRequestRuntime";
import { principalHistoryRequest } from "./principalHistoryRequest";
import { PrincipalHistoryRequestContext } from "./principalHistoryRequestContext";
import { getPrincipalPolicy } from "./routes/principals/policy";
import type { RequestResultOptions } from "./types";

function currentArtifacts(page: PrincipalPolicyPageResponse) {
  return {
    currentState: page.currentState,
    currentPayload: page.currentPayload,
    currentProjection: page.currentProjection,
    currentGrants: page.currentGrants,
    currentMemberEnvelopes: page.currentMemberEnvelopes,
  };
}

/** Collect bounded wire pages. Cryptographic verification belongs to the SDK. */
export async function collectPrincipalPolicyPages(
  runtime: ApiRequestRuntime,
  principalType: "group" | "organization",
  principalId: string,
  options: RequestResultOptions,
): Promise<PrincipalPolicyBundleResponse | null> {
  const firstPath = getPrincipalPolicy.path(principalType, principalId);
  const context = new PrincipalHistoryRequestContext(
    runtime,
    "GET",
    firstPath,
    options,
  );
  let pinned: ReturnType<typeof currentArtifacts> | undefined;
  let pinnedBytes: string | undefined;
  let afterVersion = 0;
  const previousStates: PrincipalPolicyBundleResponse["previousStates"] = [];
  while (true) {
    const path = pinned
      ? getPrincipalPolicy.path(principalType, principalId, {
          afterVersion,
          stateHash: pinned.currentState.stateHash,
        })
      : firstPath;
    const result = await principalHistoryRequest(runtime, {
      path,
      validator: getPrincipalPolicy.isResponse,
      method: "GET",
      operation: getPrincipalPolicyOperation,
      options,
      context,
    });
    if (!result.ok) return null;
    const page = result.data;
    const artifacts = currentArtifacts(page);
    const bytes = serializeKeyingCanonicalJson(artifacts);
    const lastVersion = afterVersion + page.previousStates.length;
    const valid =
      (!pinned || bytes === pinnedBytes) &&
      page.historyPage.afterVersion === afterVersion &&
      lastVersion < page.currentState.version &&
      page.previousStates.every(
        ({ state }, index) =>
          state.version === afterVersion + index + 1 &&
          state.principalId === page.currentState.principalId &&
          state.principalType === page.currentState.principalType,
      ) &&
      (page.historyPage.nextAfterVersion === null
        ? lastVersion === page.currentState.version - 1
        : lastVersion > afterVersion &&
          lastVersion < page.currentState.version - 1 &&
          page.historyPage.nextAfterVersion === lastVersion);
    if (!valid) {
      runtime.responseRequest.reportFailure({
        kind: "shape",
        message: "Principal history page changed its head, order, or cursor",
        method: "GET",
        options,
        path,
        status: 200,
        statusText: "",
      });
      return null;
    }
    pinned ??= artifacts;
    pinnedBytes ??= bytes;
    context.afterReadPage();
    previousStates.push(...page.previousStates);
    if (page.historyPage.nextAfterVersion === null)
      return { ...pinned, previousStates };
    afterVersion = page.historyPage.nextAfterVersion;
  }
}
