import type {
  PrincipalPolicyBundleResponse,
  PrincipalPolicyPageResponse,
} from "@tearleads/validators/response";
import { PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT } from "@tearleads/validators/util";

export function principalPolicyPageResponse(
  bundle: PrincipalPolicyBundleResponse,
  afterVersion = 0,
): PrincipalPolicyPageResponse {
  const previousStates = bundle.previousStates.slice(
    afterVersion,
    afterVersion + PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT,
  );
  const through = afterVersion + previousStates.length;
  return {
    ...bundle,
    previousStates,
    historyPage: {
      afterVersion,
      nextAfterVersion:
        through === bundle.currentState.version - 1 ? null : through,
    },
  };
}
