import type { DatabaseTransaction } from "@symcrypt/api-shared/postgres";
import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import { DOCUMENT_SYNC_ERROR_CODES } from "@symcrypt/validators/response";
import {
  getDocumentContentKeyBundle,
  getLatestDocumentContentKeyEpoch,
  type StoredDocumentContentKeyBundle,
} from "../../../access/read/documentContentKeyStore";
import { DocumentKekTargetError } from "../../../access/read/documentKekTargets";
import {
  DocumentContentKeyBundleError,
  requireAndRefreshCurrentDocumentContentKeyBundle,
  storeDocumentContentKeyBundleInTransaction,
} from "../../../access/write/documentContentKeyStore";
import { toStoredContentKeyBundleInput } from "./shared/records";

interface ResolvedSyncContentKeyBundle {
  readonly contentKeyBundle: StoredDocumentContentKeyBundle;
  /**
   * True when a read-only pull was served against the stored bundle even
   * though it no longer matches the current KEK targets. The response must
   * then describe the bundle's own (stale) targets, not the current ones, so
   * the pair stays self-consistent for the client's plan/response checks.
   */
  readonly servedStaleBundle: boolean;
}

function isStaleSyncStateError(error: unknown): boolean {
  return (
    (error instanceof DocumentContentKeyBundleError ||
      error instanceof DocumentKekTargetError) &&
    error.code === DOCUMENT_SYNC_ERROR_CODES.stateStale
  );
}

export async function resolveSyncContentKeyBundle(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly request: DocumentSyncRequest;
}): Promise<ResolvedSyncContentKeyBundle> {
  if (input.request.contentKeyBundle) {
    return {
      contentKeyBundle: await storeDocumentContentKeyBundleInTransaction(
        toStoredContentKeyBundleInput(
          input.documentId,
          input.request.contentKeyBundle,
        ),
        input.executor,
      ),
      servedStaleBundle: false,
    };
  }

  try {
    return {
      contentKeyBundle: await requireAndRefreshCurrentDocumentContentKeyBundle({
        documentId: input.documentId,
        contentKeyEpoch: input.request.contentKeyEpoch,
        expectedLinkSetManifestHash: input.request.expectedLinkSetManifestHash,
        expectedTargetHash: input.request.expectedTargetHash,
        executor: input.executor,
      }),
      servedStaleBundle: false,
    };
  } catch (error) {
    // Reads must never be bricked by key-wrapping staleness: after a revoke
    // rotates a linked container's KEK, the stored bundle cannot be carried
    // forward server-side, but a reader synced to that exact bundle can still
    // pull with it. Staleness only gates writes (which heal the bundle by
    // carrying a re-wrapped one at the next content-key epoch).
    if (
      input.request.outgoingUpdates.length > 0 ||
      !isStaleSyncStateError(error)
    ) {
      throw error;
    }

    const storedBundle = await getDocumentContentKeyBundle(
      input.documentId,
      input.request.contentKeyEpoch,
      input.executor,
    );
    // Tolerate only the LATEST stored bundle: once a heal advances the epoch,
    // a reader holding superseded expectations has a healthy upgrade path (the
    // coded stale 409 routes it to the healed projection), and serving the
    // superseded pair would keep it pinned to pre-heal state instead.
    if (
      !storedBundle ||
      storedBundle.contentKeyEpoch !==
        (await getLatestDocumentContentKeyEpoch(
          input.documentId,
          input.executor,
        )) ||
      storedBundle.linkSetManifestHash !==
        input.request.expectedLinkSetManifestHash ||
      storedBundle.targetHash !== input.request.expectedTargetHash
    ) {
      throw error;
    }

    return { contentKeyBundle: storedBundle, servedStaleBundle: true };
  }
}
