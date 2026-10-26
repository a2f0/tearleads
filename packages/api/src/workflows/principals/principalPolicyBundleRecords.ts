import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type {
  PrincipalContainerGrant,
  PrincipalProjectionMember,
  VerifiedPrincipalPolicyHistory,
} from "@tearleads/crypto";
import type {
  PrincipalPolicyBundleResponse,
  PrincipalPolicySnapshotResponse,
} from "@tearleads/validators/response";
import { listPrincipalMemberEnvelopesForState } from "../../access/read/principalMemberEnvelopes";
import { getPrincipalPolicyArtifactsForState } from "../../access/read/principalPolicyArtifacts";
import {
  getPrincipalStatePayloadForState,
  listContainerGrantsForState,
  listPrincipalStateHistory,
  listProjectionMembersForState,
  type StoredPrincipalState,
} from "../../access/read/principalStateStore";
import {
  PrincipalPolicyError,
  toCurrentPrincipalMemberEnvelopesResponse,
  toPrincipalStatePayloadResponse,
  toPrincipalStateResponse,
} from "./shared";

function toProjectionResponse(
  projection: ReadonlyArray<PrincipalProjectionMember>,
) {
  return projection.map((member) => ({
    userId: member.userId,
    role: member.role,
  }));
}

function toGrantResponse(grants: ReadonlyArray<PrincipalContainerGrant>) {
  return grants.map((grant) => ({
    accessLevel: grant.accessLevel,
    containerId: grant.containerId,
  }));
}

export async function buildPrincipalPolicyCurrentForStateWithExecutor(
  executor: DatabaseSession,
  currentState: StoredPrincipalState,
  verifiedHistory?: VerifiedPrincipalPolicyHistory,
): Promise<Omit<PrincipalPolicyBundleResponse, "previousStates">> {
  const { principalId, principalType } = currentState;
  // Every dependent read is pinned to this exact accepted state. In particular,
  // a concurrent successor cannot change which head a successful PUT
  // acknowledges under READ COMMITTED.
  const pinnedStateHash = currentState.stateHash;
  const artifacts = verifiedHistory
    ? await getPrincipalPolicyArtifactsForState(
        principalType,
        principalId,
        pinnedStateHash,
        executor,
      )
    : undefined;
  const currentPayload = artifacts
    ? artifacts.payload
    : await getPrincipalStatePayloadForState(
        principalType,
        principalId,
        pinnedStateHash,
        executor,
      );
  if (!currentPayload) {
    throw new PrincipalPolicyError("Principal state payload not found", 500);
  }
  // The verifier has just checked these stored artifacts against this head.
  // This is an explicit handoff, not a cache: payloads/envelopes are still read
  // here, and the caller binds the entire bundle to the history with crypto.
  const currentProjection =
    verifiedHistory?.currentEntry.projection ??
    (await listProjectionMembersForState(
      principalType,
      principalId,
      pinnedStateHash,
      executor,
    ));
  const currentGrants =
    verifiedHistory?.currentEntry.grants ??
    (await listContainerGrantsForState(
      principalType,
      principalId,
      pinnedStateHash,
      executor,
    ));
  const currentMemberEnvelopes =
    artifacts?.memberEnvelopes ??
    (await listPrincipalMemberEnvelopesForState(
      principalType,
      principalId,
      pinnedStateHash,
      executor,
    ));

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
  };
}

export async function buildPrincipalPolicyForStateWithExecutor(
  executor: DatabaseSession,
  currentState: StoredPrincipalState,
  current: Omit<PrincipalPolicyBundleResponse, "previousStates">,
): Promise<PrincipalPolicyBundleResponse> {
  const stateHistory = await listPrincipalStateHistory(currentState, executor);
  return {
    ...current,
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
  const stateHistory = await listPrincipalStateHistory(currentState, executor);
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
