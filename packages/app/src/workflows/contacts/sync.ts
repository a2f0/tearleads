import { toFingerprint } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type { EncapsulationKeyResponse } from "@tearleads/validators/response";
import type { AddressBookEntry } from "../../data/contacts/addressBookEntry";
import { createDocumentSignerDeviceId } from "../../data/documents/documentConstants";
import { createProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  createRemoteDocument,
  type DocumentCreateAuthor,
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

interface ContactDocumentSyncRuntime {
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

function resolveContactAuthor(
  runtime: ContactDocumentSyncRuntime,
): DocumentCreateAuthor | null {
  if (
    !runtime.organizationId ||
    !runtime.signingFingerprint ||
    !runtime.signingKeyPair ||
    !runtime.userId
  ) {
    return null;
  }

  return {
    organizationId: runtime.organizationId,
    signerDeviceId: createDocumentSignerDeviceId(runtime.signingFingerprint),
    signerKeyFingerprint: runtime.signingFingerprint,
    signerPrivateKey: runtime.signingKeyPair.signingPrivateKey,
    signerUserId: runtime.userId,
  };
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
    if (signingKeyFingerprint !== response.signingKeyFingerprint) {
      runtime.log(
        `Contacts (${contactEntry.userId}): skipped peer writer key because the signing fingerprint does not match the public key.`,
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

export async function createRemoteContactDocument(input: {
  runtime: ContactDocumentSyncRuntime;
  targetSecretKey: Uint8Array;
}): Promise<ContactRemoteCreateResult | null> {
  const { runtime, targetSecretKey } = input;
  if (!runtime.containerId) {
    return null;
  }

  const author = resolveContactAuthor(runtime);
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
    resolveProjectionUserKey: createProjectionUserKeyResolver(
      runtime,
      "Contacts",
    ),
    targetSecretKey,
  });
}

export async function syncRemoteContactDocument(input: {
  contactEntry: AddressBookEntry;
  documentId: string;
  lastCommitLsn?: string | null | undefined;
  localVersionVector: string | null;
  pendingUpdates: readonly PendingUpdateRecord[];
  runtime: ContactDocumentSyncRuntime;
  targetSecretKey: Uint8Array;
}): Promise<ContactRemoteSyncAttempt | null> {
  const {
    contactEntry,
    documentId,
    lastCommitLsn,
    localVersionVector,
    pendingUpdates,
    runtime,
    targetSecretKey,
  } = input;
  const author = resolveContactAuthor(runtime);
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
    resolveProjectionUserKey: createProjectionUserKeyResolver(
      runtime,
      "Contacts",
    ),
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
