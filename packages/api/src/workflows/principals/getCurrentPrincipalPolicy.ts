import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { listCurrentPrincipalMemberEnvelopes } from "../../access/read/principalMemberEnvelopes";
import {
  getCurrentPrincipalState,
  getCurrentPrincipalStatePayload,
  listCurrentPrincipalProjectionMembers,
  listPrincipalStateHistory,
  type StoredPrincipalProjectionMember,
} from "../../access/read/principalStateStore";
import type { DatabaseSession } from "../../adapters/postgres";
import {
  PrincipalPolicyError,
  toCurrentPrincipalMemberEnvelopesResponse,
  toPrincipalStatePayloadResponse,
  toPrincipalStateResponse,
} from "./shared";

function toProjectionResponse(
  projection: ReadonlyArray<StoredPrincipalProjectionMember>,
) {
  return projection.map((member) => ({
    memberPrincipalType: member.memberPrincipalType,
    memberPrincipalId: member.memberPrincipalId,
    role: member.role,
  }));
}

export async function runGetCurrentPrincipalPolicyWorkflow(
  executor: DatabaseSession,
  principalType: "group" | "organization",
  principalId: string,
): Promise<PrincipalPolicyBundleResponse> {
  const currentState = await getCurrentPrincipalState(
    principalType,
    principalId,
    executor,
  );

  if (!currentState) {
    throw new PrincipalPolicyError("Principal state not found", 404);
  }
  const currentPayload = await getCurrentPrincipalStatePayload(
    principalType,
    principalId,
    executor,
  );
  if (!currentPayload) {
    throw new PrincipalPolicyError("Principal state payload not found", 404);
  }
  const currentProjection = await listCurrentPrincipalProjectionMembers(
    principalType,
    principalId,
    executor,
  );
  const stateHistory = await listPrincipalStateHistory(
    principalType,
    principalId,
    executor,
  );

  const currentMemberEnvelopes = await listCurrentPrincipalMemberEnvelopes(
    principalType,
    principalId,
    executor,
  );

  return {
    currentState: toPrincipalStateResponse(currentState),
    currentPayload: toPrincipalStatePayloadResponse(currentPayload),
    currentProjection: toProjectionResponse(currentProjection),
    currentMemberEnvelopes: toCurrentPrincipalMemberEnvelopesResponse({
      principalType,
      principalId,
      stateHash: currentState.stateHash,
      epoch: currentState.keyEpoch,
      envelopes: currentMemberEnvelopes,
    }),
    previousStates: stateHistory
      .filter((entry) => entry.state.version < currentState.version)
      .map((entry) => ({
        state: toPrincipalStateResponse(entry.state),
        projection: toProjectionResponse(entry.projection),
      })),
  };
}
