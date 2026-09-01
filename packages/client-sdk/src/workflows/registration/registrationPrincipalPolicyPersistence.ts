import {
  computePrincipalStateHash,
  makeVerifiedPrincipalPolicy,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type {
  CreateOrganizationGroupRequest,
  PutPrincipalPolicyRequest,
  RegistrationRequest,
} from "@tearleads/validators/request";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { persistLocallyAcknowledgedPrincipalPolicyBundles } from "../../data/persistence/locallyAcknowledgedCheckpointPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

async function principalPolicyBundleFromInitialRequest(
  principalType: "group" | "organization",
  principalId: string,
  policy: PutPrincipalPolicyRequest,
): Promise<PrincipalPolicyBundleResponse> {
  const createdAt = new Date().toISOString();
  const stateHash = await computePrincipalStateHash(policy.state);

  return {
    currentState: { ...policy.state, stateHash, createdAt },
    currentPayload: {
      principalType,
      principalId,
      stateHash,
      ...policy.encryptedPayload,
      createdAt,
    },
    currentGrants: policy.grants,
    currentProjection: policy.projection,
    currentMemberEnvelopes: {
      principalType,
      principalId,
      stateHash,
      epoch: policy.state.keyEpoch,
      envelopes: policy.memberEnvelopes,
    },
    previousStates: [],
  };
}

export async function principalPolicyBundleFromInitialGroupRequest(
  input: CreateOrganizationGroupRequest,
): Promise<PrincipalPolicyBundleResponse> {
  return principalPolicyBundleFromInitialRequest(
    "group",
    input.groupId,
    input.initialGroupPolicy,
  );
}

export async function principalPolicyBundleFromInitialOrganizationRequest(
  input: RegistrationRequest["initialOrganizationPolicy"],
): Promise<PrincipalPolicyBundleResponse> {
  return principalPolicyBundleFromInitialRequest(
    "organization",
    input.state.principalId,
    input,
  );
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
    grants: bundle.currentGrants,
    history: [
      ...bundle.previousStates,
      {
        state: bundle.currentState,
        projection: bundle.currentProjection,
        grants: bundle.currentGrants,
      },
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
    organizationId: input.organization.currentState.principalId,
    updatedAt: new Date().toISOString(),
  });
}
