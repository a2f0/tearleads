import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeDocumentContentRecordCiphertextHash,
  computeDocumentContentRecordMetadataHash,
  computeWriteHeaderHash,
  verifyWriteHeader,
  type WriteHeader,
} from "@tearleads/crypto";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type {
  DocumentCreateResponse,
  DocumentLinkSetMutationResponse,
  DocumentSyncResponse,
} from "@tearleads/validators/response";
import { parseWalLsn } from "@tearleads/validators/util";
import {
  readRecordNumber,
  readRecordString,
  readWriteHeader,
  serializeCanonical,
  serializeState,
} from "./readers";
import type {
  DocumentCreatePlan,
  DocumentLinkSetMutationPlan,
  DocumentSyncApi,
  DocumentSyncPlan,
  DocumentSyncSubmitFailure,
  DocumentWriterPublicKeyResolver,
  PersistedDocumentCreateState,
  PersistedDocumentSyncState,
} from "./types";

// 1. assertCreateResponseMatchesPlan (internal) + persistedDocumentCreateStateFromResponse (EXPORT)
function assertCreateResponseMatchesPlan(
  plan: DocumentCreatePlan,
  response: DocumentCreateResponse,
): void {
  if (response.id !== plan.documentId) {
    throw new Error("Document create response id mismatch");
  }
  if (response.accessManifest.manifestHash !== plan.manifestHash) {
    throw new Error("Document create response manifest hash mismatch");
  }
  if (
    serializeCanonical(response.accessManifest.manifest, "manifest") !==
    serializeCanonical(plan.manifest, "manifest")
  ) {
    throw new Error("Document create response manifest mismatch");
  }

  const responseEvent = response.accessManifest.event;
  if (!isPlainRecord(responseEvent)) {
    throw new Error("Document create response event bundle is invalid");
  }
  if (
    readRecordString(responseEvent, "eventHash", "event bundle") !==
    plan.eventHash
  ) {
    throw new Error("Document create response event hash mismatch");
  }
  if (
    serializeCanonical(Reflect.get(responseEvent, "event"), "event") !==
    serializeCanonical(plan.event, "event")
  ) {
    throw new Error("Document create response event mismatch");
  }

  const responseState = response.accessManifest.state;
  if (!isPlainRecord(responseState)) {
    throw new Error("Document create response state is invalid");
  }
  if (
    readRecordString(responseState, "documentId", "document state") !==
    plan.documentId
  ) {
    throw new Error("Document create response document id mismatch");
  }
  if (
    serializeCanonical(responseState, "state") !==
    serializeCanonical(plan.state, "state")
  ) {
    throw new Error("Document create response state mismatch");
  }

  if (response.contentKeyBundle.documentId !== plan.documentId) {
    throw new Error("Document create response content-key document mismatch");
  }
  if (
    response.contentKeyBundle.contentKeyEpoch !==
    plan.request.contentKeyBundle.contentKeyEpoch
  ) {
    throw new Error("Document create response content-key epoch mismatch");
  }
  if (response.contentKeyBundle.linkSetManifestHash !== plan.manifestHash) {
    throw new Error("Document create response link manifest mismatch");
  }
  if (response.contentKeyBundle.targetHash !== plan.targetHash) {
    throw new Error("Document create response target hash mismatch");
  }
  if (
    serializeCanonical(
      response.contentKeyBundle.targets,
      "content-key targets",
    ) !==
    serializeCanonical(
      plan.request.contentKeyBundle.targets,
      "content-key targets",
    )
  ) {
    throw new Error("Document create response content-key targets mismatch");
  }
  if (response.documentKekTargets.documentId !== plan.documentId) {
    throw new Error("Document create response target document mismatch");
  }
  if (response.documentKekTargets.linkSetManifestHash !== plan.manifestHash) {
    throw new Error("Document create response target manifest mismatch");
  }
  if (response.documentKekTargets.documentKeyTargetHash !== plan.targetHash) {
    throw new Error("Document create response document target hash mismatch");
  }
  if (
    serializeCanonical(response.documentKekTargets.targets, "KEK targets") !==
    serializeCanonical(plan.targets, "KEK targets")
  ) {
    throw new Error("Document create response KEK targets mismatch");
  }
}

export function persistedDocumentCreateStateFromResponse(
  plan: DocumentCreatePlan,
  response: DocumentCreateResponse,
): PersistedDocumentCreateState {
  assertCreateResponseMatchesPlan(plan, response);

  return {
    documentId: response.id,
    contentKeyBundle: serializeState(response.contentKeyBundle),
    documentKekTargets: serializeState(response.documentKekTargets),
    documentManifestBundle: serializeState(response.accessManifest),
  };
}

// 2. assertLinkSetMutationResponseMatchesPlan (internal) + persistedDocumentLinkSetMutationStateFromResponse (EXPORT)
function assertLinkSetMutationResponseMatchesPlan(
  plan: DocumentLinkSetMutationPlan,
  response: DocumentLinkSetMutationResponse,
): void {
  if (response.id !== plan.documentId) {
    throw new Error("Document link-set response id mismatch");
  }
  if (response.accessManifest.manifestHash !== plan.manifestHash) {
    throw new Error("Document link-set response manifest hash mismatch");
  }
  if (
    serializeCanonical(response.accessManifest.manifest, "manifest") !==
    serializeCanonical(plan.manifest, "manifest")
  ) {
    throw new Error("Document link-set response manifest mismatch");
  }

  const responseEvent = response.accessManifest.event;
  if (!isPlainRecord(responseEvent)) {
    throw new Error("Document link-set response event bundle is invalid");
  }
  if (
    readRecordString(responseEvent, "eventHash", "event bundle") !==
    plan.eventHash
  ) {
    throw new Error("Document link-set response event hash mismatch");
  }
  if (
    serializeCanonical(Reflect.get(responseEvent, "event"), "event") !==
    serializeCanonical(plan.event, "event")
  ) {
    throw new Error("Document link-set response event mismatch");
  }
  if (
    serializeCanonical(response.accessManifest.state, "state") !==
    serializeCanonical(plan.state, "state")
  ) {
    throw new Error("Document link-set response state mismatch");
  }
  if (
    response.contentKeyBundle.documentId !== plan.documentId ||
    response.contentKeyBundle.contentKeyEpoch !== plan.contentKeyEpoch ||
    response.contentKeyBundle.linkSetManifestHash !== plan.manifestHash ||
    response.contentKeyBundle.targetHash !== plan.targetHash
  ) {
    throw new Error("Document link-set response content-key mismatch");
  }
  if (
    serializeCanonical(
      response.contentKeyBundle.targets,
      "content-key targets",
    ) !==
    serializeCanonical(
      plan.request.contentKeyBundle.targets,
      "content-key targets",
    )
  ) {
    throw new Error("Document link-set response content-key targets mismatch");
  }
  if (
    response.documentKekTargets.documentId !== plan.documentId ||
    response.documentKekTargets.linkSetManifestHash !== plan.manifestHash ||
    response.documentKekTargets.documentKeyTargetHash !== plan.targetHash
  ) {
    throw new Error("Document link-set response KEK target mismatch");
  }
  if (
    serializeCanonical(response.documentKekTargets.targets, "KEK targets") !==
    serializeCanonical(plan.targets, "KEK targets")
  ) {
    throw new Error("Document link-set response KEK targets mismatch");
  }
}

export function persistedDocumentLinkSetMutationStateFromResponse(
  plan: DocumentLinkSetMutationPlan,
  response: DocumentLinkSetMutationResponse,
): PersistedDocumentCreateState {
  assertLinkSetMutationResponseMatchesPlan(plan, response);

  return {
    documentId: response.id,
    contentKeyBundle: serializeState(response.contentKeyBundle),
    documentKekTargets: serializeState(response.documentKekTargets),
    documentManifestBundle: serializeState(response.accessManifest),
  };
}

// 3. assertAcceptedOutgoingUpdateIdsMatchPlan (internal)
function assertAcceptedOutgoingUpdateIdsMatchPlan(
  plan: DocumentSyncPlan,
  response: DocumentSyncResponse,
): void {
  const expected = plan.request.outgoingUpdates.map((update) => update.id);
  const accepted = response.acceptedOutgoingUpdateIds;
  const expectedSorted = [...expected].sort();
  const acceptedSorted = [...accepted].sort();
  if (
    expectedSorted.length !== acceptedSorted.length ||
    expectedSorted.some((id, index) => id !== acceptedSorted[index])
  ) {
    throw new Error("Document sync response accepted update mismatch");
  }
}

// 4. assertDocumentSyncResponseUpdateMatchesPlan (internal)
async function assertDocumentSyncResponseUpdateMatchesPlan(input: {
  plan: DocumentSyncPlan;
  update: DocumentSyncResponse["updates"][number];
  resolveWriterPublicKey?: DocumentWriterPublicKeyResolver | undefined;
  writerPublicKeysByFingerprint?: ReadonlyMap<string, Uint8Array> | undefined;
}): Promise<void> {
  const { plan, update } = input;
  if (update.documentId !== plan.documentId) {
    throw new Error("Document sync response update document mismatch");
  }
  const header = readWriteHeader(
    update.writeHeader,
    "Document sync response write header",
  );
  await assertDocumentSyncResponseUpdateHashes({ header, update });
  assertDocumentSyncResponseWriteHeaderFields({ header, plan, update });
  await assertDocumentSyncResponseNonceDomain({ plan, update });
  await assertDocumentSyncResponseWriteHeaderSignature({
    header,
    plan,
    resolveWriterPublicKey: input.resolveWriterPublicKey,
    update,
    writerPublicKeysByFingerprint: input.writerPublicKeysByFingerprint,
  });
}

// 5. assertDocumentSyncResponseUpdateHashes (internal)
async function assertDocumentSyncResponseUpdateHashes(input: {
  header: WriteHeader;
  update: DocumentSyncResponse["updates"][number];
}): Promise<void> {
  const { header, update } = input;
  const headerHash = await computeWriteHeaderHash(header);
  if (headerHash !== update.writeHeaderHash) {
    throw new Error("Document sync response write header hash mismatch");
  }
  const ciphertextHash = await computeDocumentContentRecordCiphertextHash(
    update.encryptedData,
  );
  if (
    ciphertextHash !==
    readRecordString(update.writeHeader, "ciphertextHash", "write header")
  ) {
    throw new Error("Document sync response ciphertext hash mismatch");
  }
  const metadataHash = await computeDocumentContentRecordMetadataHash({
    documentId: update.documentId,
    partialEndVersionVector: update.partialEndVersionVector,
    partialStartVersionVector: update.partialStartVersionVector,
    updateId: update.id,
  });
  if (
    metadataHash !==
    readRecordString(update.writeHeader, "metadataHash", "write header")
  ) {
    throw new Error("Document sync response metadata hash mismatch");
  }
}

// 6. assertDocumentSyncResponseWriteHeaderFields (internal)
function assertDocumentSyncResponseWriteHeaderFields(input: {
  header: WriteHeader;
  plan: DocumentSyncPlan;
  update: DocumentSyncResponse["updates"][number];
}): void {
  const { header, plan, update } = input;
  const mustMatchCurrentBoundary = isAcceptedOutgoingSyncUpdate(plan, update);

  if (
    header.version !== 1 ||
    header.objectKind !== "document" ||
    header.objectId !== plan.documentId ||
    header.organizationId !== plan.organizationId ||
    header.contentKeyEpoch !== plan.contentKeyEpoch ||
    header.encryptionSuite !== CONTENT_RECORD_ENCRYPTION_SUITE ||
    header.writerKeyFingerprint !== update.authorFingerprint ||
    (mustMatchCurrentBoundary &&
      (header.accessManifestHash !== plan.expectedLinkSetManifestHash ||
        header.targetHash !== plan.expectedTargetHash))
  ) {
    throw new Error("Document sync response write header mismatch");
  }
}

// 7. isAcceptedOutgoingSyncUpdate (EXPORT - needed by sync action)
function isAcceptedOutgoingSyncUpdate(
  plan: DocumentSyncPlan,
  update: DocumentSyncResponse["updates"][number],
): boolean {
  return plan.request.outgoingUpdates.some(
    (outgoingUpdate) => outgoingUpdate.id === update.id,
  );
}

// 8. responseWriteHeaderSignatureBoundary (internal)
function responseWriteHeaderSignatureBoundary(input: {
  plan: DocumentSyncPlan;
  update: DocumentSyncResponse["updates"][number];
}):
  | {
      expectedAccessManifestHash: string;
      expectedTargetHash: string;
    }
  | Record<string, never> {
  if (!isAcceptedOutgoingSyncUpdate(input.plan, input.update)) {
    return {};
  }

  return {
    expectedAccessManifestHash: input.plan.expectedLinkSetManifestHash,
    expectedTargetHash: input.plan.expectedTargetHash,
  };
}

// 9. assertDocumentSyncResponseNonceDomain (internal)
async function assertDocumentSyncResponseNonceDomain(input: {
  plan: DocumentSyncPlan;
  update: DocumentSyncResponse["updates"][number];
}): Promise<void> {
  const { plan, update } = input;
  const nonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 1,
    organizationId: plan.organizationId,
    objectKind: "document",
    objectId: plan.documentId,
    contentKeyEpoch: plan.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: readRecordString(
      update.writeHeader,
      "contentRecordId",
      "write header",
    ),
  });
  if (
    nonceDomainHash !==
    readRecordString(update.writeHeader, "nonceDomainHash", "write header")
  ) {
    throw new Error("Document sync response nonce domain mismatch");
  }
}

// 10. assertDocumentSyncResponseWriteHeaderSignature (internal)
async function assertDocumentSyncResponseWriteHeaderSignature(input: {
  header: WriteHeader;
  plan: DocumentSyncPlan;
  resolveWriterPublicKey?: DocumentWriterPublicKeyResolver | undefined;
  update: DocumentSyncResponse["updates"][number];
  writerPublicKeysByFingerprint?: ReadonlyMap<string, Uint8Array> | undefined;
}): Promise<void> {
  const { header, plan, update } = input;
  if (!input.writerPublicKeysByFingerprint && !input.resolveWriterPublicKey) {
    throw new Error(
      "Document sync response writer public key verification is required",
    );
  }

  const writerPublicKey =
    input.writerPublicKeysByFingerprint?.get(update.authorFingerprint) ??
    (input.resolveWriterPublicKey
      ? await input.resolveWriterPublicKey({
          authorFingerprint: update.authorFingerprint,
          header,
          update,
        })
      : null);
  if (!writerPublicKey) {
    throw new Error("Document sync response writer public key missing");
  }

  const verified = await verifyWriteHeader({
    ...responseWriteHeaderSignatureBoundary({ plan, update }),
    expectedObject: {
      objectKind: "document",
      objectId: plan.documentId,
      organizationId: plan.organizationId,
    },
    header,
    writerPublicKey,
  });
  if (!verified.ok || verified.value.headerHash !== update.writeHeaderHash) {
    throw new Error("Document sync response write header signature mismatch");
  }
}

// 11. assertDocumentSyncCommitCheckpointMatchesPlan (internal)
function assertDocumentSyncCommitCheckpointMatchesPlan(
  plan: DocumentSyncPlan,
  response: DocumentSyncResponse,
): void {
  if (response.commitLsn !== null) {
    parseWalLsn(response.commitLsn, "Document sync response commit LSN");
  }
  if (plan.minLsn === undefined) {
    return;
  }
  const minLsn = parseWalLsn(
    plan.minLsn,
    "Document sync requested minimum LSN",
  );
  if (response.commitLsn === null) {
    throw new Error("Document sync response commit LSN is missing");
  }
  if (
    parseWalLsn(response.commitLsn, "Document sync response commit LSN") <
    minLsn
  ) {
    throw new Error("Document sync response commit LSN is stale");
  }
}

// 12. documentSyncManifestEpoch (internal)
function documentSyncManifestEpoch(plan: DocumentSyncPlan): number {
  if (!isPlainRecord(plan.documentManifest.state)) {
    throw new Error("Document sync manifest state is invalid");
  }

  return readRecordNumber(
    plan.documentManifest.state,
    "epoch",
    "Document sync manifest state",
  );
}

// 13. expectedDocumentMissingUpdateEpochs (internal)
function expectedDocumentMissingUpdateEpochs(
  plan: DocumentSyncPlan,
  response: DocumentSyncResponse,
): DocumentSyncResponse["missingUpdateEpochs"] {
  const currentAccessEpoch = documentSyncManifestEpoch(plan);
  let hasPriorEpochUpdate = false;
  let hasCurrentEpochUpdate = false;

  for (const update of response.updates) {
    if (update.accessEpoch > currentAccessEpoch) {
      throw new Error("Document sync response includes a future access epoch");
    }
    if (update.accessEpoch < currentAccessEpoch) {
      hasPriorEpochUpdate = true;
    } else {
      hasCurrentEpochUpdate = true;
    }
  }

  const missingUpdateEpochs: DocumentSyncResponse["missingUpdateEpochs"] = [];
  if (hasPriorEpochUpdate) {
    missingUpdateEpochs.push("prior_epoch");
  }
  if (hasCurrentEpochUpdate) {
    missingUpdateEpochs.push("current_epoch");
  }

  return missingUpdateEpochs;
}

// 14. assertDocumentMissingUpdateEpochsMatchPlan (internal)
function assertDocumentMissingUpdateEpochsMatchPlan(
  plan: DocumentSyncPlan,
  response: DocumentSyncResponse,
): void {
  const expected = expectedDocumentMissingUpdateEpochs(plan, response);
  if (
    response.missingUpdateEpochs.length !== expected.length ||
    response.missingUpdateEpochs.some(
      (epoch, index) => epoch !== expected[index],
    )
  ) {
    throw new Error("Document sync response missing update epochs mismatch");
  }
}

// 15. persistedDocumentSyncStateFromResponse (EXPORT)
export async function persistedDocumentSyncStateFromResponse(
  plan: DocumentSyncPlan,
  response: DocumentSyncResponse,
  options: {
    resolveWriterPublicKey?: DocumentWriterPublicKeyResolver | undefined;
    writerPublicKeysByFingerprint?: ReadonlyMap<string, Uint8Array> | undefined;
  } = {},
): Promise<PersistedDocumentSyncState> {
  if (response.documentId !== plan.documentId) {
    throw new Error("Document sync response document id mismatch");
  }
  if (
    serializeCanonical(response.contentKeyBundle, "content-key bundle") !==
    serializeCanonical(plan.sourceContentKeyBundle, "content-key bundle")
  ) {
    throw new Error("Document sync response content-key bundle mismatch");
  }
  if (
    serializeCanonical(response.documentKekTargets, "KEK targets") !==
    serializeCanonical(plan.documentKekTargets, "KEK targets")
  ) {
    throw new Error("Document sync response KEK target mismatch");
  }
  assertAcceptedOutgoingUpdateIdsMatchPlan(plan, response);
  assertDocumentSyncCommitCheckpointMatchesPlan(plan, response);
  assertDocumentMissingUpdateEpochsMatchPlan(plan, response);

  await Promise.all(
    response.updates.map((update) =>
      assertDocumentSyncResponseUpdateMatchesPlan({
        plan,
        resolveWriterPublicKey: options.resolveWriterPublicKey,
        update,
        writerPublicKeysByFingerprint: options.writerPublicKeysByFingerprint,
      }),
    ),
  );

  return {
    documentId: plan.documentId,
    contentKeyBundle: serializeState(response.contentKeyBundle),
    documentKekTargets: serializeState(response.documentKekTargets),
    documentManifestBundle: serializeState(plan.documentManifest),
  };
}

// 16. RETRYABLE_DOCUMENT_SYNC_CONFLICT_MESSAGES + isRetryableDocumentSyncConflict (EXPORT)
const RETRYABLE_DOCUMENT_SYNC_CONFLICT_MESSAGES = [
  "Document KEK targets are stale",
  "Document content-key bundle is stale",
  "Document write authorization manifest does not match sync request",
];

function isRetryableDocumentSyncConflict(
  failure: DocumentSyncSubmitFailure,
): boolean {
  if (failure.status !== 409) {
    return false;
  }

  return (
    RETRYABLE_DOCUMENT_SYNC_CONFLICT_MESSAGES.some((message) =>
      failure.message.includes(message),
    ) ||
    (failure.message.includes("authorizingContainerPaths") &&
      failure.message.includes("is stale")) ||
    (failure.message.includes("targetContainerPath") &&
      failure.message.includes("is stale"))
  );
}

// 17. submitDocumentSync (EXPORT)
async function submitDocumentSync(input: {
  apiClient: DocumentSyncApi;
  plan: DocumentSyncPlan;
}) {
  if (input.apiClient.syncDocumentResult) {
    const result = await input.apiClient.syncDocumentResult(
      input.plan.documentId,
      input.plan.request,
      { reportErrors: false },
    );

    if (result.ok) {
      return {
        ok: true,
        response: result.data,
      };
    }

    return result;
  }

  const response = await input.apiClient.syncDocument(
    input.plan.documentId,
    input.plan.request,
  );
  return response ? { ok: true, response } : null;
}

export { isRetryableDocumentSyncConflict, submitDocumentSync };
