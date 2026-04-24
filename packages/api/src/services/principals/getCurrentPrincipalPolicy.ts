import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { listCurrentPrincipalMemberEnvelopes } from "../../access/principalMemberEnvelopes";
import {
  getCurrentPrincipalState,
  getCurrentPrincipalStatePayload,
} from "../../access/principalStateStore";
import type { ApiServiceRuntime } from "../runtime";
import {
  PrincipalPolicyError,
  toCurrentPrincipalMemberEnvelopesResponse,
  toPrincipalStatePayloadResponse,
  toPrincipalStateResponse,
} from "./shared";

export async function getCurrentPrincipalPolicy(
  runtime: ApiServiceRuntime,
  principalType: "group" | "organization",
  principalId: string,
): Promise<PrincipalPolicyBundleResponse> {
  const currentState = await getCurrentPrincipalState(
    principalType,
    principalId,
    runtime.db,
  );

  if (!currentState) {
    throw new PrincipalPolicyError("Principal state not found", 404);
  }
  const currentPayload = await getCurrentPrincipalStatePayload(
    principalType,
    principalId,
    runtime.db,
  );
  if (!currentPayload) {
    throw new PrincipalPolicyError("Principal state payload not found", 404);
  }

  const currentMemberEnvelopes = await listCurrentPrincipalMemberEnvelopes(
    principalType,
    principalId,
    runtime.db,
  );

  return {
    currentState: toPrincipalStateResponse(currentState),
    currentPayload: toPrincipalStatePayloadResponse(currentPayload),
    currentMemberEnvelopes: toCurrentPrincipalMemberEnvelopesResponse({
      principalType,
      principalId,
      stateHash: currentState.stateHash,
      epoch: currentState.keyEpoch,
      envelopes: currentMemberEnvelopes,
    }),
  };
}
