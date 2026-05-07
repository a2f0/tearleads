import { toFingerprint } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type { EncapsulationKeyResponse } from "@tearleads/validators/response";
import type { AddressBookEntry } from "../../data/contacts/addressBookEntry";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";
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

export async function createRemoteContactDocument(input: {
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

export async function syncRemoteContactDocument(input: {
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
