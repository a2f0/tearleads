import {
  computePrincipalMemberEnvelopesRoot,
  computePrincipalMembershipRoot,
  computePrincipalProjectionRoot,
  computePrincipalStatePayloadCiphertextHash,
  makeVerifiedPrincipalPolicy,
  normalizePrincipalProjectionMembers,
  type ReferencedPrincipalHead,
  serializeKeyingCanonicalJson,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type {
  CreateOrganizationGroupRequest,
  PrincipalMemberEnvelopeRequest,
  PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import type {
  CurrentPrincipalMemberEnvelopesResponse,
  OrganizationGroupSummaryResponse,
  PrincipalPolicyBundleResponse,
  PrincipalStateResponse,
} from "@tearleads/validators/response";
import { readCanonicalJson } from "../../data/keyingCanonicalJson";

function canonical(value: unknown, label: string): string {
  return serializeKeyingCanonicalJson(readCanonicalJson(value, label));
}

function sortedEnvelopes(
  envelopes: readonly PrincipalMemberEnvelopeRequest[],
): PrincipalMemberEnvelopeRequest[] {
  return [...envelopes].sort((left, right) =>
    canonical(left, "principal member envelope").localeCompare(
      canonical(right, "principal member envelope"),
    ),
  );
}

export function assertGroupPolicyEnvelopesMatchAcknowledgement(
  expected: CurrentPrincipalMemberEnvelopesResponse,
  observed: CurrentPrincipalMemberEnvelopesResponse,
): void {
  const normalized = (value: CurrentPrincipalMemberEnvelopesResponse) => ({
    ...value,
    envelopes: sortedEnvelopes(value.envelopes),
  });
  if (
    canonical(normalized(expected), "acknowledged group member envelopes") !==
    canonical(normalized(observed), "observed group member envelopes")
  ) {
    throw new Error("Group member envelopes changed after acknowledgement");
  }
}

function stateWithoutCreatedAt(state: PrincipalStateResponse) {
  const { createdAt: _createdAt, ...signedState } = state;
  return signedState;
}

export function assertGroupPolicyBundleMatchesAcknowledgement(input: {
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly expectedHead: ReferencedPrincipalHead;
  readonly request: PutPrincipalPolicyRequest;
  readonly response: PrincipalPolicyBundleResponse;
}): void {
  const expectedPreviousStates = [
    ...input.currentPolicy.previousStates,
    {
      state: input.currentPolicy.currentState,
      projection: input.currentPolicy.currentProjection,
    },
  ];
  const normalizedHistory = (
    history: PrincipalPolicyBundleResponse["previousStates"],
  ) =>
    history.map((entry) => ({
      state: stateWithoutCreatedAt(entry.state),
      projection: normalizePrincipalProjectionMembers(entry.projection),
    }));
  const { createdAt: _payloadCreatedAt, ...observedPayload } =
    input.response.currentPayload;
  const expectedPayload = {
    principalType: input.request.state.principalType,
    principalId: input.request.state.principalId,
    stateHash: input.expectedHead.stateHash,
    ...input.request.encryptedPayload,
  };

  if (
    canonical(observedPayload, "stored group policy payload") !==
      canonical(expectedPayload, "authored group policy payload") ||
    canonical(
      normalizePrincipalProjectionMembers(input.response.currentProjection),
      "stored group policy projection",
    ) !==
      canonical(
        normalizePrincipalProjectionMembers(input.request.projection),
        "authored group policy projection",
      ) ||
    canonical(
      normalizedHistory(input.response.previousStates),
      "stored group policy history",
    ) !==
      canonical(
        normalizedHistory(expectedPreviousStates),
        "expected group policy history",
      )
  ) {
    throw new Error("Group policy bundle acknowledgement mismatch");
  }

  assertGroupPolicyEnvelopesMatchAcknowledgement(
    {
      principalType: input.request.state.principalType,
      principalId: input.request.state.principalId,
      stateHash: input.expectedHead.stateHash,
      epoch: input.request.state.keyEpoch,
      envelopes: input.request.memberEnvelopes,
    },
    input.response.currentMemberEnvelopes,
  );
}

async function assertPolicyRequestCommitments(
  request: PutPrincipalPolicyRequest,
): Promise<void> {
  const projection = normalizePrincipalProjectionMembers(request.projection);
  const members = projection.map((member) => ({ userId: member.userId }));
  const [
    membershipRoot,
    memberEnvelopesRoot,
    projectionRoot,
    payloadCiphertextHash,
  ] = await Promise.all([
    computePrincipalMembershipRoot(members),
    computePrincipalMemberEnvelopesRoot(request.memberEnvelopes),
    computePrincipalProjectionRoot(projection),
    computePrincipalStatePayloadCiphertextHash(
      request.encryptedPayload.ciphertext,
    ),
  ]);
  if (
    request.state.membershipRoot !== membershipRoot ||
    request.state.memberEnvelopesRoot !== memberEnvelopesRoot ||
    request.state.projectionRoot !== projectionRoot ||
    request.state.memberCount !== projection.length ||
    request.encryptedPayload.ciphertextHash !== payloadCiphertextHash ||
    request.state.payloadCiphertextHash !== payloadCiphertextHash
  ) {
    throw new Error("Authored group policy commitments are invalid");
  }
}

function verifiedPolicy(input: {
  currentPolicy?: PrincipalPolicyBundleResponse | undefined;
  projection: PutPrincipalPolicyRequest["projection"];
  state: PrincipalStateResponse;
}): VerifiedPrincipalPolicy {
  const previousStates = input.currentPolicy
    ? [
        ...input.currentPolicy.previousStates,
        {
          state: input.currentPolicy.currentState,
          projection: input.currentPolicy.currentProjection,
        },
      ]
    : [];
  return makeVerifiedPrincipalPolicy({
    checkpoint: {
      principalId: input.state.principalId,
      principalType: input.state.principalType,
      stateHash: input.state.stateHash,
      version: input.state.version,
    },
    history: [
      ...previousStates,
      { state: input.state, projection: input.projection },
    ],
    keyEpoch: input.state.keyEpoch,
    principalId: input.state.principalId,
    principalType: input.state.principalType,
    projection: input.projection,
    state: input.state,
    stateHash: input.state.stateHash,
    version: input.state.version,
  });
}

export async function acknowledgeGroupPolicyState(input: {
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly expectedHead: ReferencedPrincipalHead;
  readonly request: PutPrincipalPolicyRequest;
  readonly response: PrincipalStateResponse;
}): Promise<VerifiedPrincipalPolicy> {
  await assertPolicyRequestCommitments(input.request);
  const { createdAt: _createdAt, stateHash, ...responseState } = input.response;
  const previous = input.currentPolicy.currentState;
  if (
    stateHash !== input.expectedHead.stateHash ||
    input.response.principalType !== input.expectedHead.principalType ||
    input.response.principalId !== input.expectedHead.principalId ||
    input.response.version !== input.expectedHead.version ||
    input.response.keyEpoch !== input.expectedHead.keyEpoch ||
    input.response.keyFingerprint !== input.expectedHead.keyFingerprint ||
    input.response.principalType !== previous.principalType ||
    input.response.principalId !== previous.principalId ||
    input.response.version !== previous.version + 1 ||
    input.response.prevStateHash !== previous.stateHash ||
    canonical(responseState, "stored group policy state") !==
      canonical(input.request.state, "authored group policy state")
  ) {
    throw new Error("Group policy state acknowledgement mismatch");
  }
  return verifiedPolicy({
    currentPolicy: input.currentPolicy,
    projection: input.request.projection,
    state: input.response,
  });
}

/**
 * Materialize the locally signed successor before submission so dependent
 * container mutations can wrap to the exact head that will commit with it.
 * The server still performs the authoritative signature, transition, and
 * authorization checks inside the combined transaction.
 */
export async function prepareAuthoredGroupPolicy(input: {
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly expectedHead: ReferencedPrincipalHead;
  readonly request: PutPrincipalPolicyRequest;
}): Promise<VerifiedPrincipalPolicy> {
  await assertPolicyRequestCommitments(input.request);
  const previous = input.currentPolicy.currentState;
  const state = input.request.state;
  if (
    state.principalType !== input.expectedHead.principalType ||
    state.principalId !== input.expectedHead.principalId ||
    state.version !== input.expectedHead.version ||
    state.keyEpoch !== input.expectedHead.keyEpoch ||
    state.keyFingerprint !== input.expectedHead.keyFingerprint ||
    state.principalType !== previous.principalType ||
    state.principalId !== previous.principalId ||
    state.version !== previous.version + 1 ||
    state.prevStateHash !== previous.stateHash
  ) {
    throw new Error("Authored group policy successor is inconsistent");
  }
  return verifiedPolicy({
    currentPolicy: input.currentPolicy,
    projection: input.request.projection,
    state: {
      ...state,
      stateHash: input.expectedHead.stateHash,
      createdAt: state.signedAt,
    },
  });
}

export async function acknowledgeInitialGroupPolicy(input: {
  readonly organizationId: string;
  readonly request: CreateOrganizationGroupRequest;
  readonly response: OrganizationGroupSummaryResponse;
  readonly stateHash: string;
}): Promise<{
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly policy: VerifiedPrincipalPolicy;
}> {
  await assertPolicyRequestCommitments(input.request.initialGroupPolicy);
  const state = input.request.initialGroupPolicy.state;
  if (
    input.response.groupId !== input.request.groupId ||
    input.response.organizationId !== input.organizationId ||
    input.response.name !== input.request.name.trim() ||
    input.response.isBuiltin ||
    input.response.currentState?.stateHash !== input.stateHash ||
    input.response.currentState.version !== state.version ||
    input.response.currentState.keyEpoch !== state.keyEpoch ||
    input.response.currentState.memberCount !== state.memberCount ||
    state.principalType !== "group" ||
    state.principalId !== input.request.groupId ||
    state.version !== 1 ||
    state.prevStateHash !== null
  ) {
    throw new Error("Created group policy acknowledgement mismatch");
  }
  const storedState = {
    ...state,
    createdAt: input.response.createdAt,
    stateHash: input.stateHash,
  };
  const bundle: PrincipalPolicyBundleResponse = {
    currentMemberEnvelopes: {
      envelopes: input.request.initialGroupPolicy.memberEnvelopes,
      epoch: state.keyEpoch,
      principalId: state.principalId,
      principalType: state.principalType,
      stateHash: input.stateHash,
    },
    currentPayload: {
      principalId: state.principalId,
      principalType: state.principalType,
      stateHash: input.stateHash,
      ...input.request.initialGroupPolicy.encryptedPayload,
      createdAt: input.response.createdAt,
    },
    currentProjection: input.request.initialGroupPolicy.projection,
    currentState: storedState,
    previousStates: [],
  };
  return {
    bundle,
    policy: verifiedPolicy({
      projection: input.request.initialGroupPolicy.projection,
      state: storedState,
    }),
  };
}
