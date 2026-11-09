import type { PrincipalPolicyPageCurrent } from "@tearleads/api-client";
import {
  compareCanonicalStrings,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  computePrincipalStateHash,
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
import { principalHeadMatchesReference } from "../../../data/principals/organizationAuthorityDescriptor";

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
    // and that manifest names its epoch and event by hash. A rotation's signed
    // body commits its keyring hash, so a substituted keyring must refuse
    // here, before journal recovery clears the saved request. A grant that
    // keeps its epoch commits none; the container acknowledgement checks the
    // retained keyring against the epoch's own.
    const committedKeyringHash = Reflect.get(
      Object(request.body),
      "keyringHash",
    );
    if (
      response.manifestHead.manifestHash !== request.expectedManifestHash ||
      response.manifestHead.epoch !== Reflect.get(request.manifest, "epoch") ||
      response.eventHash !== Reflect.get(request.manifest, "eventHash") ||
      response.containerKek.containerKeyEpochId !== keyEpoch.id ||
      response.containerKek.containerKeyEpoch !== keyEpoch.keyEpoch ||
      response.containerKek.keyEpochHash !==
        (await computeContainerKeyEpochHash(keyEpoch)) ||
      (typeof committedKeyringHash === "string" &&
        response.containerKek.keyringHash !== committedKeyringHash) ||
      response.containerKek.keyTargetHash !==
        (await computeContainerKekRecipientTargetHash(recipientTargets))
    ) {
      throw new Error("Group policy container acknowledgement mismatch");
    }
  }
}

/**
 * The current an acknowledgement commits, rebuilt from this client's own
 * signed request: the server returns only the head it stored, the insertion
 * time it assigned to the state and payload, and hash-form container
 * acknowledgements. A head other than the one the request commits to refuses.
 * Nothing here manufactures predecessor history or pins.
 */
export async function acknowledgedPrincipalPolicyCurrent(input: {
  readonly request: PutPrincipalPolicyRequest;
  readonly response: PrincipalPolicyMutationResponse;
}): Promise<PrincipalPolicyPageCurrent> {
  const { request, response } = input;
  const { state } = request;
  const stateHash = await computePrincipalStateHash(state);
  if (
    !principalHeadMatchesReference(response.head, {
      principalType: state.principalType,
      principalId: state.principalId,
      version: state.version,
      keyEpoch: state.keyEpoch,
      stateHash,
      keyFingerprint: state.keyFingerprint,
    })
  )
    throw new Error("Principal policy acknowledgement names another head");
  await assertContainerMutationAcknowledgements({
    requests: request.containerMutations ?? [],
    responses: response.containerMutations,
  });
  const { principalType, principalId } = state;
  const { createdAt } = response;
  return {
    currentState: { ...state, stateHash, createdAt },
    currentPayload: {
      principalType,
      principalId,
      stateHash,
      ...request.encryptedPayload,
      createdAt,
    },
    currentProjection: request.projection,
    currentGrants: request.grants,
    currentMemberEnvelopes: {
      principalType,
      principalId,
      stateHash,
      epoch: state.keyEpoch,
      envelopes: request.memberEnvelopes,
    },
  };
}
