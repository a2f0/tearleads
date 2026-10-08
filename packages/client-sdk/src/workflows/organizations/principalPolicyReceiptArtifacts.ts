import {
  compareCanonicalStrings,
  normalizePrincipalContainerGrants,
  normalizePrincipalProjectionMembers,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import type {
  ContainerMutationResponse,
  CurrentPrincipalMemberEnvelopesResponse,
  PrincipalPolicyMutationResponse,
} from "@tearleads/validators/response";
import { canonicalKeyingJsonString } from "../../data/keyingCanonicalJson";

function sortedCanonicalValues<T>(values: readonly T[], label: string): T[] {
  return [...values].sort((left, right) =>
    compareCanonicalStrings(
      canonicalKeyingJsonString(left, label),
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

/** Compare receipt artifacts without manufacturing predecessor history or pins. */
export function assertPrincipalPolicyReceiptArtifacts(input: {
  readonly expectedHead: ReferencedPrincipalHead;
  readonly request: PutPrincipalPolicyRequest;
  readonly response: PrincipalPolicyMutationResponse;
}): void {
  assertContainerMutationAcknowledgements({
    requests: input.request.containerMutations ?? [],
    responses: input.response.containerMutations,
  });
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
