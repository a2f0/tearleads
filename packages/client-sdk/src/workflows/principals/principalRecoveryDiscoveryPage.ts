import type { ApiClient, RequestSuccess } from "@tearleads/api-client";
import type { PrincipalPolicyPageResponse } from "@tearleads/validators/response";

/** Reuse the discovery bytes as untrusted input to the ordinary verifier. */
export function reusePrincipalDiscoveryPage(
  apiClient: Pick<ApiClient, "getPrincipalPolicyPages">,
  discovery: RequestSuccess<PrincipalPolicyPageResponse>,
): Pick<ApiClient, "getPrincipalPolicyPages"> {
  const first = structuredClone(discovery);
  const page = first.data;
  const current = {
    currentState: page.currentState,
    currentPayload: page.currentPayload,
    currentProjection: page.currentProjection,
    currentGrants: page.currentGrants,
    currentMemberEnvelopes: page.currentMemberEnvelopes,
  };
  return {
    async *getPrincipalPolicyPages(principalType, principalId, options = {}) {
      if (
        options.resume !== undefined ||
        (options.afterVersion ?? 0) !== 0 ||
        options.stateHash !== current.currentState.stateHash ||
        principalType !== current.currentState.principalType ||
        principalId !== current.currentState.principalId
      ) {
        yield* apiClient.getPrincipalPolicyPages(
          principalType,
          principalId,
          options,
        );
        return;
      }
      yield structuredClone(first);
      const next = page.historyPage.nextAfterVersion;
      if (next === null) return;
      // Resume binds every later page to these exact artifacts, including bytes
      // outside the signed head. The API client's cursor/shape checks still run.
      yield* apiClient.getPrincipalPolicyPages(principalType, principalId, {
        ...options,
        afterVersion: undefined,
        resume: { current, afterVersion: next },
      });
    },
  };
}
