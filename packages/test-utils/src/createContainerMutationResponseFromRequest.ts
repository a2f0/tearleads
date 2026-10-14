import {
  type AccessEvent,
  type ContainerAccessEventBody,
  type ContainerAccessManifestState,
  type ContainerDirectGrant,
  type ContainerGrantPrincipalHead,
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  computeAccessEventHash,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
} from "@tearleads/crypto";
import type {
  ContainerManifestRef,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import type {
  AccessManifestBundleWireResponse,
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";

type ProjectionKek = ContainerWriterProjectionResponse["containerKeks"][number];

// Requests cite stored manifests by hash, as the server resolves them from its
// own store. This fake resolves them from every manifest it has seen in the
// current test: the ones a caller supplies, the previous KEK's history, and
// every response it built. Manifests are content-addressed, so a hash always
// names the same bundle. The client-sdk and app test preloads reset it after
// each test, since Bun shares this module across every file in a run.
const knownManifestByHash = new Map<string, AccessManifestBundleWireResponse>();

/** Forget every registered manifest; test preloads call this after each test. */
export function resetContainerManifestRegistry(): void {
  knownManifestByHash.clear();
}

export function hasRegisteredContainerManifest(manifestHash: string): boolean {
  return knownManifestByHash.has(manifestHash);
}

/** Teach the fake manifests that tests built outside of it. */
export function registerContainerManifestBundles(
  bundles: Iterable<AccessManifestBundleWireResponse>,
): void {
  for (const bundle of bundles) {
    knownManifestByHash.set(bundle.manifestHash, bundle);
  }
}

function resolveCitedManifest(
  ref: ContainerManifestRef,
  label: string,
): AccessManifestBundleWireResponse {
  const bundle = knownManifestByHash.get(ref.manifestHash);
  if (!bundle) {
    throw new Error(
      `Container mutation response fixture cannot resolve ${label} ${ref.manifestHash}`,
    );
  }
  return bundle;
}

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
  if (!request.previousManifestRef) {
    throw new Error(
      "Container mutation response fixture requires previous state",
    );
  }
  return resolveCitedManifest(request.previousManifestRef, "previous manifest")
    .state as unknown as ContainerAccessManifestState;
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
      systemSlot: body.systemSlot,
      containerId: event.objectId,
      containerKeyEpochId: body.containerKeyEpochId,
      containerKeyPublicKey: body.containerKeyPublicKey,
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
    previousManifestHash: request.previousManifestRef?.manifestHash ?? null,
  };
  if (body.eventType === "container.grant") {
    return {
      ...base,
      containerKeyEpochId: body.containerKeyEpochId,
      containerKeyPublicKey: body.containerKeyPublicKey,
      directGrants: sortedUpsert<ContainerDirectGrant>(
        previous.directGrants,
        body.grant,
      ),
      referencedPrincipalHeads: body.referencedPrincipalHead
        ? sortedUpsert<ContainerGrantPrincipalHead>(
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
      parentManifestHash: body.parentManifestHash,
      containerKeyEpochId: body.containerKeyEpochId,
      containerKeyPublicKey: body.containerKeyPublicKey,
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
      containerKeyPublicKey: body.containerKeyPublicKey,
      parentContainerId: body.parentContainerId,
      parentManifestHash: body.parentManifestHash,
    };
  }
  if (body.eventType === "container.recite") {
    return base;
  }
  return {
    ...base,
    parentManifestHash: body.parentManifestHash,
    containerKeyEpochId: body.containerKeyEpochId,
    containerKeyPublicKey: body.containerKeyPublicKey,
    referencedPrincipalHeads: [...body.referencedPrincipalHeads],
  };
}

type PreviousProjection = Pick<
  ContainerWriterProjectionResponse,
  "containerKeks" | "path"
>;

function isPreviousProjection(
  value: ProjectionKek | PreviousProjection,
): value is PreviousProjection {
  return "containerKeks" in value && "path" in value;
}

/**
 * Build the response the server would return for `request`. `previous` is the
 * projection the mutation was planned from (or just its last KEK): its path and
 * KEK histories hold the manifests the request cites by hash.
 */
export async function createContainerMutationResponseFromRequest(
  request: ContainerMutationRequest,
  previous?: ProjectionKek | PreviousProjection | undefined,
  citedManifests: readonly AccessManifestBundleWireResponse[] = [],
): Promise<ContainerMutationResponse> {
  const previousKek =
    previous && isPreviousProjection(previous)
      ? previous.containerKeks.at(-1)
      : previous;
  registerContainerManifestBundles([
    ...citedManifests,
    ...(previous && isPreviousProjection(previous)
      ? [
          ...previous.path,
          ...previous.containerKeks.flatMap(
            (kek) => kek.containerManifestHistory,
          ),
        ]
      : []),
    ...(previousKek?.containerManifestHistory ?? []),
  ]);
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
  const containerManifestHistory = (
    request.containerManifestHistoryRefs ?? []
  ).map((ref) => resolveCitedManifest(ref, "manifest history"));
  const keyring = keyringFromRequest({
    currentKeyEpoch: keyEpoch,
    previousKek,
    request,
  });

  const response: ContainerMutationResponse = {
    // The server echoes the stored slot column exactly when it is non-null.
    ...(state.systemSlot === null ? {} : { systemSlot: state.systemSlot }),
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
  registerContainerManifestBundles([response.accessManifest]);
  return response;
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
