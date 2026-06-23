import { Buffer } from "node:buffer";
import type {
  ApiDatabase,
  DatabaseSession,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import { documentUpdates } from "@tearleads/api-shared/schema";
import type { VerifiedWriteHeader, WriteHeader } from "@tearleads/crypto";
import {
  computeDocumentContentRecordCiphertextHash,
  computeDocumentContentRecordMetadataHash,
  computeWriteHeaderHash,
  verifyWriteHeader,
} from "@tearleads/crypto";
import type {
  DocumentOutgoingUpdate,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { inArray } from "drizzle-orm";
import { lockAccessManifestHeadsForShare } from "../../../access/read/accessManifestStore";
import {
  getDocumentContentKeyBundle,
  listDocumentContentWriteHeaders,
  type StoredDocumentContentKeyBundle,
} from "../../../access/read/documentContentKeyStore";
import { resolveCurrentDocumentKekTargets } from "../../../access/read/documentKekTargets";
import {
  requireAndRefreshCurrentDocumentContentKeyBundle,
  storeDocumentContentKeyBundleInTransaction,
  storeDocumentContentWriteHeader,
} from "../../../access/write/documentContentKeyStore";
import { readCurrentCommitLsn } from "../../../documents/commitLsn";
import { documentAuditAccessFromManifest } from "../../../documents/documentAuditAccess";
import { maybeWriteDocumentAuditCheckpoint } from "../../../documents/documentAuditCheckpoints";
import { appendDocumentUpdateAuditEntries } from "../../../documents/documentAuditEntries";
import { insertDocumentUpdateSpans } from "../../../documents/documentUpdateSpans";
import { listMissingDocumentUpdates } from "../../../documents/documentUpdateStore";
import { uniqueSortedStrings } from "../../../utils/array";
import { canonicalJsonEquals } from "../../../utils/canonicalJson";
import { applyContainerRekeys } from "../../containers/mutations";
import {
  ContainerWriterProjectionError,
  createContainerWriterProjectionContext,
  resolveContainerReaderProjection,
  resolveContainerWriterProjection,
} from "../../containers/writerProjection";
import { DocumentMutationError, toMutationError } from "./errors";
import {
  ensureDocumentExists,
  touchDocumentAndLinkedContainers,
} from "./shared/documentRows";
import {
  assertSyncContentKeyBundleMatchesRequest,
  readWriteHeader,
  toContentKeyBundleResponse,
  toDocumentKekTargetsResponse,
  toStoredContentKeyBundleInput,
  writeHeaderRecord,
} from "./shared/records";
import {
  loadSignerPublicKey,
  verifySyncWriteAuthorizationProof,
} from "./shared/verification";
import type {
  AppendDocumentUpdatesInput,
  DocumentWriteAuthorizationProof,
  SyncDocumentInput,
} from "./types";

function documentUpdateByteLength(update: DocumentOutgoingUpdate): number {
  return Buffer.byteLength(update.encryptedData, "utf8");
}

type ContainerProjectionResolver = typeof resolveContainerWriterProjection;

async function ensureDocumentAccess(
  input: {
    readonly currentTargets: Awaited<
      ReturnType<typeof resolveCurrentDocumentKekTargets>
    >;
    readonly executor: DatabaseTransaction;
    readonly userId: string;
  },
  resolver: ContainerProjectionResolver,
): Promise<void> {
  const containerProjectionContext = createContainerWriterProjectionContext(
    input.executor,
  );

  for (const containerId of new Set(
    input.currentTargets.targets.map((target) => target.containerId),
  )) {
    try {
      await resolver({
        containerId,
        context: containerProjectionContext,
        executor: input.executor,
        userId: input.userId,
      });
      return;
    } catch (error) {
      if (
        error instanceof ContainerWriterProjectionError &&
        error.status === 403
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new DocumentMutationError("Forbidden", 403);
}

async function ensureSyncDocumentAccess(input: {
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
  readonly executor: DatabaseTransaction;
  readonly request: DocumentSyncRequest;
  readonly userId: string;
}): Promise<void> {
  // Empty sync requests only pull missing updates, so read access is enough.
  const resolver =
    input.request.outgoingUpdates.length > 0
      ? resolveContainerWriterProjection
      : resolveContainerReaderProjection;

  await ensureDocumentAccess(
    {
      currentTargets: input.currentTargets,
      executor: input.executor,
      userId: input.userId,
    },
    resolver,
  );
}

async function verifyOutgoingWriteHeader(input: {
  readonly documentId: string;
  readonly expectedLinkSetManifestHash: string;
  readonly expectedTargetHash: string;
  readonly organizationId: string;
  readonly requestContentKeyEpoch: number;
  readonly signingPublicKey: Uint8Array;
  readonly update: DocumentOutgoingUpdate;
  readonly userId: string;
  readonly writeAuthorization: DocumentWriteAuthorizationProof | null;
}): Promise<VerifiedWriteHeader> {
  const header = readWriteHeader(
    input.update.writeHeader,
    "Document write header",
  );
  if (
    header.writerUserId !== input.userId ||
    header.contentKeyEpoch !== input.requestContentKeyEpoch
  ) {
    throw new DocumentMutationError("Write header does not match request", 400);
  }
  if (!input.writeAuthorization) {
    throw new DocumentMutationError(
      "Document write authorization proof is required",
      400,
    );
  }

  const verified = await verifyWriteHeader({
    documentAuthorization: input.writeAuthorization,
    expectedAccessManifestHash: input.expectedLinkSetManifestHash,
    expectedObject: {
      objectKind: "document",
      objectId: input.documentId,
      organizationId: input.organizationId,
    },
    expectedTargetHash: input.expectedTargetHash,
    header,
    writerPublicKey: input.signingPublicKey,
  });
  if (!verified.ok) {
    throw verified.error;
  }
  await assertOutgoingUpdatePayloadMatchesHeader({
    documentId: input.documentId,
    header: verified.value.header,
    update: input.update,
  });

  return verified.value;
}

async function assertOutgoingUpdatePayloadMatchesHeader(input: {
  readonly documentId: string;
  readonly header: WriteHeader;
  readonly update: DocumentOutgoingUpdate;
}): Promise<void> {
  const metadataHash = await computeDocumentContentRecordMetadataHash({
    documentId: input.documentId,
    partialEndVersionVector: input.update.partialEndVersionVector,
    partialStartVersionVector: input.update.partialStartVersionVector,
    updateId: input.update.id,
  });
  if (metadataHash !== input.header.metadataHash) {
    throw new DocumentMutationError(
      "Document update metadata hash mismatch",
      400,
    );
  }

  const ciphertextHash = await computeDocumentContentRecordCiphertextHash(
    input.update.encryptedData,
  );
  if (ciphertextHash !== input.header.ciphertextHash) {
    throw new DocumentMutationError(
      "Document update ciphertext hash mismatch",
      400,
    );
  }
}

async function assertRetryWriteHeaderMatches(input: {
  readonly expectedHeaderHash: string;
  readonly update: DocumentOutgoingUpdate;
}): Promise<void> {
  const headerHash = await computeWriteHeaderHash(
    readWriteHeader(input.update.writeHeader, "Document write header"),
  );
  if (headerHash !== input.expectedHeaderHash) {
    throw new DocumentMutationError("Document write header conflict", 409);
  }
}

async function assertRetryUpdateMatchesAcceptedContent(input: {
  readonly acceptedHeaderHash: string | undefined;
  readonly existingRow:
    | {
        readonly encryptedData: string;
        readonly partialEndVersionVector: string;
        readonly partialStartVersionVector: string;
      }
    | undefined;
  readonly update: DocumentOutgoingUpdate;
}): Promise<void> {
  if (
    !input.existingRow ||
    input.existingRow.encryptedData !== input.update.encryptedData ||
    input.existingRow.partialStartVersionVector !==
      input.update.partialStartVersionVector ||
    input.existingRow.partialEndVersionVector !==
      input.update.partialEndVersionVector
  ) {
    throw new DocumentMutationError("Document update id conflict", 409);
  }
  if (!input.acceptedHeaderHash) {
    throw new DocumentMutationError("Document write header conflict", 409);
  }
  await assertRetryWriteHeaderMatches({
    expectedHeaderHash: input.acceptedHeaderHash,
    update: input.update,
  });
}

function acceptedOutgoingUpdateIds(
  updates: readonly DocumentOutgoingUpdate[],
  acceptedUpdateIds: ReadonlySet<string>,
): string[] {
  return updates
    .filter((update) => acceptedUpdateIds.has(update.id))
    .map((update) => update.id);
}

function assertDuplicateOutgoingUpdateMatches(
  first: DocumentOutgoingUpdate,
  next: DocumentOutgoingUpdate,
): void {
  if (
    first.encryptedData === next.encryptedData &&
    first.partialStartVersionVector === next.partialStartVersionVector &&
    first.partialEndVersionVector === next.partialEndVersionVector &&
    (first.sourceVersionVector ?? null) ===
      (next.sourceVersionVector ?? null) &&
    (first.checkpointKind ?? null) === (next.checkpointKind ?? null) &&
    canonicalJsonEquals(first.writeHeader, next.writeHeader)
  ) {
    return;
  }

  throw new DocumentMutationError("Document update id conflict", 409);
}

function uniqueOutgoingUpdates(
  updates: readonly DocumentOutgoingUpdate[],
): DocumentOutgoingUpdate[] {
  const uniqueUpdates: DocumentOutgoingUpdate[] = [];
  const updateById = new Map<string, DocumentOutgoingUpdate>();

  for (const update of updates) {
    const existing = updateById.get(update.id);
    if (!existing) {
      updateById.set(update.id, update);
      uniqueUpdates.push(update);
      continue;
    }

    assertDuplicateOutgoingUpdateMatches(existing, update);
  }

  return uniqueUpdates;
}

async function insertNewDocumentUpdates(input: {
  readonly accessEpoch: number;
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly updates: readonly DocumentOutgoingUpdate[];
}): Promise<ReadonlySet<string>> {
  if (input.updates.length === 0) {
    return new Set<string>();
  }

  const insertedRows = await input.executor
    .insert(documentUpdates)
    .values(
      input.updates.map((update) => ({
        id: update.id,
        documentId: input.documentId,
        accessEpoch: input.accessEpoch,
        authorFingerprint: input.fingerprint,
        encryptedData: update.encryptedData,
        byteLength: documentUpdateByteLength(update),
        partialStartVersionVector: update.partialStartVersionVector,
        partialEndVersionVector: update.partialEndVersionVector,
      })),
    )
    .returning({ id: documentUpdates.id });
  const insertedUpdateIds = new Set(insertedRows.map((row) => row.id));
  await insertDocumentUpdateSpans(input.executor, {
    documentId: input.documentId,
    updates: input.updates.filter((update) => insertedUpdateIds.has(update.id)),
  });

  return insertedUpdateIds;
}

async function appendAuditEntriesForNewDocumentUpdates(input: {
  readonly accessEpoch: number;
  readonly accessManifestHash: string;
  readonly accessStateHash: string | null;
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly updates: readonly DocumentOutgoingUpdate[];
  readonly userId: string;
}): Promise<void> {
  if (input.updates.length === 0) {
    return;
  }

  const auditEntryHashByUpdateId = await appendDocumentUpdateAuditEntries(
    input.executor,
    {
      accessEpoch: input.accessEpoch,
      accessManifestHash: input.accessManifestHash,
      accessStateHash: input.accessStateHash,
      actorFingerprint: input.fingerprint,
      actorUserId: input.userId,
      documentId: input.documentId,
      updates: input.updates,
    },
  );

  for (const update of input.updates) {
    const coveredAuditEntryHash = auditEntryHashByUpdateId.get(update.id);
    if (update.checkpointKind) {
      if (!coveredAuditEntryHash) {
        const message = `Missing audit entry hash for checkpoint update ${update.id}`;
        throw new DocumentMutationError(message, 409);
      }
      await maybeWriteDocumentAuditCheckpoint(input.executor, {
        accessEpoch: input.accessEpoch,
        accessManifestHash: input.accessManifestHash,
        accessStateHash: input.accessStateHash,
        actorFingerprint: input.fingerprint,
        actorUserId: input.userId,
        checkpointUpdate: update,
        coveredAuditEntryHash,
        documentId: input.documentId,
      });
    }
  }
}

async function loadExistingDocumentUpdateRows(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly updateIds: readonly string[];
}) {
  const existingRows = await input.executor
    .select({
      documentId: documentUpdates.documentId,
      encryptedData: documentUpdates.encryptedData,
      id: documentUpdates.id,
      partialEndVersionVector: documentUpdates.partialEndVersionVector,
      partialStartVersionVector: documentUpdates.partialStartVersionVector,
    })
    .from(documentUpdates)
    .where(inArray(documentUpdates.id, input.updateIds));

  for (const row of existingRows) {
    if (row.documentId !== input.documentId) {
      throw new DocumentMutationError("Document update id conflict", 409);
    }
  }

  return existingRows;
}

interface AppendDocumentUpdatesResult {
  readonly acceptedOutgoingUpdateIds: string[];
  readonly insertedUpdateIds: ReadonlySet<string>;
}

async function appendDocumentUpdates(
  input: AppendDocumentUpdatesInput,
): Promise<AppendDocumentUpdatesResult> {
  if (input.request.outgoingUpdates.length === 0) {
    return {
      acceptedOutgoingUpdateIds: [],
      insertedUpdateIds: new Set(),
    };
  }

  const outgoingUpdates = uniqueOutgoingUpdates(input.request.outgoingUpdates);
  const updateIds = uniqueSortedStrings(
    outgoingUpdates.map((update) => update.id),
  );
  const existingRows = await loadExistingDocumentUpdateRows({
    documentId: input.documentId,
    executor: input.executor,
    updateIds,
  });
  const existingRowsById = new Map(existingRows.map((row) => [row.id, row]));
  const acceptedUpdateIds = new Set(existingRowsById.keys());
  const acceptedHeaderHashes = await listDocumentContentWriteHeaders(
    [...acceptedUpdateIds],
    input.executor,
  );
  const newUpdates: DocumentOutgoingUpdate[] = [];

  for (const update of outgoingUpdates) {
    const acceptedHeaderHash = acceptedHeaderHashes.get(update.id)?.headerHash;
    if (acceptedUpdateIds.has(update.id)) {
      await assertRetryUpdateMatchesAcceptedContent({
        acceptedHeaderHash,
        existingRow: existingRowsById.get(update.id),
        update,
      });
      continue;
    }

    const verifiedHeader = await verifyOutgoingWriteHeader({
      documentId: input.documentId,
      expectedLinkSetManifestHash: input.request.expectedLinkSetManifestHash,
      expectedTargetHash: input.request.expectedTargetHash,
      organizationId: input.organizationId,
      requestContentKeyEpoch: input.request.contentKeyEpoch,
      signingPublicKey: input.signingPublicKey,
      update,
      userId: input.userId,
      writeAuthorization: input.writeAuthorization,
    });

    await storeDocumentContentWriteHeader(
      {
        documentId: input.documentId,
        header: verifiedHeader.header,
        headerHash: verifiedHeader.headerHash,
        updateId: update.id,
      },
      input.executor,
    );

    acceptedUpdateIds.add(update.id);
    acceptedHeaderHashes.set(update.id, {
      header: verifiedHeader.header,
      headerHash: verifiedHeader.headerHash,
    });
    newUpdates.push(update);
  }

  const insertedUpdateIds = await insertNewDocumentUpdates({
    accessEpoch: input.accessEpoch,
    documentId: input.documentId,
    executor: input.executor,
    fingerprint: input.fingerprint,
    updates: newUpdates,
  });
  await appendAuditEntriesForNewDocumentUpdates({
    accessEpoch: input.accessEpoch,
    accessManifestHash: input.accessManifestHash,
    accessStateHash: input.accessStateHash,
    documentId: input.documentId,
    executor: input.executor,
    fingerprint: input.fingerprint,
    updates: newUpdates.filter((update) => insertedUpdateIds.has(update.id)),
    userId: input.userId,
  });

  return {
    acceptedOutgoingUpdateIds: acceptedOutgoingUpdateIds(
      outgoingUpdates,
      acceptedUpdateIds,
    ),
    insertedUpdateIds,
  };
}

async function listMissingUpdates(input: {
  readonly documentId: string;
  readonly executor: DatabaseSession;
  readonly localVersionVector: string | null;
  readonly minLsn?: string | undefined;
}) {
  return listMissingDocumentUpdates(input.executor, {
    documentId: input.documentId,
    localVersionVector: input.localVersionVector,
    minLsn: input.minLsn,
  });
}

function toSyncUpdate(
  update: Awaited<ReturnType<typeof listMissingUpdates>>[number],
  writeHeader: { readonly header: WriteHeader; readonly headerHash: string },
) {
  return {
    accessEpoch: update.accessEpoch,
    id: update.id,
    documentId: update.documentId,
    authorFingerprint: update.authorFingerprint,
    encryptedData: update.encryptedData,
    partialStartVersionVector: update.partialStartVersionVector,
    partialEndVersionVector: update.partialEndVersionVector,
    createdAt: update.createdAt.toISOString(),
    writeHeader: writeHeaderRecord(writeHeader.header),
  };
}

function toSyncUpdateWithWriteHeader(
  update: Awaited<ReturnType<typeof listMissingUpdates>>[number],
  writeHeader: { readonly header: WriteHeader; readonly headerHash: string },
) {
  return {
    update: toSyncUpdate(update, writeHeader),
    writeHeader: writeHeader.header,
  };
}

async function attachWriteHeadersToUpdates(input: {
  readonly executor: DatabaseSession;
  readonly updates: Awaited<ReturnType<typeof listMissingUpdates>>;
}) {
  const writeHeadersByUpdateId = await listDocumentContentWriteHeaders(
    input.updates.map((update) => update.id),
    input.executor,
  );

  return input.updates.map((update) => {
    const writeHeader = writeHeadersByUpdateId.get(update.id);
    if (!writeHeader) {
      throw new DocumentMutationError("Document write header missing", 409);
    }

    return toSyncUpdateWithWriteHeader(update, writeHeader);
  });
}

function uniqueContentKeyEpochs(contentKeyEpochs: Iterable<number>): number[] {
  return [...new Set(contentKeyEpochs)].sort((left, right) => left - right);
}

async function listContentKeyBundlesForSyncResponse(input: {
  readonly contentKeyEpochs: Iterable<number>;
  readonly currentBundle: StoredDocumentContentKeyBundle;
  readonly documentId: string;
  readonly executor: DatabaseSession;
}): Promise<StoredDocumentContentKeyBundle[]> {
  const bundleByEpoch = new Map<number, StoredDocumentContentKeyBundle>([
    [input.currentBundle.contentKeyEpoch, input.currentBundle],
  ]);

  for (const contentKeyEpoch of uniqueContentKeyEpochs(
    input.contentKeyEpochs,
  )) {
    if (bundleByEpoch.has(contentKeyEpoch)) {
      continue;
    }

    const bundle = await getDocumentContentKeyBundle(
      input.documentId,
      contentKeyEpoch,
      input.executor,
    );
    if (!bundle) {
      throw new DocumentMutationError(
        "Document content-key bundle missing",
        409,
      );
    }
    bundleByEpoch.set(contentKeyEpoch, bundle);
  }

  return [...bundleByEpoch.values()].sort(
    (left, right) => left.contentKeyEpoch - right.contentKeyEpoch,
  );
}

async function resolveSyncContentKeyBundle(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly request: DocumentSyncRequest;
}) {
  return input.request.contentKeyBundle
    ? storeDocumentContentKeyBundleInTransaction(
        toStoredContentKeyBundleInput(
          input.documentId,
          input.request.contentKeyBundle,
        ),
        input.executor,
      )
    : requireAndRefreshCurrentDocumentContentKeyBundle({
        documentId: input.documentId,
        contentKeyEpoch: input.request.contentKeyEpoch,
        expectedLinkSetManifestHash: input.request.expectedLinkSetManifestHash,
        expectedTargetHash: input.request.expectedTargetHash,
        executor: input.executor,
      });
}

async function resolveSyncAuditAccess(input: {
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
  readonly writeAuthorization: DocumentWriteAuthorizationProof | null;
}) {
  return input.writeAuthorization
    ? documentAuditAccessFromManifest(input.writeAuthorization.documentManifest)
    : {
        accessEpoch: input.currentTargets.linkSetEpoch,
        accessManifestHash: input.currentTargets.linkSetManifestHash,
        accessStateHash: null,
      };
}

async function touchAcceptedSyncTargets(input: {
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly insertedUpdateIds: ReadonlySet<string>;
}) {
  if (input.insertedUpdateIds.size === 0) {
    return;
  }

  await touchDocumentAndLinkedContainers(input.executor, {
    documentId: input.documentId,
    linkedContainerIds: input.currentTargets.targets.map(
      (target) => target.containerId,
    ),
  });
}

async function listMissingSyncUpdatesWithBundles(input: {
  readonly contentKeyBundle: StoredDocumentContentKeyBundle;
  readonly documentId: string;
  readonly executor: DatabaseSession;
  readonly request: DocumentSyncRequest;
}) {
  const missingUpdateRecords = await listMissingUpdates({
    documentId: input.documentId,
    executor: input.executor,
    localVersionVector: input.request.localVersionVector,
    minLsn: input.request.minLsn,
  });
  const missingUpdateEntries = await attachWriteHeadersToUpdates({
    executor: input.executor,
    updates: missingUpdateRecords,
  });
  const contentKeyBundles = await listContentKeyBundlesForSyncResponse({
    contentKeyEpochs: missingUpdateEntries.map(
      (entry) => entry.writeHeader.contentKeyEpoch,
    ),
    currentBundle: input.contentKeyBundle,
    documentId: input.documentId,
    executor: input.executor,
  });

  return {
    contentKeyBundles,
    missingUpdates: missingUpdateEntries.map((entry) => entry.update),
  };
}

async function syncDocumentTransaction(input: {
  readonly documentId: string;
  readonly fingerprint: string;
  readonly request: DocumentSyncRequest;
  readonly signingPublicKey: Uint8Array;
  readonly tx: DatabaseTransaction;
  readonly userId: string;
}) {
  await ensureDocumentExists({
    documentId: input.documentId,
    executor: input.tx,
  });
  assertSyncContentKeyBundleMatchesRequest(input.request);
  // Run signed container.rekey payloads before resolving document KEK targets;
  // content-key validation then compares the write against the updated target
  // set, while transaction rollback keeps failed writes from publishing rekeys.
  await applyContainerRekeys({
    executor: input.tx,
    fingerprint: input.fingerprint,
    requests: input.request.containerRekeys,
    userId: input.userId,
  });
  const currentTargets = await resolveCurrentDocumentKekTargets(
    input.documentId,
    input.tx,
  );
  // Serialize a content append against a concurrent container.rekey. Under the
  // default READ COMMITTED isolation, a rekey that commits between the
  // current-targets validation in resolveSyncContentKeyBundle below and the
  // appendDocumentUpdates insert would let this write land under a superseded
  // container key epoch — i.e. wrapped to the pre-rotation recipient set, which
  // can include a just-revoked principal. Taking a FOR SHARE lock on the linked
  // container access-manifest heads makes such a rekey block until this write
  // commits (or, if it already committed, the stale-epoch check fails closed),
  // while independent document syncs still run in parallel. Empty (read-only)
  // syncs write no content and take no lock.
  if (input.request.outgoingUpdates.length > 0) {
    await lockAccessManifestHeadsForShare(
      "container",
      currentTargets.targets.map((target) => target.containerId),
      input.tx,
    );
  }
  await ensureSyncDocumentAccess({
    currentTargets,
    executor: input.tx,
    request: input.request,
    userId: input.userId,
  });
  const writeAuthorization = await verifySyncWriteAuthorizationProof({
    currentTargets,
    documentId: input.documentId,
    executor: input.tx,
    request: input.request,
  });
  const contentKeyBundle = await resolveSyncContentKeyBundle({
    documentId: input.documentId,
    executor: input.tx,
    request: input.request,
  });
  const auditAccess = await resolveSyncAuditAccess({
    currentTargets,
    writeAuthorization,
  });
  const appendResult = await appendDocumentUpdates({
    accessEpoch: auditAccess.accessEpoch,
    accessManifestHash: auditAccess.accessManifestHash,
    accessStateHash: auditAccess.accessStateHash,
    documentId: input.documentId,
    executor: input.tx,
    fingerprint: input.fingerprint,
    organizationId: currentTargets.organizationId,
    request: input.request,
    signingPublicKey: input.signingPublicKey,
    userId: input.userId,
    writeAuthorization,
  });
  await touchAcceptedSyncTargets({
    currentTargets,
    documentId: input.documentId,
    executor: input.tx,
    insertedUpdateIds: appendResult.insertedUpdateIds,
  });
  const { contentKeyBundles, missingUpdates } =
    await listMissingSyncUpdatesWithBundles({
      contentKeyBundle,
      documentId: input.documentId,
      executor: input.tx,
      request: input.request,
    });

  return {
    accessEpoch: currentTargets.linkSetEpoch,
    acceptedOutgoingUpdateIds: appendResult.acceptedOutgoingUpdateIds,
    contentKeyBundle,
    contentKeyBundles,
    currentTargets,
    missingUpdates,
  };
}

export async function runDocumentSyncWorkflow(
  db: ApiDatabase,
  input: SyncDocumentInput,
): Promise<DocumentSyncResponse> {
  try {
    const signingPublicKey = await loadSignerPublicKey(db, input);
    const transactionResult = await db.transaction((tx) =>
      syncDocumentTransaction({
        documentId: input.documentId,
        fingerprint: input.fingerprint,
        request: input.request,
        signingPublicKey,
        tx,
        userId: input.userId,
      }),
    );
    return {
      acceptedOutgoingUpdateIds: transactionResult.acceptedOutgoingUpdateIds,
      commitLsn: await readCurrentCommitLsn(db),
      contentKeyBundle: toContentKeyBundleResponse(
        transactionResult.contentKeyBundle,
      ),
      contentKeyBundles: transactionResult.contentKeyBundles.map((bundle) =>
        toContentKeyBundleResponse(bundle),
      ),
      documentId: input.documentId,
      documentKekTargets: toDocumentKekTargetsResponse(
        transactionResult.currentTargets,
      ),
      updates: transactionResult.missingUpdates,
    };
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
}
