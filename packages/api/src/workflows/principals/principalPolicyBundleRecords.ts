import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type {
  PrincipalPolicyBundleResponse,
  PrincipalPolicySnapshotResponse,
} from "@tearleads/validators/response";
import { listPrincipalMemberEnvelopesForState } from "../../access/read/principalMemberEnvelopes";
import {
  getPrincipalStatePayloadForState,
  listContainerGrantsForState,
  listPrincipalStateHistory,
  listProjectionMembersForState,
  type StoredPrincipalContainerGrant,
  type StoredPrincipalProjectionMember,
  type StoredPrincipalState,
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
    userId: member.userId,
    role: member.role,
  }));
}

function toGrantResponse(grants: ReadonlyArray<StoredPrincipalContainerGrant>) {
  return grants.map((grant) => ({
    accessLevel: grant.accessLevel,
    containerId: grant.containerId,
  }));
}

export async function buildPrincipalPolicyForStateWithExecutor(
  executor: DatabaseSession,
  currentState: StoredPrincipalState,
): Promise<PrincipalPolicyBundleResponse> {
  const { principalId, principalType } = currentState;
  // Every dependent read is pinned to this exact accepted state. In particular,
  // a concurrent successor cannot change which head a successful PUT
  // acknowledges under READ COMMITTED.
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
  const currentGrants = await listContainerGrantsForState(
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
    currentGrants: toGrantResponse(currentGrants),
    currentMemberEnvelopes: toCurrentPrincipalMemberEnvelopesResponse({
      principalType,
      principalId,
      stateHash: pinnedStateHash,
      epoch: currentState.keyEpoch,
      envelopes: currentMemberEnvelopes,
    }),
    previousStates: stateHistory
      .filter((entry) => entry.state.version < currentState.version)
      .map((entry) => ({
        state: toPrincipalStateResponse(entry.state),
        projection: toProjectionResponse(entry.projection),
        grants: toGrantResponse(entry.grants),
      })),
  };
}

export async function buildPrincipalPolicySnapshotForStateWithExecutor(
  executor: DatabaseSession,
  currentState: StoredPrincipalState,
): Promise<PrincipalPolicySnapshotResponse> {
  const { principalId, principalType } = currentState;
  const currentProjection = await listProjectionMembersForState(
    principalType,
    principalId,
    currentState.stateHash,
    executor,
  );
  const currentGrants = await listContainerGrantsForState(
    principalType,
    principalId,
    currentState.stateHash,
    executor,
  );
  const stateHistory = await listPrincipalStateHistory(
    principalType,
    principalId,
    executor,
  );
  return {
    currentState: toPrincipalStateResponse(currentState),
    currentProjection: toProjectionResponse(currentProjection),
    currentGrants: toGrantResponse(currentGrants),
    previousStates: stateHistory
      .filter((entry) => entry.state.version < currentState.version)
      .map((entry) => ({
        state: toPrincipalStateResponse(entry.state),
        projection: toProjectionResponse(entry.projection),
        grants: toGrantResponse(entry.grants),
      })),
  };
}
