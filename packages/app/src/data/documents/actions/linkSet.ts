import {
  computeAccessManifestHash,
  computeDocumentContentKeyTargetHash,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  type DocumentContentKeyTarget,
  type DocumentLinkSetManifestState,
  deriveDocumentLinkSetManifest,
  encryptWithDek,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type { DocumentContentKeyTargetEnvelope } from "@tearleads/validators/request";
import type {
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { readCanonicalRecord } from "../../keyingCanonicalJson";
import {
  type ProjectionUserKeyResolver,
  requireProjectionUserKeyResolver,
  verifyDocumentWriterProjection,
} from "../../keyingProjectionVerification";
import type { ExecSql } from "../../persistence/sqlSchema";
import { buildDocumentLinkSetEventPlan } from "../shared/events";
import {
  collectContainerKeksForDocumentSync,
  currentDocumentTargets,
  deriveDocumentTargetFromProjection,
  mergeTargetEnvelopes,
  projectionPathRecords,
  readLinkedContainerIdsFromDocumentManifest,
  unwrapContainerKekPath,
  unwrapDocumentContentKeyFromWriterProjection,
} from "../shared/projection";
import {
  assertDocumentManifestBundleConsistent,
  describeDocumentTargetKek,
  errorMessage,
  sortDocumentTargets,
  targetKey,
  uniqueSortedStrings,
} from "../shared/readers";
import { persistedDocumentLinkSetMutationStateFromResponse } from "../shared/responses";
import {
  type BuildDocumentLinkSetMutationPlanInput,
  type DocumentCreateAuthor,
  type DocumentLinkSetMutationApi,
  type DocumentLinkSetMutationOperation,
  type DocumentLinkSetMutationPlan,
  type DocumentLinkSetTargetState,
  type MaterializedDocumentLinkSetMutationPlan,
  type ProjectionVerificationOptions,
  projectionVerificationOptions,
  type RelinkRemoteDocumentResult,
  resolveProjectionVerifier,
} from "../shared/types";

function assertSortedStringsEqual(
  left: readonly string[],
  right: readonly string[],
  message: string,
): void {
  if (
    left.length !== right.length ||
    left.some((value, index) => value !== right[index])
  ) {
    throw new Error(message);
  }
}

function assertAuthorizingContainerPathsMatchDocumentTargets(input: {
  targets: readonly DocumentContentKeyTarget[];
  writerProjection: DocumentWriterProjectionResponse;
}): void {
  if (input.writerProjection.authorizingContainerPaths.length === 0) {
    throw new Error("Document writer projection authorization paths missing");
  }

  const targetKeys = new Set(input.targets.map(targetKey));
  for (const [
    index,
    projection,
  ] of input.writerProjection.authorizingContainerPaths.entries()) {
    let projectionTarget: DocumentContentKeyTarget;
    try {
      projectionTarget = deriveDocumentTargetFromProjection(projection);
    } catch (error) {
      throw new Error(
        `Document writer projection authorization path[${index}] is invalid: ${errorMessage(error)}`,
      );
    }

    if (targetKeys.has(targetKey(projectionTarget))) {
      continue;
    }

    // Bind server-supplied KEK paths to committed document targets before
    // using any unwrapped path KEK for document content-key material.
    throw new Error(
      `Document writer projection authorization path[${index}] is not a document target`,
    );
  }
}

export async function assertDocumentWriterProjectionConsistent(
  writerProjection: DocumentWriterProjectionResponse,
  input: ProjectionVerificationOptions,
): Promise<DocumentContentKeyTarget[]> {
  const resolveProjectionUserKey = resolveProjectionVerifier(
    input,
    "Document writer projection",
  );
  if (resolveProjectionUserKey) {
    await verifyDocumentWriterProjection({
      projection: writerProjection,
      resolveUserKey: resolveProjectionUserKey,
    });
  }

  const manifestIdentity = await assertDocumentManifestBundleConsistent({
    bundle: writerProjection.documentManifest,
    label: "Document writer projection manifest",
  });
  const { documentId } = manifestIdentity;
  if (
    writerProjection.documentId !== documentId ||
    writerProjection.documentKekTargets.documentId !== documentId ||
    writerProjection.contentKeyBundle.documentId !== documentId
  ) {
    throw new Error("Document writer projection document id mismatch");
  }
  const { manifestHash } = writerProjection.documentManifest;
  if (
    writerProjection.documentKekTargets.linkSetManifestHash !== manifestHash ||
    writerProjection.contentKeyBundle.linkSetManifestHash !== manifestHash
  ) {
    throw new Error("Document writer projection link manifest mismatch");
  }
  if (
    writerProjection.documentKekTargets.documentKeyTargetHash !==
    writerProjection.contentKeyBundle.targetHash
  ) {
    throw new Error("Document writer projection target hash mismatch");
  }

  const targets = currentDocumentTargets(writerProjection);
  const canonicalTargetHash =
    await computeDocumentContentKeyTargetHash(targets);
  if (
    canonicalTargetHash !==
    writerProjection.documentKekTargets.documentKeyTargetHash
  ) {
    throw new Error("Document writer projection target hash is not canonical");
  }

  assertSortedStringsEqual(
    uniqueSortedStrings(targets.map((target) => target.containerId)),
    readLinkedContainerIdsFromDocumentManifest(writerProjection),
    "Document writer projection targets do not match linked containers",
  );
  assertSortedStringsEqual(
    uniqueSortedStrings(
      writerProjection.documentKekTargets.linkedContainerManifestHashes,
    ),
    uniqueSortedStrings(targets.map((target) => target.containerManifestHash)),
    "Document writer projection target manifest summary mismatch",
  );
  assertSortedStringsEqual(
    uniqueSortedStrings(
      writerProjection.documentKekTargets.linkedContainerKeyEpochIds,
    ),
    uniqueSortedStrings(targets.map((target) => target.containerKeyEpochId)),
    "Document writer projection target KEK summary mismatch",
  );
  assertAuthorizingContainerPathsMatchDocumentTargets({
    targets,
    writerProjection,
  });

  return targets;
}

function deriveDocumentLinkSetTargetState(input: {
  operation: DocumentLinkSetMutationOperation;
  targetContainerProjection: ContainerWriterProjectionResponse;
  writerProjection: DocumentWriterProjectionResponse;
}): DocumentLinkSetTargetState {
  const currentTargets = currentDocumentTargets(input.writerProjection);
  const currentLinkedContainerIds = readLinkedContainerIdsFromDocumentManifest(
    input.writerProjection,
  );
  const target = deriveDocumentTargetFromProjection(
    input.targetContainerProjection,
  );
  const currentTarget = currentTargets.find(
    (candidate) => candidate.containerId === target.containerId,
  );

  if (input.operation === "link") {
    if (currentTarget) {
      throw new Error("Document link target is already linked");
    }

    return {
      currentTargets,
      linkedContainerIds: uniqueSortedStrings([
        ...currentLinkedContainerIds,
        target.containerId,
      ]),
      target,
      targets: sortDocumentTargets([...currentTargets, target]),
    };
  }

  if (!currentTarget) {
    throw new Error("Document unlink target is not linked");
  }
  if (targetKey(currentTarget) !== targetKey(target)) {
    throw new Error("Document unlink target projection is stale");
  }

  const linkedContainerIds = currentLinkedContainerIds.filter(
    (containerId) => containerId !== target.containerId,
  );
  if (linkedContainerIds.length === 0) {
    throw new Error("Document unlink must leave a linked container");
  }

  return {
    currentTargets,
    linkedContainerIds,
    target,
    targets: currentTargets.filter(
      (candidate) => candidate.containerId !== target.containerId,
    ),
  };
}

async function wrapDocumentContentKeyForTargets(input: {
  contentKey: Uint8Array;
  keksByEpochId: ReadonlyMap<string, Uint8Array>;
  targets: readonly DocumentContentKeyTarget[];
}): Promise<DocumentContentKeyTargetEnvelope[]> {
  return Promise.all(
    sortDocumentTargets(input.targets).map(async (target) => {
      const targetKek = input.keksByEpochId.get(target.containerKeyEpochId);
      if (!targetKek) {
        throw new Error(
          `Document target KEK could not be unwrapped for ${describeDocumentTargetKek(target)}`,
        );
      }

      const wrapped = await encryptWithDek(input.contentKey, targetKek);
      return {
        ...target,
        wrappedKey: bytesToBase64(wrapped.ciphertext),
        wrappingMetadata: {
          suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
          iv: bytesToBase64(wrapped.iv),
        },
      };
    }),
  );
}

async function assertDocumentLinkSetMutationOrganizations(input: {
  author: DocumentCreateAuthor;
  targetContainerProjection: ContainerWriterProjectionResponse;
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<void> {
  const manifestIdentity = await assertDocumentManifestBundleConsistent({
    bundle: input.writerProjection.documentManifest,
    label: "Document link-set manifest",
  });
  if (input.author.organizationId !== manifestIdentity.organizationId) {
    throw new Error("Document link-set author organization mismatch");
  }
  if (
    input.author.organizationId !==
    input.targetContainerProjection.organizationId
  ) {
    throw new Error("Document target container organization mismatch");
  }
}

function readDocumentLinkSetPreviousEpoch(
  writerProjection: DocumentWriterProjectionResponse,
): number {
  const previousState = writerProjection.documentManifest.state;
  const previousEpoch = isPlainRecord(previousState)
    ? Reflect.get(previousState, "epoch")
    : undefined;
  if (
    typeof previousEpoch !== "number" ||
    !Number.isInteger(previousEpoch) ||
    previousEpoch <= 0
  ) {
    throw new Error("Document link-set previous epoch is invalid");
  }

  return previousEpoch;
}

async function buildDocumentLinkSetMutationPlan({
  author,
  contentKeyEpoch,
  eventId = crypto.randomUUID(),
  operation,
  signedAt = new Date().toISOString(),
  targetContainerProjection,
  targetEnvelopes,
  writerProjection,
}: BuildDocumentLinkSetMutationPlanInput): Promise<DocumentLinkSetMutationPlan> {
  await assertDocumentLinkSetMutationOrganizations({
    author,
    targetContainerProjection,
    writerProjection,
  });
  const targetState = deriveDocumentLinkSetTargetState({
    operation,
    targetContainerProjection,
    writerProjection,
  });
  const targetEnvelopesForRequest = mergeTargetEnvelopes(
    targetState.targets,
    targetEnvelopes,
  );
  const eventPlan = await buildDocumentLinkSetEventPlan({
    author,
    eventId,
    operation,
    signedAt,
    targetState,
    writerProjection,
  });
  const previousEpoch = readDocumentLinkSetPreviousEpoch(writerProjection);

  const state: DocumentLinkSetManifestState = {
    version: 1,
    documentId: writerProjection.documentId,
    organizationId: author.organizationId,
    epoch: previousEpoch + 1,
    previousManifestHash: writerProjection.documentManifest.manifestHash,
    eventHash: eventPlan.eventHash,
    linkedContainerIds: [...targetState.linkedContainerIds],
  };
  const manifest = await deriveDocumentLinkSetManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const targetHash = await computeDocumentContentKeyTargetHash(
    targetState.targets,
  );

  return {
    body: eventPlan.body,
    contentKeyEpoch,
    documentId: writerProjection.documentId,
    event: eventPlan.event,
    eventHash: eventPlan.eventHash,
    manifest,
    manifestHash,
    operation,
    request: {
      event: readCanonicalRecord(eventPlan.event, "Document link-set event"),
      body: readCanonicalRecord(eventPlan.body, "Document link-set body"),
      expectedManifestHash: manifestHash,
      manifest: readCanonicalRecord(manifest, "Document link-set manifest"),
      previousManifest: writerProjection.documentManifest,
      targetContainerPath: projectionPathRecords(targetContainerProjection),
      authorizingContainerPaths: eventPlan.authorizingContainerPaths,
      contentKeyBundle: {
        contentKeyEpoch,
        linkSetManifestHash: manifestHash,
        targetHash,
        targets: targetEnvelopesForRequest,
      },
    },
    state,
    targetHash,
    targets: sortDocumentTargets(targetState.targets),
  };
}

export async function buildMaterializedDocumentLinkSetMutationPlan(
  input: {
    author: DocumentCreateAuthor;
    contentKey?: Uint8Array | undefined;
    eventId?: string | undefined;
    execSql?: ExecSql | undefined;
    operation: DocumentLinkSetMutationOperation;
    signedAt?: string | undefined;
    targetContainerProjection: ContainerWriterProjectionResponse;
    targetSecretKey: Uint8Array;
    writerProjection: DocumentWriterProjectionResponse;
  } & ProjectionVerificationOptions,
): Promise<MaterializedDocumentLinkSetMutationPlan> {
  await assertDocumentWriterProjectionConsistent(input.writerProjection, {
    ...projectionVerificationOptions(input),
  });
  const targetState = deriveDocumentLinkSetTargetState({
    operation: input.operation,
    targetContainerProjection: input.targetContainerProjection,
    writerProjection: input.writerProjection,
  });
  const currentContentKey = await unwrapDocumentContentKeyFromWriterProjection({
    execSql: input.execSql,
    secretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
  });
  const contentKeyRotated = input.operation === "unlink";
  const contentKey = contentKeyRotated
    ? (input.contentKey ?? crypto.getRandomValues(new Uint8Array(32)))
    : currentContentKey;
  if (contentKey.byteLength !== 32) {
    throw new Error("Document content key must be 32 bytes");
  }

  const targetEnvelopes =
    input.operation === "link"
      ? [
          ...input.writerProjection.contentKeyBundle.targets,
          ...(await wrapDocumentContentKeyForTargets({
            contentKey,
            keksByEpochId: await unwrapContainerKekPath({
              execSql: input.execSql,
              projection: input.targetContainerProjection,
              secretKey: input.targetSecretKey,
              ...projectionVerificationOptions(input),
            }),
            targets: [targetState.target],
          })),
        ]
      : await wrapDocumentContentKeyForTargets({
          contentKey,
          keksByEpochId: await collectContainerKeksForDocumentSync({
            execSql: input.execSql,
            secretKey: input.targetSecretKey,
            writerProjection: input.writerProjection,
          }),
          targets: targetState.targets,
        });

  const plan = await buildDocumentLinkSetMutationPlan({
    author: input.author,
    contentKeyEpoch:
      input.writerProjection.contentKeyBundle.contentKeyEpoch +
      (contentKeyRotated ? 1 : 0),
    eventId: input.eventId,
    operation: input.operation,
    signedAt: input.signedAt,
    targetContainerProjection: input.targetContainerProjection,
    targetEnvelopes,
    writerProjection: input.writerProjection,
  });

  return {
    contentKey,
    contentKeyRotated,
    plan,
  };
}

export async function relinkRemoteDocument(input: {
  apiClient: DocumentLinkSetMutationApi;
  author: DocumentCreateAuthor;
  contentKey?: Uint8Array | undefined;
  documentId: string;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  operation: DocumentLinkSetMutationOperation;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  targetContainerId: string;
  targetSecretKey: Uint8Array;
}): Promise<RelinkRemoteDocumentResult | null> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote document link-set mutation",
  );
  const [writerProjection, targetContainerProjection] = await Promise.all([
    input.apiClient.getDocumentWriterProjection(input.documentId),
    input.apiClient.getContainerWriterProjection(input.targetContainerId),
  ]);
  if (!writerProjection || !targetContainerProjection) {
    return null;
  }

  const materializedPlan = await buildMaterializedDocumentLinkSetMutationPlan({
    author: input.author,
    contentKey: input.contentKey,
    eventId: input.eventId,
    execSql: input.execSql,
    operation: input.operation,
    resolveProjectionUserKey,
    signedAt: input.signedAt,
    targetContainerProjection,
    targetSecretKey: input.targetSecretKey,
    writerProjection,
  });
  const response =
    input.operation === "link"
      ? await input.apiClient.linkDocument(
          materializedPlan.plan.documentId,
          materializedPlan.plan.request,
        )
      : await input.apiClient.unlinkDocument(
          materializedPlan.plan.documentId,
          materializedPlan.plan.request,
        );
  if (!response) {
    return null;
  }
  const persistedState = persistedDocumentLinkSetMutationStateFromResponse(
    materializedPlan.plan,
    response,
  );

  return {
    contentKey: materializedPlan.contentKey,
    contentKeyRotated: materializedPlan.contentKeyRotated,
    documentId: response.id,
    linkedContainerIds: [...materializedPlan.plan.state.linkedContainerIds],
    persistedState,
    plan: materializedPlan.plan,
    response,
  };
}
