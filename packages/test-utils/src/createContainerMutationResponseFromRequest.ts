import {
  type AccessEvent,
  type ContainerAccessEventBody,
  type ContainerAccessManifestState,
  type ContainerDirectGrant,
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  computeAccessEventHash,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import {
  type ContainerMutationResponse,
  type ContainerWriterProjectionResponse,
  isAccessManifestBundleWireResponse,
} from "@tearleads/validators/response";

type ProjectionKek = ContainerWriterProjectionResponse["containerKeks"][number];

type PrincipalIdentity = {
  subjectId?: string | undefined;
  subjectType?: string | undefined;
  principalId?: string | undefined;
  principalType?: string | undefined;
};

function principalKey(value: PrincipalIdentity): string {
  return `${value.subjectType ?? value.principalType}:${
    value.subjectId ?? value.principalId
  }`;
}

function sortedUpsert<T extends PrincipalIdentity>(
  values: readonly T[],
  value: T,
): T[] {
  return [
    ...values.filter(
      (candidate) => principalKey(candidate) !== principalKey(value),
    ),
    value,
  ].sort((left, right) =>
    principalKey(left).localeCompare(principalKey(right)),
  );
}

function previousState(
  request: ContainerMutationRequest,
): ContainerAccessManifestState {
  const state = request.previousManifest?.state;
  if (!state) {
    throw new Error(
      "Container mutation response fixture requires previous state",
    );
  }
  return state as unknown as ContainerAccessManifestState;
}

function deriveMutationState(input: {
  body: ContainerAccessEventBody;
  event: AccessEvent;
  eventHash: string;
  request: ContainerMutationRequest;
}): ContainerAccessManifestState {
  const { body, event, eventHash, request } = input;
  if (body.eventType === "container.create") {
    return {
      containerId: event.objectId,
      containerKeyEpochId: body.containerKeyEpochId,
      directGrants: [...body.directGrants],
      epoch: 1,
      eventHash,
      metadataDocumentId: body.metadataDocumentId,
      organizationId: event.organizationId,
      parentContainerId: body.parentContainerId,
      parentManifestHash: body.parentManifestHash,
      previousManifestHash: null,
      referencedPrincipalHeads: [...body.referencedPrincipalHeads],
      version: 1,
    };
  }

  const previous = previousState(request);
  const base = {
    ...previous,
    epoch: previous.epoch + 1,
    eventHash,
    previousManifestHash: request.previousManifest?.manifestHash ?? null,
  };
  if (body.eventType === "container.grant") {
    return {
      ...base,
      containerKeyEpochId: body.containerKeyEpochId,
      directGrants: sortedUpsert<ContainerDirectGrant>(
        previous.directGrants,
        body.grant,
      ),
      referencedPrincipalHeads: body.referencedPrincipalHead
        ? sortedUpsert<ReferencedPrincipalHead>(
            previous.referencedPrincipalHeads,
            body.referencedPrincipalHead,
          )
        : previous.referencedPrincipalHeads,
    };
  }
  if (body.eventType === "container.revoke") {
    const revokedKey = `${body.subjectType}:${body.subjectId}`;
    return {
      ...base,
      containerKeyEpochId: body.containerKeyEpochId,
      directGrants: previous.directGrants.filter(
        (grant) => principalKey(grant) !== revokedKey,
      ),
      referencedPrincipalHeads:
        body.subjectType === "user"
          ? previous.referencedPrincipalHeads
          : previous.referencedPrincipalHeads.filter(
              (head) => principalKey(head) !== revokedKey,
            ),
    };
  }
  if (body.eventType === "container.move") {
    return {
      ...base,
      containerKeyEpochId: body.containerKeyEpochId,
      parentContainerId: body.parentContainerId,
      parentManifestHash: body.parentManifestHash,
    };
  }
  return {
    ...base,
    containerKeyEpochId: body.containerKeyEpochId,
    referencedPrincipalHeads: [
      ...(body.referencedPrincipalHeads ?? previous.referencedPrincipalHeads),
    ],
  };
}

export async function createContainerMutationResponseFromRequest(
  request: ContainerMutationRequest,
  previousKek?: ProjectionKek | undefined,
): Promise<ContainerMutationResponse> {
  const event = request.event as unknown as AccessEvent;
  const body = request.body as ContainerAccessEventBody;
  const keyEpoch = request.keyEpoch as unknown as ContainerKeyEpoch;
  const wraps = request.wraps as unknown as ContainerKeyWrap[];
  const recipientTargets = wraps.map((wrap) => ({
    recipientId: wrap.recipientId,
    recipientKeyEpochId: wrap.recipientKeyEpochId,
    recipientKeyFingerprint: wrap.recipientKeyFingerprint,
    recipientKind: wrap.recipientKind,
  }));
  const eventHash = await computeAccessEventHash(event);
  const state = deriveMutationState({ body, event, eventHash, request });
  const containerManifestHistory = (request.containerManifestHistory ?? []).map(
    (bundle) => {
      if (!isAccessManifestBundleWireResponse(bundle)) {
        throw new Error(
          "Container mutation response fixture requires response-shaped manifest history",
        );
      }
      return bundle;
    },
  );
  const keyring = keyringFromRequest({
    currentKeyEpoch: keyEpoch,
    previousKek,
    request,
  });

  return {
    containerId: event.objectId,
    createdAt: "2026-05-05T00:00:00.000Z",
    organizationId: event.organizationId,
    parentId: state.parentContainerId,
    updatedAt: "2026-05-05T00:00:00.000Z",
    manifestHead: {
      epoch: state.epoch,
      manifestHash: request.expectedManifestHash,
    },
    accessManifest: {
      event: {
        event: request.event,
        body: request.body as Record<string, unknown>,
        eventHash,
      },
      manifest: request.manifest,
      manifestHash: request.expectedManifestHash,
      state: state as unknown as Record<string, unknown>,
    },
    containerKek: {
      containerId: event.objectId,
      accessManifestHash: request.expectedManifestHash,
      containerKeyEpochId: keyEpoch.id,
      containerKeyEpoch: keyEpoch.keyEpoch,
      keyEpoch: request.keyEpoch,
      keyEpochHash: await computeContainerKeyEpochHash(keyEpoch),
      keyTargetHash:
        await computeContainerKekRecipientTargetHash(recipientTargets),
      parentContainerKeyEpochId: keyEpoch.parentContainerKeyEpochId,
      containerManifestHistory,
      keyring,
      recipientTargets: recipientTargets as unknown as Record<
        string,
        unknown
      >[],
      wraps: request.wraps,
    },
    referencedPrincipalHeads: [...state.referencedPrincipalHeads],
  };
}

function keyringFromRequest(input: {
  readonly currentKeyEpoch: ContainerKeyEpoch;
  readonly previousKek?: ProjectionKek | undefined;
  readonly request: ContainerMutationRequest;
}): ProjectionKek["keyring"] {
  const keyring = input.request.keyring;
  if (keyring === null) {
    // An unchanged epoch keeps its stored keyring, exactly as the server
    // returns the stored artifact for non-rotating mutations.
    return input.previousKek?.keyring ?? null;
  }
  if (!input.previousKek) {
    throw new Error(
      "Rotating container mutation response fixture requires the previous KEK",
    );
  }
  if (
    Reflect.get(keyring, "containerKeyEpochId") !== input.currentKeyEpoch.id
  ) {
    throw new Error(
      "Container mutation response fixture keyring is inconsistent",
    );
  }

  return keyring as unknown as ProjectionKek["keyring"];
}
