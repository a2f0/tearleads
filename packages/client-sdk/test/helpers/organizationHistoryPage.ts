import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { ProjectionPolicyHistoryResolveRequest } from "../../src/data/keyingProjectionVerification/types";
import { recoverProjectionPolicyHistory } from "../../src/workflows/principals/recoverProjectionPolicyHistory";
import { createOrganizationHistoryFixture } from "./organizationPolicyHistory";
import { principalPolicyHead } from "./principalPolicyFixtures";
import { createPublicHistoryFixture } from "./publicPrincipalHistory";

export function organizationHistoryPage(
  bundle: PrincipalPolicyBundleResponse,
  beforeVersion = bundle.currentState.version + 1,
) {
  const entries = [
    ...bundle.previousStates,
    {
      state: bundle.currentState,
      projection: bundle.currentProjection,
      grants: bundle.currentGrants,
    },
  ];
  const start = Math.max(1, beforeVersion - 32);
  return {
    head: principalPolicyHead(bundle),
    page: {
      entries: entries.filter(
        ({ state }) => state.version >= start && state.version < beforeVersion,
      ),
      predecessor:
        entries.find(({ state }) => state.version === start - 1) ?? null,
      nextBeforeVersion: start > 1 ? start : null,
    },
  };
}

export async function createOrganizationHistoryPageFixture() {
  const data = await createOrganizationHistoryFixture();
  const http = await createPublicHistoryFixture(
    {
      bundle: data.afterAddition,
      resolveTrustedUserIdentity: data.resolveTrustedUserIdentity,
    },
    data.projectionBundles,
  );
  const resolveHistory = async (
    request: ProjectionPolicyHistoryResolveRequest,
  ) => ({
    policies: await recoverProjectionPolicyHistory({
      ...http.options,
      ...request,
      stillCurrent: request.stillCurrent ?? (() => true),
    }),
    stillCurrent: request.stillCurrent ?? (() => true),
  });
  return {
    data,
    http,
    close: http.close,
    input: {
      ...organizationHistoryPage(data.afterAddition),
      evidence: data.evidence(),
      resolveHistory,
      stillCurrent: () => true,
    },
  };
}
