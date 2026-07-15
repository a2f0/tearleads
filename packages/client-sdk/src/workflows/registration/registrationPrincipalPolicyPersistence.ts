import {
  computePrincipalStateHash,
  makeVerifiedPrincipalPolicy,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type {
  CreateOrganizationGroupRequest,
  RegistrationRequest,
} from "@tearleads/validators/request";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { persistLocallyAcknowledgedPrincipalPolicyBundles } from "../../data/persistence/locallyAcknowledgedCheckpointPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

export async function principalPolicyBundleFromInitialGroupRequest(
  input: CreateOrganizationGroupRequest,
): Promise<PrincipalPolicyBundleResponse> {
  const createdAt = new Date().toISOString();
  const stateHash = await computePrincipalStateHash(
    input.initialGroupPolicy.state,
  );

  return {
    currentState: { ...input.initialGroupPolicy.state, stateHash, createdAt },
    currentPayload: {
      principalType: "group",
      principalId: input.groupId,
      stateHash,
      ...input.initialGroupPolicy.encryptedPayload,
      createdAt,
    },
    currentProjection: input.initialGroupPolicy.projection,
    currentMemberEnvelopes: {
      principalType: "group",
      principalId: input.groupId,
      stateHash,
      epoch: input.initialGroupPolicy.state.keyEpoch,
      envelopes: input.initialGroupPolicy.memberEnvelopes,
    },
    previousStates: [],
  };
}

export async function principalPolicyBundleFromInitialOrganizationRequest(
  input: RegistrationRequest["initialOrganizationPolicy"],
): Promise<PrincipalPolicyBundleResponse> {
  const createdAt = new Date().toISOString();
  const stateHash = await computePrincipalStateHash(input.state);
  return {
    currentState: { ...input.state, stateHash, createdAt },
    currentPayload: {
      principalType: "organization",
      principalId: input.state.principalId,
      stateHash,
      ...input.encryptedPayload,
      createdAt,
    },
    currentProjection: input.projection,
    currentMemberEnvelopes: {
      principalType: "organization",
      principalId: input.state.principalId,
      stateHash,
      epoch: input.state.keyEpoch,
      envelopes: input.memberEnvelopes,
    },
    previousStates: [],
  };
}

export async function verifiedPrincipalPolicyFromInitialGroupRequest(
  input: CreateOrganizationGroupRequest,
): Promise<VerifiedPrincipalPolicy> {
  const bundle = await principalPolicyBundleFromInitialGroupRequest(input);

  return verifiedPrincipalPolicyFromBundle(bundle);
}

function verifiedPrincipalPolicyFromBundle(
  bundle: PrincipalPolicyBundleResponse,
): VerifiedPrincipalPolicy {
  return makeVerifiedPrincipalPolicy({
    principalType: bundle.currentState.principalType,
    principalId: bundle.currentState.principalId,
    version: bundle.currentState.version,
    keyEpoch: bundle.currentState.keyEpoch,
    stateHash: bundle.currentState.stateHash,
    state: bundle.currentState,
    projection: bundle.currentProjection,
    history: [
      ...bundle.previousStates,
      { state: bundle.currentState, projection: bundle.currentProjection },
    ],
    checkpoint: {
      principalType: bundle.currentState.principalType,
      principalId: bundle.currentState.principalId,
      version: bundle.currentState.version,
      stateHash: bundle.currentState.stateHash,
    },
  });
}

export async function persistRegistrationPrincipalPolicies(input: {
  readonly adminGroup: PrincipalPolicyBundleResponse;
  readonly execSql: ExecSql;
  readonly memberGroup: PrincipalPolicyBundleResponse;
  readonly organization: PrincipalPolicyBundleResponse;
}): Promise<void> {
  await persistLocallyAcknowledgedPrincipalPolicyBundles({
    entries: [input.adminGroup, input.memberGroup, input.organization].map(
      (bundle) => ({
        bundle,
        policy: verifiedPrincipalPolicyFromBundle(bundle),
      }),
    ),
    execSql: input.execSql,
    updatedAt: new Date().toISOString(),
  });
}
