import type { RequestResult } from "@tearleads/api-client";
import type { RootIdentitySuspensionResponse } from "@tearleads/validators/response";
import {
  type RootIdentity,
  type RootRequestOutcome,
  toOutcome,
} from "./identities";

export interface RootSuspensionApi {
  liftRootIdentitySuspensionResult(
    userId: string,
  ): Promise<RequestResult<RootIdentitySuspensionResponse>>;
  suspendRootIdentityResult(
    userId: string,
  ): Promise<RequestResult<RootIdentitySuspensionResponse>>;
}

function identityOutcome(
  result: RequestResult<RootIdentitySuspensionResponse>,
): RootRequestOutcome<RootIdentity> {
  return result.ok
    ? { data: result.data.identity, ok: true }
    : toOutcome(result);
}

/**
 * Signs the identity out of every device and refuses its sign-in until the
 * suspension is lifted. Root identities are refused with status 409.
 */
export async function suspendRootIdentity(
  api: RootSuspensionApi,
  userId: string,
): Promise<RootRequestOutcome<RootIdentity>> {
  return identityOutcome(await api.suspendRootIdentityResult(userId));
}

export async function liftRootIdentitySuspension(
  api: RootSuspensionApi,
  userId: string,
): Promise<RootRequestOutcome<RootIdentity>> {
  return identityOutcome(await api.liftRootIdentitySuspensionResult(userId));
}
