import {
  compareCanonicalStrings,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
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
import { canonicalKeyingJsonString } from "../../../data/keying/canonicalJson";
import {
  readContainerKeyEpoch,
  readContainerKeyWrap,
} from "../../../data/keyingProjectionVerification/readers";

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

/**
 * Each rematerialized container's acknowledgement names its commit by hash;
 * match every hash against the request this client authored.
 */
async function assertContainerMutationAcknowledgements(input: {
  readonly requests: readonly NonNullable<
    PutPrincipalPolicyRequest["containerMutations"]
  >[number][];
  readonly responses: readonly ContainerMutationResponse[] | undefined;
}): Promise<void> {
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
    const label = "authored group policy container mutation";
    const keyEpoch = readContainerKeyEpoch(request.keyEpoch, label);
    const recipientTargets = sortedCanonicalValues(
      request.wraps.map((value) => {
        const wrap = readContainerKeyWrap(value, label);
        return {
          recipientId: wrap.recipientId,
          recipientKeyEpochId: wrap.recipientKeyEpochId,
          recipientKeyFingerprint: wrap.recipientKeyFingerprint,
          recipientKind: wrap.recipientKind,
        };
      }),
      "authored recipient target",
    );
    // The request carries this client's own hash of the manifest it signed,
    // and that manifest names its epoch and event by hash.
    if (
      response.manifestHead.manifestHash !== request.expectedManifestHash ||
      response.manifestHead.epoch !== Reflect.get(request.manifest, "epoch") ||
      response.eventHash !== Reflect.get(request.manifest, "eventHash") ||
      response.containerKek.containerKeyEpochId !== keyEpoch.id ||
      response.containerKek.containerKeyEpoch !== keyEpoch.keyEpoch ||
      response.containerKek.keyEpochHash !==
        (await computeContainerKeyEpochHash(keyEpoch)) ||
      response.containerKek.keyTargetHash !==
        (await computeContainerKekRecipientTargetHash(recipientTargets))
    ) {
      throw new Error("Group policy container acknowledgement mismatch");
    }
  }
}

/** Compare receipt artifacts without manufacturing predecessor history or pins. */
export async function assertPrincipalPolicyReceiptArtifacts(input: {
  readonly expectedHead: ReferencedPrincipalHead;
  readonly request: PutPrincipalPolicyRequest;
  readonly response: PrincipalPolicyMutationResponse;
}): Promise<void> {
  await assertContainerMutationAcknowledgements({
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
