import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeDocumentContentKeyTargetHash,
  signWriteHeader,
  type UnsignedWriteHeader,
} from "@tearleads/crypto";
import type {
  ContainerManifestRef,
  DocumentOutgoingUpdate,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import {
  assertDocumentManifestBundleConsistent,
  normalizeDocumentKekTargetResponse,
  serializeCanonical,
  sortDocumentTargets,
  targetEnvelopeReference,
} from "../../data/documents/shared/readers";
import type {
  BuildDocumentSyncPlanInput,
  DocumentCreateAuthor,
  DocumentSyncPlan,
  DocumentSyncPreparedUpdate,
} from "../../data/documents/shared/types";
import { readCanonicalRecord } from "../../data/keyingCanonicalJson";
import { contentKeyBundleForSyncRequest } from "./syncContentKeys";

async function resolveDocumentSyncIdentity(
  input: BuildDocumentSyncPlanInput,
): Promise<{
  documentId: string;
  expectedLinkSetManifestHash: string;
  expectedTargetHash: string;
  organizationId: string;
}> {
  const manifestIdentity = await assertDocumentManifestBundleConsistent({
    bundle: input.documentManifest,
    label: "Document sync manifest",
  });
  const documentId = input.documentId ?? input.contentKeyBundle.documentId;
  if (documentId.length === 0) {
    throw new Error("Document sync document id is empty");
  }
  if (
    input.contentKeyBundle.documentId !== documentId ||
    input.documentKekTargets.documentId !== documentId ||
    manifestIdentity.documentId !== documentId
  ) {
    throw new Error("Document sync state document id mismatch");
  }
  if (manifestIdentity.organizationId !== input.author.organizationId) {
    throw new Error("Document sync author organization mismatch");
  }
  if (
    input.documentManifest.manifestHash !==
      input.contentKeyBundle.linkSetManifestHash ||
    input.documentKekTargets.linkSetManifestHash !==
      input.contentKeyBundle.linkSetManifestHash
  ) {
    throw new Error("Document sync link manifest mismatch");
  }
  if (
    input.documentKekTargets.documentKeyTargetHash !==
    input.contentKeyBundle.targetHash
  ) {
    throw new Error("Document sync target hash mismatch");
  }

  const kekTargets = normalizeDocumentKekTargetResponse(
    input.documentKekTargets,
  );
  const contentKeyTargets = sortDocumentTargets(
    input.contentKeyBundle.targets.map(targetEnvelopeReference),
  );
  if (
    serializeCanonical(kekTargets, "KEK targets") !==
    serializeCanonical(contentKeyTargets, "content-key targets")
  ) {
    throw new Error("Document sync content-key targets mismatch");
  }

  const targetHash = await computeDocumentContentKeyTargetHash(kekTargets);
  if (targetHash !== input.contentKeyBundle.targetHash) {
    throw new Error("Document sync target hash is not canonical");
  }

  return {
    documentId,
    expectedLinkSetManifestHash: input.contentKeyBundle.linkSetManifestHash,
    expectedTargetHash: input.contentKeyBundle.targetHash,
    organizationId: manifestIdentity.organizationId,
  };
}

function normalizeAuthorizingContainerPathRefs(
  refs: readonly (readonly ContainerManifestRef[])[] | undefined,
): ContainerManifestRef[][] {
  if (!refs || refs.length === 0) {
    throw new Error("Document sync write authorization path refs are missing");
  }

  return refs.map((path, pathIndex) => {
    if (path.length === 0) {
      throw new Error(
        `Document sync write authorization path[${pathIndex}] is empty`,
      );
    }
    return [...path];
  });
}

export async function signDocumentOutgoingUpdate(input: {
  author: DocumentCreateAuthor;
  contentKeyEpoch: number;
  documentId: string;
  expectedLinkSetManifestHash: string;
  expectedTargetHash: string;
  organizationId: string;
  signedAt: string;
  update: DocumentSyncPreparedUpdate;
}): Promise<DocumentOutgoingUpdate> {
  const contentRecordId = input.update.contentRecordId ?? input.update.id;
  const nonceDomain = {
    version: 1,
    organizationId: input.organizationId,
    objectKind: "document",
    objectId: input.documentId,
    contentKeyEpoch: input.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId,
  } as const;
  const unsignedHeader: UnsignedWriteHeader = {
    ...nonceDomain,
    accessManifestHash: input.expectedLinkSetManifestHash,
    targetHash: input.expectedTargetHash,
    nonceDomainHash: await computeContentRecordNonceDomainHash(nonceDomain),
    metadataHash: input.update.metadataHash,
    ciphertextHash: input.update.ciphertextHash,
    writerUserId: input.author.signerUserId,
    writerDeviceId: input.author.signerDeviceId,
    writerKeyFingerprint: input.author.signerKeyFingerprint,
    signedAt: input.update.signedAt ?? input.signedAt,
  };
  const writeHeader = await signWriteHeader(
    unsignedHeader,
    input.author.signerPrivateKey,
  );

  return {
    ...(input.update.checkpointKind === undefined
      ? {}
      : { checkpointKind: input.update.checkpointKind }),
    ...(input.update.checkpointPayloadKind === undefined
      ? {}
      : { checkpointPayloadKind: input.update.checkpointPayloadKind }),
    id: input.update.id,
    encryptedData: input.update.encryptedData,
    partialStartVersionVector: input.update.partialStartVersionVector,
    partialEndVersionVector: input.update.partialEndVersionVector,
    plaintextHash: input.update.plaintextHash,
    ...(input.update.sourceVersionVector === undefined
      ? {}
      : { sourceVersionVector: input.update.sourceVersionVector }),
    writeHeader: readCanonicalRecord(
      writeHeader,
      "Document outgoing write header",
    ),
  };
}

function assertUniqueDocumentOutgoingUpdates(
  updates: readonly DocumentSyncPreparedUpdate[],
): void {
  const updateIds = new Set<string>();
  const contentRecordIds = new Set<string>();
  for (const update of updates) {
    if (updateIds.has(update.id)) {
      throw new Error("Document sync update id is duplicated");
    }
    updateIds.add(update.id);

    const contentRecordId = (update.contentRecordId ?? update.id).toLowerCase();
    if (contentRecordIds.has(contentRecordId)) {
      throw new Error("Document sync content record id is duplicated");
    }
    contentRecordIds.add(contentRecordId);
  }
}

export async function buildDocumentSyncPlan(
  input: BuildDocumentSyncPlanInput,
): Promise<DocumentSyncPlan> {
  const {
    documentId,
    expectedLinkSetManifestHash,
    expectedTargetHash,
    organizationId,
  } = await resolveDocumentSyncIdentity(input);
  const outgoingUpdateInputs = [...(input.outgoingUpdates ?? [])];
  const signedAt = input.signedAt ?? new Date().toISOString();
  assertUniqueDocumentOutgoingUpdates(outgoingUpdateInputs);

  const outgoingUpdates = await Promise.all(
    outgoingUpdateInputs.map((update) =>
      signDocumentOutgoingUpdate({
        author: input.author,
        contentKeyEpoch: input.contentKeyBundle.contentKeyEpoch,
        documentId,
        expectedLinkSetManifestHash,
        expectedTargetHash,
        organizationId,
        signedAt,
        update,
      }),
    ),
  );
  // Writes always carry the verified current content-key bundle so the server
  // can validate and materialize the current wrapping material in the same
  // request. Read-only syncs omit it because they do not update server state.
  const shouldIncludeContentKeyBundle = outgoingUpdates.length > 0;
  const request: DocumentSyncRequest = {
    ...(shouldIncludeContentKeyBundle
      ? {
          contentKeyBundle: contentKeyBundleForSyncRequest(
            input.contentKeyBundle,
          ),
        }
      : {}),
    contentKeyEpoch: input.contentKeyBundle.contentKeyEpoch,
    ...(outgoingUpdates.length === 0
      ? {}
      : {
          authorizingContainerPathRefs: normalizeAuthorizingContainerPathRefs(
            input.authorizingContainerPathRefs,
          ),
        }),
    expectedLinkSetManifestHash,
    expectedTargetHash,
    localVersionVector: input.localVersionVector,
    ...(input.minLsn === undefined ? {} : { minLsn: input.minLsn }),
    outgoingUpdates,
  };

  return {
    contentKeyEpoch: input.contentKeyBundle.contentKeyEpoch,
    documentId,
    documentKekTargets: input.documentKekTargets,
    documentManifest: input.documentManifest,
    expectedLinkSetManifestHash,
    expectedTargetHash,
    minLsn: input.minLsn,
    organizationId,
    request,
    sourceContentKeyBundle: input.contentKeyBundle,
  };
}
