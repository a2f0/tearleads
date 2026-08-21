import {
  computePrincipalContainerGrantRoot,
  computePrincipalMemberEnvelopesRoot,
  computePrincipalMembershipRoot,
  computePrincipalProjectionRoot,
  computePrincipalStatePayloadCiphertextHash,
  makeVerifiedPrincipalPolicy,
  normalizePrincipalContainerGrants,
  normalizePrincipalProjectionMembers,
  type ReferencedPrincipalHead,
  type VerifiedPrincipalPolicy,
} from "@symcrypt/crypto";
import type {
  CreateOrganizationGroupRequest,
  PutPrincipalPolicyRequest,
} from "@symcrypt/validators/request";
import type {
  ContainerMutationResponse,
  CurrentPrincipalMemberEnvelopesResponse,
  OrganizationGroupSummaryResponse,
  PrincipalPolicyBundleResponse,
  PrincipalPolicyMutationResponse,
  PrincipalStateResponse,
} from "@symcrypt/validators/response";
import { canonicalKeyingJsonString } from "../../data/keyingCanonicalJson";

function sortedCanonicalValues<T>(values: readonly T[], label: string): T[] {
  return [...values].sort((left, right) =>
    canonicalKeyingJsonString(left, label).localeCompare(
      canonicalKeyingJsonString(right, label),
    ),
  );
}

export function assertGroupPolicyEnvelopesMatchAcknowledgement(
  expected: CurrentPrincipalMemberEnvelopesResponse,
  observed: CurrentPrincipalMemberEnvelopesResponse,
): void {
  const normalized = (value: CurrentPrincipalMemberEnvelopesResponse) => ({
    ...value,
    envelopes: sortedCanonicalValues(
      value.envelopes,
      "principal member envelope",
    ),
  });
  if (
    canonicalKeyingJsonString(
      normalized(expected),
      "acknowledged group member envelopes",
    ) !==
    canonicalKeyingJsonString(
      normalized(observed),
      "observed group member envelopes",
    )
  ) {
    throw new Error("Group member envelopes changed after acknowledgement");
  }
}

function stateWithoutCreatedAt(state: PrincipalStateResponse) {
  const { createdAt: _createdAt, ...signedState } = state;
  return signedState;
}

function assertContainerMutationAcknowledgements(input: {
  readonly requests: readonly NonNullable<
    PutPrincipalPolicyRequest["containerMutations"]
  >[number][];
  readonly responses: readonly ContainerMutationResponse[] | undefined;
}): void {
  if (!input.responses || input.responses.length !== input.requests.length) {
    throw new Error(
      "Group policy container acknowledgement batch is incomplete",
    );
  }
  for (const [index, request] of input.requests.entries()) {
    const response = input.responses[index];
    if (!response) {
      throw new Error(
        "Group policy container acknowledgement batch is incomplete",
      );
    }
    const expected = {
      body: request.body,
      event: request.event,
      keyEpoch: request.keyEpoch,
      manifest: request.manifest,
      wraps: sortedCanonicalValues(request.wraps, "authored container wrap"),
    };
    const observed = {
      body: response.accessManifest.event.body,
      event: response.accessManifest.event.event,
      keyEpoch: response.containerKek.keyEpoch,
      manifest: response.accessManifest.manifest,
      wraps: sortedCanonicalValues(
        response.containerKek.wraps,
        "stored container wrap",
      ),
    };
    if (
      canonicalKeyingJsonString(
        observed,
        "stored group policy container mutation",
      ) !==
      canonicalKeyingJsonString(
        expected,
        "authored group policy container mutation",
      )
    ) {
      throw new Error("Group policy container acknowledgement mismatch");
    }
  }
}

function historyWithCurrent(
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicyBundleResponse["previousStates"] {
  return [
    ...bundle.previousStates,
    {
      state: bundle.currentState,
      projection: bundle.currentProjection,
      grants: bundle.currentGrants,
    },
  ];
}

function isAuthoredSuccessorConsistent(
  state: Pick<
    PrincipalStateResponse,
    | "keyEpoch"
    | "keyFingerprint"
    | "prevStateHash"
    | "principalId"
    | "principalType"
    | "version"
  >,
  expectedHead: ReferencedPrincipalHead,
  previous: PrincipalStateResponse,
): boolean {
  return (
    state.principalType === expectedHead.principalType &&
    state.principalId === expectedHead.principalId &&
    state.version === expectedHead.version &&
    state.keyEpoch === expectedHead.keyEpoch &&
    state.keyFingerprint === expectedHead.keyFingerprint &&
    state.principalType === previous.principalType &&
    state.principalId === previous.principalId &&
    state.version === previous.version + 1 &&
    state.prevStateHash === previous.stateHash
  );
}

export function assertGroupPolicyBundleMatchesAcknowledgement(input: {
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly expectedHead: ReferencedPrincipalHead;
  readonly request: PutPrincipalPolicyRequest;
  readonly response: PrincipalPolicyMutationResponse;
}): void {
  assertContainerMutationAcknowledgements({
    requests: input.request.containerMutations ?? [],
    responses: input.response.containerMutations,
  });
  const expectedPreviousStates = historyWithCurrent(input.currentPolicy);
  const normalizedHistory = (
    history: PrincipalPolicyBundleResponse["previousStates"],
  ) =>
    history.map((entry) => ({
      state: stateWithoutCreatedAt(entry.state),
      projection: normalizePrincipalProjectionMembers(entry.projection),
      grants: normalizePrincipalContainerGrants(entry.grants),
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
    canonicalKeyingJsonString(
      observedPayload,
      "stored group policy payload",
    ) !==
      canonicalKeyingJsonString(
        expectedPayload,
        "authored group policy payload",
      ) ||
    canonicalKeyingJsonString(
      normalizePrincipalProjectionMembers(input.response.currentProjection),
      "stored group policy projection",
    ) !==
      canonicalKeyingJsonString(
        normalizePrincipalProjectionMembers(input.request.projection),
        "authored group policy projection",
      ) ||
    canonicalKeyingJsonString(
      normalizePrincipalContainerGrants(input.response.currentGrants),
      "stored group policy grants",
    ) !==
      canonicalKeyingJsonString(
        normalizePrincipalContainerGrants(input.request.grants),
        "authored group policy grants",
      ) ||
    canonicalKeyingJsonString(
      normalizedHistory(input.response.previousStates),
      "stored group policy history",
    ) !==
      canonicalKeyingJsonString(
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
    grantRoot,
  ] = await Promise.all([
    computePrincipalMembershipRoot(members),
    computePrincipalMemberEnvelopesRoot(request.memberEnvelopes),
    computePrincipalProjectionRoot(projection),
    computePrincipalStatePayloadCiphertextHash(
      request.encryptedPayload.ciphertext,
    ),
    computePrincipalContainerGrantRoot(request.grants),
  ]);
  if (
    request.state.membershipRoot !== membershipRoot ||
    request.state.memberEnvelopesRoot !== memberEnvelopesRoot ||
    request.state.projectionRoot !== projectionRoot ||
    request.state.memberCount !== projection.length ||
    request.state.grantRoot !== grantRoot ||
    request.state.grantCount !== request.grants.length ||
    request.encryptedPayload.ciphertextHash !== payloadCiphertextHash ||
    request.state.payloadCiphertextHash !== payloadCiphertextHash
  ) {
    throw new Error("Authored group policy commitments are invalid");
  }
}

function verifiedPolicy(input: {
  currentPolicy?: PrincipalPolicyBundleResponse | undefined;
  projection: PutPrincipalPolicyRequest["projection"];
  grants: PutPrincipalPolicyRequest["grants"];
  state: PrincipalStateResponse;
}): VerifiedPrincipalPolicy {
  const previousStates = input.currentPolicy
    ? historyWithCurrent(input.currentPolicy)
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
      {
        state: input.state,
        projection: input.projection,
        grants: input.grants,
      },
    ],
    keyEpoch: input.state.keyEpoch,
    principalId: input.state.principalId,
    principalType: input.state.principalType,
    projection: input.projection,
    grants: input.grants,
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
    !isAuthoredSuccessorConsistent(
      input.response,
      input.expectedHead,
      previous,
    ) ||
    canonicalKeyingJsonString(responseState, "stored group policy state") !==
      canonicalKeyingJsonString(
        input.request.state,
        "authored group policy state",
      )
  ) {
    throw new Error("Group policy state acknowledgement mismatch");
  }
  return verifiedPolicy({
    currentPolicy: input.currentPolicy,
    projection: input.request.projection,
    grants: input.request.grants,
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
  if (!isAuthoredSuccessorConsistent(state, input.expectedHead, previous)) {
    throw new Error("Authored group policy successor is inconsistent");
  }
  return verifiedPolicy({
    currentPolicy: input.currentPolicy,
    projection: input.request.projection,
    grants: input.request.grants,
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
    currentGrants: input.request.initialGroupPolicy.grants,
    currentState: storedState,
    previousStates: [],
  };
  return {
    bundle,
    policy: verifiedPolicy({
      projection: input.request.initialGroupPolicy.projection,
      grants: input.request.initialGroupPolicy.grants,
      state: storedState,
    }),
  };
}
