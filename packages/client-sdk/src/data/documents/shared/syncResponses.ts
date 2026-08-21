import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeDocumentContentRecordCiphertextHash,
  computeDocumentContentRecordMetadataHash,
  KeyingVerificationError,
  verifyWriteHeader,
  type WriteHeader,
} from "@symcrypt/crypto";
import { isPlainObject as isPlainRecord } from "@symcrypt/validators/isPlainObject";
import {
  DOCUMENT_NOT_FOUND_ERROR_CODE,
  DOCUMENT_SYNC_ERROR_CODES,
  type DocumentSyncResponse,
} from "@symcrypt/validators/response";
import { parseWalLsn } from "@symcrypt/validators/util";
import { rethrowDatabaseUnavailableError } from "../../keyingProjectionVerification/error";
import {
  readRecordPositiveInteger,
  readRecordString,
  readWriteHeader,
  serializeCanonical,
  serializedPersistedDocumentState,
} from "./readers";
import { documentWriteAuthorizationForHeader } from "./syncResponseAuthorization";
import type {
  DocumentSyncApi,
  DocumentSyncPlan,
  DocumentSyncSubmitFailure,
  DocumentWriterPublicKeyResolver,
  PersistedDocumentSyncState,
} from "./types";

// Remote-primary databases without a portable WAL position use the zero LSN
// as an explicit "checkpoint not tracked" sentinel. It is accepted only when
// the response declares that mode, letting a local record carrying a checkpoint
// from another backend move to that primary without weakening tracked checks.
// This protects against replica lag, not a server that falsely declares its own
// consistency capability; the authenticated server remains the source of data.
const UNTRACKED_COMMIT_LSN = "0/0";

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

async function assertDocumentSyncResponseUpdateMatchesPlan(input: {
  contentKeyBundlesByEpoch: ReadonlyMap<
    number,
    DocumentSyncResponse["contentKeyBundle"]
  >;
  plan: DocumentSyncPlan;
  update: DocumentSyncResponse["updates"][number];
  resolveWriterPublicKey: DocumentWriterPublicKeyResolver;
}): Promise<void> {
  const { plan, update } = input;
  if (update.documentId !== plan.documentId) {
    throw new Error("Document sync response update document mismatch");
  }
  const header = readWriteHeader(
    update.writeHeader,
    "Document sync response write header",
  );
  await assertDocumentSyncResponseUpdateHashes({ update });
  const contentKeyBundle = assertDocumentSyncResponseUpdateContentKeyBundle({
    contentKeyBundlesByEpoch: input.contentKeyBundlesByEpoch,
    header,
    plan,
  });
  assertDocumentSyncResponseWriteHeaderFields({ header, plan, update });
  await assertDocumentSyncResponseNonceDomain({ header, plan });
  await assertDocumentSyncResponseWriteHeaderSignature({
    header,
    contentKeyBundle,
    plan,
    resolveWriterPublicKey: input.resolveWriterPublicKey,
    update,
  });
}

function assertDocumentSyncResponseUpdateContentKeyBundle(input: {
  contentKeyBundlesByEpoch: ReadonlyMap<
    number,
    DocumentSyncResponse["contentKeyBundle"]
  >;
  header: WriteHeader;
  plan: DocumentSyncPlan;
}): DocumentSyncResponse["contentKeyBundle"] {
  const { header, plan } = input;
  if (header.contentKeyEpoch > plan.contentKeyEpoch) {
    throw new Error(
      "Document sync response includes a future content-key epoch",
    );
  }

  const bundle = input.contentKeyBundlesByEpoch.get(header.contentKeyEpoch);
  if (!bundle) {
    throw new Error("Document sync response content-key bundle missing");
  }
  if (
    bundle.documentId !== plan.documentId ||
    bundle.contentKeyEpoch !== header.contentKeyEpoch
  ) {
    throw new Error("Document sync response content-key bundle mismatch");
  }
  return bundle;
}

async function assertDocumentSyncResponseUpdateHashes(input: {
  update: DocumentSyncResponse["updates"][number];
}): Promise<void> {
  const { update } = input;
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
    ...(update.checkpointKind === undefined
      ? {}
      : { checkpointKind: update.checkpointKind }),
    ...(update.checkpointPayloadKind === undefined
      ? {}
      : { checkpointPayloadKind: update.checkpointPayloadKind }),
    documentId: update.documentId,
    partialEndVersionVector: update.partialEndVersionVector,
    partialStartVersionVector: update.partialStartVersionVector,
    plaintextHash: update.plaintextHash,
    ...(update.sourceVersionVector === undefined
      ? {}
      : { sourceVersionVector: update.sourceVersionVector }),
    updateId: update.id,
  });
  if (
    metadataHash !==
    readRecordString(update.writeHeader, "metadataHash", "write header")
  ) {
    throw new Error("Document sync response metadata hash mismatch");
  }
}

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
    header.encryptionSuite !== CONTENT_RECORD_ENCRYPTION_SUITE ||
    header.writerKeyFingerprint !== update.authorFingerprint ||
    (mustMatchCurrentBoundary &&
      (header.contentKeyEpoch !== plan.contentKeyEpoch ||
        header.accessManifestHash !== plan.expectedLinkSetManifestHash ||
        header.targetHash !== plan.expectedTargetHash))
  ) {
    throw new Error("Document sync response write header mismatch");
  }
}

function isAcceptedOutgoingSyncUpdate(
  plan: DocumentSyncPlan,
  update: DocumentSyncResponse["updates"][number],
): boolean {
  return plan.request.outgoingUpdates.some(
    (outgoingUpdate) => outgoingUpdate.id === update.id,
  );
}

async function assertDocumentSyncResponseNonceDomain(input: {
  header: WriteHeader;
  plan: DocumentSyncPlan;
}): Promise<void> {
  const { header, plan } = input;
  const nonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 1,
    organizationId: plan.organizationId,
    objectKind: "document",
    objectId: plan.documentId,
    contentKeyEpoch: header.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: header.contentRecordId,
  });
  if (nonceDomainHash !== header.nonceDomainHash) {
    throw new Error("Document sync response nonce domain mismatch");
  }
}

async function assertDocumentSyncResponseWriteHeaderSignature(input: {
  contentKeyBundle: DocumentSyncResponse["contentKeyBundle"];
  header: WriteHeader;
  plan: DocumentSyncPlan;
  resolveWriterPublicKey: DocumentWriterPublicKeyResolver;
  update: DocumentSyncResponse["updates"][number];
}): Promise<void> {
  const { header, plan, update } = input;
  const writerPublicKey = await input.resolveWriterPublicKey({
    writerSigningKeyFingerprint: header.writerKeyFingerprint,
    writerUserId: header.writerUserId,
  });
  if (!writerPublicKey) {
    throw new Error("Document sync response writer public key missing");
  }

  const documentAuthorization = await documentWriteAuthorizationForHeader({
    allowMissingAuthorization: isAcceptedOutgoingSyncUpdate(plan, update),
    authorizationTargets: update.authorizationTargets,
    contentKeyBundle: input.contentKeyBundle,
    manifestHash: header.accessManifestHash,
    plan,
    targetHash: header.targetHash,
  });
  const verified = await verifyWriteHeader({
    expectedAccessManifestHash: documentAuthorization
      ? header.accessManifestHash
      : plan.expectedLinkSetManifestHash,
    expectedObject: {
      objectKind: "document",
      objectId: plan.documentId,
      organizationId: plan.organizationId,
    },
    header,
    ...(documentAuthorization ? { documentAuthorization } : {}),
    expectedTargetHash: documentAuthorization
      ? header.targetHash
      : plan.expectedTargetHash,
    writerPublicKey,
  });
  if (!verified.ok) {
    throw verified.error;
  }
}

function assertDocumentSyncCommitCheckpointMatchesPlan(
  plan: DocumentSyncPlan,
  response: DocumentSyncResponse,
): void {
  if (
    response.commitLsnMode === "untracked" &&
    response.commitLsn !== UNTRACKED_COMMIT_LSN
  ) {
    throw new Error(
      "Document sync response untracked commit LSN must use the 0/0 sentinel",
    );
  }
  if (
    response.commitLsn === UNTRACKED_COMMIT_LSN &&
    response.commitLsnMode !== "untracked"
  ) {
    throw new Error(
      "Document sync response 0/0 commit LSN must be declared untracked",
    );
  }
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
    !(
      response.commitLsn === UNTRACKED_COMMIT_LSN &&
      response.commitLsnMode === "untracked"
    ) &&
    parseWalLsn(response.commitLsn, "Document sync response commit LSN") <
      minLsn
  ) {
    throw new Error("Document sync response commit LSN is stale");
  }
}

function documentSyncManifestEpoch(plan: DocumentSyncPlan): number {
  if (!isPlainRecord(plan.documentManifest.state)) {
    throw new Error("Document sync manifest state is invalid");
  }

  return readRecordPositiveInteger(
    plan.documentManifest.state,
    "epoch",
    "Document sync manifest state",
  );
}

// The one load-bearing epoch check: no returned update may claim an
// accessEpoch newer than the current manifest epoch.
function assertDocumentSyncAccessEpochsNotInFuture(
  plan: DocumentSyncPlan,
  response: DocumentSyncResponse,
): void {
  const currentAccessEpoch = documentSyncManifestEpoch(plan);
  for (const update of response.updates) {
    if (update.accessEpoch > currentAccessEpoch) {
      throw new Error("Document sync response includes a future access epoch");
    }
  }
}

function contentKeyBundleCanonical(
  bundle: DocumentSyncResponse["contentKeyBundle"],
): string {
  return serializeCanonical(bundle, "content-key bundle");
}

function documentSyncContentKeyBundlesByEpoch(
  plan: DocumentSyncPlan,
  response: DocumentSyncResponse,
): ReadonlyMap<number, DocumentSyncResponse["contentKeyBundle"]> {
  if (
    contentKeyBundleCanonical(response.contentKeyBundle) !==
    contentKeyBundleCanonical(plan.sourceContentKeyBundle)
  ) {
    throw new Error("Document sync response content-key bundle mismatch");
  }

  const bundleByEpoch = new Map<
    number,
    DocumentSyncResponse["contentKeyBundle"]
  >();
  const bundles = [response.contentKeyBundle, ...response.contentKeyBundles];

  for (const bundle of bundles) {
    if (bundle.documentId !== plan.documentId) {
      throw new Error(
        "Document sync response content-key bundle document mismatch",
      );
    }
    if (
      !Number.isInteger(bundle.contentKeyEpoch) ||
      bundle.contentKeyEpoch <= 0
    ) {
      throw new Error(
        "Document sync response content-key bundle epoch mismatch",
      );
    }

    const existing = bundleByEpoch.get(bundle.contentKeyEpoch);
    if (!existing) {
      bundleByEpoch.set(bundle.contentKeyEpoch, bundle);
      continue;
    }
    if (
      contentKeyBundleCanonical(existing) !== contentKeyBundleCanonical(bundle)
    ) {
      throw new Error("Document sync response content-key bundle conflict");
    }
  }

  return bundleByEpoch;
}

async function persistedDocumentSyncStateFromResponseInternal(
  plan: DocumentSyncPlan,
  response: DocumentSyncResponse,
  options: {
    resolveWriterPublicKey: DocumentWriterPublicKeyResolver;
  },
): Promise<PersistedDocumentSyncState> {
  if (response.documentId !== plan.documentId) {
    throw new Error("Document sync response document id mismatch");
  }
  const contentKeyBundlesByEpoch = documentSyncContentKeyBundlesByEpoch(
    plan,
    response,
  );
  if (
    serializeCanonical(response.documentKekTargets, "KEK targets") !==
    serializeCanonical(plan.documentKekTargets, "KEK targets")
  ) {
    throw new Error("Document sync response KEK target mismatch");
  }
  assertAcceptedOutgoingUpdateIdsMatchPlan(plan, response);
  assertDocumentSyncCommitCheckpointMatchesPlan(plan, response);
  assertDocumentSyncAccessEpochsNotInFuture(plan, response);

  await Promise.all(
    response.updates.map((update) =>
      assertDocumentSyncResponseUpdateMatchesPlan({
        contentKeyBundlesByEpoch,
        plan,
        resolveWriterPublicKey: options.resolveWriterPublicKey,
        update,
      }),
    ),
  );

  return serializedPersistedDocumentState({
    contentKeyBundle: response.contentKeyBundle,
    documentId: plan.documentId,
    documentKekTargets: response.documentKekTargets,
    documentManifestBundle: plan.documentManifest,
  });
}

export async function persistedDocumentSyncStateFromResponse(
  plan: DocumentSyncPlan,
  response: DocumentSyncResponse,
  options: {
    resolveWriterPublicKey: DocumentWriterPublicKeyResolver;
  },
): Promise<PersistedDocumentSyncState> {
  try {
    return await persistedDocumentSyncStateFromResponseInternal(
      plan,
      response,
      options,
    );
  } catch (error) {
    rethrowDatabaseUnavailableError(error);
    if (error instanceof KeyingVerificationError) {
      throw error;
    }
    throw new KeyingVerificationError(
      "invalid_shape",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function isRetryableDocumentSyncConflict(
  failure: DocumentSyncSubmitFailure,
): boolean {
  return (
    failure.status === 409 &&
    failure.code === DOCUMENT_SYNC_ERROR_CODES.stateStale
  );
}

// The wipe gate is deliberately strict — coded 404s only, which is the right
// failure mode for a destructive action. A bare 404 proves nothing about the
// document: proxy/tunnel error pages, deploy-skew route misses, and
// container-level lookups all produce one.
export function isUpstreamDeletedDocumentSyncFailure(
  failure: DocumentSyncSubmitFailure,
): boolean {
  return (
    failure.status === 404 && failure.code === DOCUMENT_NOT_FOUND_ERROR_CODE
  );
}

export async function submitDocumentSync(input: {
  apiClient: DocumentSyncApi;
  plan: DocumentSyncPlan;
}): Promise<
  | {
      readonly ok: true;
      readonly response: DocumentSyncResponse;
    }
  | DocumentSyncSubmitFailure
  | null
> {
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
