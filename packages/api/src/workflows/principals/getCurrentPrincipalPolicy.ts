import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { listPrincipalMemberEnvelopesForState } from "../../access/read/principalMemberEnvelopes";
import {
  getCurrentPrincipalState,
  getPrincipalStatePayloadForState,
  listPrincipalStateHistory,
  listProjectionMembersForState,
  type StoredPrincipalProjectionMember,
} from "../../access/read/principalStateStore";
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

export async function getCurrentPrincipalPolicyWithExecutor(
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
  // Pin every dependent read to the version we just resolved. These reads run
  // under READ COMMITTED (no isolation argument; this workflow can also be
  // nested inside a container mutation transaction where forcing an isolation
  // level is not possible), so re-resolving "current" per read would let a
  // concurrent putPrincipalState advance the version mid-bundle and stitch a
  // cross-version policy bundle. Keying every read off currentState.stateHash
  // makes the bundle internally consistent regardless of concurrent commits.
  const pinnedStateHash = currentState.stateHash;
  const currentPayload = await getPrincipalStatePayloadForState(
    principalType,
    principalId,
    pinnedStateHash,
    executor,
  );
  if (!currentPayload) {
    throw new PrincipalPolicyError("Principal state payload not found", 404);
  }
  const currentProjection = await listProjectionMembersForState(
    principalType,
    principalId,
    pinnedStateHash,
    executor,
  );
  const stateHistory = await listPrincipalStateHistory(
    principalType,
    principalId,
    executor,
  );

  const currentMemberEnvelopes = await listPrincipalMemberEnvelopesForState(
    principalType,
    principalId,
    pinnedStateHash,
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

export async function runGetCurrentPrincipalPolicyWorkflow(
  db: ApiDatabase,
  principalType: "group" | "organization",
  principalId: string,
): Promise<PrincipalPolicyBundleResponse> {
  return db.transaction((tx) =>
    getCurrentPrincipalPolicyWithExecutor(tx, principalType, principalId),
  );
}
