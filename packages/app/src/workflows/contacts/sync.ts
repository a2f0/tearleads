import { toFingerprint } from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportAllUpdates,
  importUpdates,
} from "@tearleads/loro";
import type { EncapsulationKeyResponse } from "@tearleads/validators/response";
import type { AddressBookEntry } from "../../data/contacts/addressBookEntry";
import {
  type ContactDocument,
  getContactEntryValue,
} from "../../data/contacts/contactDocument";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type { ContactsPersistence } from "../../data/persistence/contacts/contactsPersistence";
import type {
  DocumentRecord,
  PendingUpdateRecord,
} from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  createRemoteDocument,
  type DocumentCreateAuthor,
  resolveDocumentCreateAuthor,
  syncRemoteDocument,
} from "../documents";

type ContactRemoteCreateResult = NonNullable<
  Awaited<ReturnType<typeof createRemoteDocument>>
>;
type ContactRemoteSyncResult = NonNullable<
  Awaited<ReturnType<typeof syncRemoteDocument>>
>;

type ContactDocumentSyncApi = Parameters<
  typeof createRemoteDocument
>[0]["apiClient"] &
  Parameters<typeof syncRemoteDocument>[0]["apiClient"] & {
    getEncapsulationKey(
      userId: string,
    ): Promise<EncapsulationKeyResponse | null>;
  };

export interface ContactDocumentSyncRuntime {
  apiClient: ContactDocumentSyncApi;
  containerId?: string | null;
  encapsulationKeyPair?: { publicKey: Uint8Array } | null;
  execSql: ExecSql;
  log: (message: string) => void;
  organizationId?: string | null;
  signingFingerprint?: string | null;
  signingKeyPair?:
    | {
        signingPrivateKey: Uint8Array;
        signingPublicKey: Uint8Array;
      }
    | null
    | undefined;
  userId?: string | null;
}

interface ContactRemoteSyncAttempt {
  outgoingUpdateCount: number;
  synced: ContactRemoteSyncResult;
}

export interface ContactDocumentState {
  doc: ContactDocument;
  entry: AddressBookEntry;
  record: DocumentRecord;
}

type NullableContactRuntimeField =
  | "lastCommitLsn"
  | "contentKeyBundle"
  | "documentKekTargets"
  | "documentManifestBundle";

interface SyncedContactDocument {
  entry: AddressBookEntry;
  record: DocumentRecord;
  shouldRequestFollowupSync: boolean;
}

function resolveNullableContactRuntimeField(
  patch: Partial<DocumentRecord>,
  key: NullableContactRuntimeField,
  currentValue: string | null | undefined,
  resetWhenUnpatched = false,
): string | null {
  if (Object.hasOwn(patch, key)) {
    return patch[key] ?? null;
  }

  return resetWhenUnpatched ? null : (currentValue ?? null);
}

export async function persistContactDocumentState(input: {
  acceptedPendingUpdateIds?: readonly string[];
  addressBookId: string;
  contact: ContactDocumentState;
  execSql: ExecSql;
  patch?: Partial<DocumentRecord>;
  persistence: ContactsPersistence;
}): Promise<DocumentRecord> {
  const {
    acceptedPendingUpdateIds,
    addressBookId,
    contact,
    execSql,
    persistence,
  } = input;
  const patch = input.patch ?? {};
  const currentDocumentId = contact.record.documentId ?? null;
  const nextDocumentId = patch.documentId ?? currentDocumentId;
  const documentIdChanged = nextDocumentId !== currentDocumentId;
  const nextRecord: DocumentRecord = {
    id: contact.entry.userId,
    documentId: nextDocumentId,
    loroSnapshot:
      patch.loroSnapshot ?? bytesToBase64(exportAllUpdates(contact.doc)),
    accessEpoch: patch.accessEpoch ?? contact.record.accessEpoch ?? 1,
    accessStateHash:
      patch.accessStateHash ?? contact.record.accessStateHash ?? null,
    lastCommitLsn: resolveNullableContactRuntimeField(
      patch,
      "lastCommitLsn",
      contact.record.lastCommitLsn,
      documentIdChanged,
    ),
    contentKeyBundle: resolveNullableContactRuntimeField(
      patch,
      "contentKeyBundle",
      contact.record.contentKeyBundle,
      documentIdChanged,
    ),
    documentKekTargets: resolveNullableContactRuntimeField(
      patch,
      "documentKekTargets",
      contact.record.documentKekTargets,
      documentIdChanged,
    ),
    documentManifestBundle: resolveNullableContactRuntimeField(
      patch,
      "documentManifestBundle",
      contact.record.documentManifestBundle,
      documentIdChanged,
    ),
  };

  if (acceptedPendingUpdateIds && acceptedPendingUpdateIds.length > 0) {
    await persistence.saveContactAndDeletePendingUpdates(
      execSql,
      addressBookId,
      nextRecord,
      contact.entry,
      acceptedPendingUpdateIds,
    );
  } else {
    await persistence.saveContact(
      execSql,
      addressBookId,
      nextRecord,
      contact.entry,
    );
  }

  return nextRecord;
}

async function resolveContactWriterPublicKeys(
  runtime: ContactDocumentSyncRuntime,
  contactEntry: AddressBookEntry,
  author: DocumentCreateAuthor,
): Promise<Map<string, Uint8Array>> {
  const { signingKeyPair } = runtime;
  if (!signingKeyPair) {
    throw new Error("Contacts writer public key is unavailable.");
  }

  const writerPublicKeysByFingerprint = new Map<string, Uint8Array>([
    [author.signerKeyFingerprint, signingKeyPair.signingPublicKey],
  ]);

  if (contactEntry.userId === runtime.userId) {
    return writerPublicKeysByFingerprint;
  }

  const response = await runtime.apiClient.getEncapsulationKey(
    contactEntry.userId,
  );
  if (!response) {
    return writerPublicKeysByFingerprint;
  }

  try {
    const signingPublicKey = base64ToBytes(response.signingPublicKey);
    const signingKeyFingerprint = await toFingerprint(signingPublicKey);
    if (
      response.userId !== contactEntry.userId ||
      signingKeyFingerprint !== response.signingKeyFingerprint
    ) {
      runtime.log(
        `Contacts (${contactEntry.userId}): skipped peer writer key because the response is inconsistent.`,
      );
      return writerPublicKeysByFingerprint;
    }

    writerPublicKeysByFingerprint.set(signingKeyFingerprint, signingPublicKey);
  } catch {
    runtime.log(
      `Contacts (${contactEntry.userId}): skipped peer writer key because it could not be decoded.`,
    );
  }

  return writerPublicKeysByFingerprint;
}

async function createRemoteContactDocument(input: {
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContactDocumentSyncRuntime;
  targetSecretKey: Uint8Array;
}): Promise<ContactRemoteCreateResult | null> {
  const { resolveProjectionUserKey, runtime, targetSecretKey } = input;
  if (!runtime.containerId) {
    return null;
  }

  const author = resolveDocumentCreateAuthor(runtime);
  if (!author) {
    runtime.log(
      "Contacts: skipped remote create because the writer context is unavailable.",
    );
    return null;
  }

  return createRemoteDocument({
    apiClient: runtime.apiClient,
    author,
    containerId: runtime.containerId,
    execSql: runtime.execSql,
    resolveProjectionUserKey,
    targetSecretKey,
  });
}

async function syncRemoteContactDocument(input: {
  contactEntry: AddressBookEntry;
  documentId: string;
  lastCommitLsn?: string | null | undefined;
  localVersionVector: string | null;
  pendingUpdates: readonly PendingUpdateRecord[];
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContactDocumentSyncRuntime;
  targetSecretKey: Uint8Array;
}): Promise<ContactRemoteSyncAttempt | null> {
  const {
    contactEntry,
    documentId,
    lastCommitLsn,
    localVersionVector,
    pendingUpdates,
    resolveProjectionUserKey,
    runtime,
    targetSecretKey,
  } = input;
  const author = resolveDocumentCreateAuthor(runtime);
  if (!author) {
    runtime.log(
      "Contacts: skipped sync because the writer context is unavailable.",
    );
    return null;
  }

  const synced = await syncRemoteDocument({
    apiClient: runtime.apiClient,
    author,
    documentId,
    execSql: runtime.execSql,
    localVersionVector,
    minLsn: lastCommitLsn ?? undefined,
    pendingUpdates,
    resolveProjectionUserKey,
    targetSecretKey,
    writerPublicKeysByFingerprint: await resolveContactWriterPublicKeys(
      runtime,
      contactEntry,
      author,
    ),
  });
  if (!synced) {
    return null;
  }

  return {
    outgoingUpdateCount: pendingUpdates.length,
    synced,
  };
}

async function ensureContactDocumentForSync(input: {
  addressBookId: string;
  contact: ContactDocumentState;
  pendingUpdates: readonly PendingUpdateRecord[];
  persistence: ContactsPersistence;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContactDocumentSyncRuntime;
  targetSecretKey: Uint8Array;
}): Promise<DocumentRecord | null> {
  const {
    addressBookId,
    contact,
    pendingUpdates,
    persistence,
    resolveProjectionUserKey,
    runtime,
    targetSecretKey,
  } = input;

  if (contact.record.documentId || pendingUpdates.length === 0) {
    return contact.record;
  }

  const created = await createRemoteContactDocument({
    resolveProjectionUserKey,
    runtime,
    targetSecretKey,
  });
  if (!created) {
    return null;
  }

  const nextRecord = await persistContactDocumentState({
    addressBookId,
    contact,
    execSql: runtime.execSql,
    patch: {
      ...created.persistedState,
      documentId: created.documentId,
    },
    persistence,
  });
  runtime.log(
    `Created contact document: ${created.documentId} (${contact.entry.userId})`,
  );

  return nextRecord;
}

export async function syncContactDocument(input: {
  addressBookId: string;
  contact: ContactDocumentState;
  persistence: ContactsPersistence;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContactDocumentSyncRuntime;
  targetSecretKey: Uint8Array;
}): Promise<SyncedContactDocument | null> {
  const {
    addressBookId,
    contact,
    persistence,
    resolveProjectionUserKey,
    runtime,
    targetSecretKey,
  } = input;
  const pendingUpdates = await persistence.listPendingUpdates(
    runtime.execSql,
    contact.entry.userId,
  );
  const record = await ensureContactDocumentForSync({
    addressBookId,
    contact,
    pendingUpdates,
    persistence,
    resolveProjectionUserKey,
    runtime,
    targetSecretKey,
  });
  if (!record?.documentId) {
    return null;
  }

  const syncAttempt = await syncRemoteContactDocument({
    contactEntry: contact.entry,
    documentId: record.documentId,
    lastCommitLsn: record.lastCommitLsn,
    localVersionVector: encodeVersionVector(contact.doc),
    pendingUpdates,
    resolveProjectionUserKey,
    runtime,
    targetSecretKey,
  });
  if (!syncAttempt) {
    return record === contact.record
      ? null
      : {
          entry: contact.entry,
          record,
          shouldRequestFollowupSync: false,
        };
  }

  let entry = contact.entry;
  if (syncAttempt.synced.decryptedUpdates.length > 0) {
    importUpdates(
      contact.doc,
      syncAttempt.synced.decryptedUpdates.map((update) => update.updateData),
    );
    entry =
      getContactEntryValue(
        contact.entry.userId,
        contact.doc,
        contact.entry.isSelf,
      ) ?? contact.entry;
  }

  const nextRecord = await persistContactDocumentState({
    acceptedPendingUpdateIds:
      syncAttempt.synced.response.acceptedOutgoingUpdateIds,
    addressBookId,
    contact: {
      doc: contact.doc,
      entry,
      record,
    },
    execSql: runtime.execSql,
    patch: {
      ...syncAttempt.synced.persistedState,
      lastCommitLsn:
        syncAttempt.synced.response.commitLsn ?? record.lastCommitLsn ?? null,
    },
    persistence,
  });

  return {
    entry,
    record: nextRecord,
    shouldRequestFollowupSync:
      syncAttempt.outgoingUpdateCount >
      syncAttempt.synced.response.acceptedOutgoingUpdateIds.length,
  };
}
