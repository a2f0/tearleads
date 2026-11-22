import {
  createDocument,
  exportFullHistorySnapshot,
  importSnapshot,
  importUpdates,
  LoroImportUnresolvedDependenciesError,
  updateMatchesDocumentHistory,
} from "@tearleads/loro";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import type { DecryptedDocumentSyncUpdate } from "./documentSyncTypes";
import { importDecryptedDocumentSyncUpdates } from "./documentSyncUpdateImport";
import {
  isolateDocumentSyncBatchError,
  isolateDocumentSyncUpdateError,
} from "./documentSyncUpdateIsolation";
import {
  type VoidedDocumentSyncUpdate,
  voidedDocumentSyncUpdate,
} from "./documentUpdateVerdict";

type SyncResponseUpdate = DocumentSyncResponse["updates"][number];
type SyncDocument = Awaited<ReturnType<typeof createDocument>>;

function firstDuplicateUpdateId(
  updates: readonly { readonly id: string }[],
): string | null {
  const seen = new Set<string>();
  for (const update of updates) {
    if (seen.has(update.id)) return update.id;
    seen.add(update.id);
  }
  return null;
}

async function createValidationDocument(
  snapshot: Uint8Array,
  accepted: readonly DecryptedDocumentSyncUpdate[],
): Promise<SyncDocument> {
  const document = await createDocument(crypto.randomUUID());
  try {
    importSnapshot(document, snapshot);
    importDecryptedDocumentSyncUpdates(document, accepted);
    return document;
  } catch (error) {
    document.free();
    throw error;
  }
}

function isRotationBaseline(update: DecryptedDocumentSyncUpdate): boolean {
  return (
    update.checkpointKind === "rotate_baseline" &&
    update.checkpointPayloadKind === "full_history_snapshot"
  );
}

/**
 * Why `update` cannot join `document`, which holds the reader's history and
 * every update accepted before it in server order, or null when it joins.
 */
function importFailure(
  document: SyncDocument,
  update: DecryptedDocumentSyncUpdate,
): unknown {
  try {
    if (isRotationBaseline(update)) {
      importSnapshot(document, update.updateData);
    } else {
      importUpdates(document, [update.updateData]);
    }
  } catch (error) {
    return error instanceof LoroImportUnresolvedDependenciesError
      ? new Error(
          "incoming Loro update depends on operations no earlier served update carries",
          { cause: error },
        )
      : error;
  }
  // Loro keeps the first operation it holds for a peer/counter and ignores a
  // later one, so an update that reuses held ids with different operations
  // imports "successfully". Only the resulting history shows the reuse.
  if (!updateMatchesDocumentHistory(document, update.updateData)) {
    return new Error(
      "incoming Loro update reuses an already-covered frontier with different operations",
    );
  }
  return null;
}

/**
 * Judges a page's decrypted updates in server order against the reader's
 * document, before the live document or any durable frontier changes. An
 * update joins when it imports onto the reader's history plus every update
 * accepted before it, and carries exactly its declared operations there.
 * Otherwise it is void: one that reuses held operation ids loses to the
 * earlier carrier, and one whose parents no earlier update carries is never
 * applied. Server order is commit order, and an honest writer depends only on
 * operations it holds, which are committed before its update, so this voids
 * no honest update, and readers judging the same history in order void the
 * same ones. A dishonest writer's dependency on a later update can still join
 * for a reader that judges the update again once it holds the later one.
 *
 * Returns the voided updates; a duplicated id still fails the page, because
 * an honest server never serves one.
 */
export async function validateDocumentSyncUpdateImports(input: {
  currentDocument: SyncDocument;
  decryptedUpdates: readonly DecryptedDocumentSyncUpdate[];
  responseUpdates?: readonly SyncResponseUpdate[] | undefined;
}): Promise<VoidedDocumentSyncUpdate[]> {
  if (input.decryptedUpdates.length === 0) return [];

  const duplicateUpdateId =
    firstDuplicateUpdateId(input.decryptedUpdates) ??
    firstDuplicateUpdateId(input.responseUpdates ?? []);
  if (duplicateUpdateId !== null) {
    throw isolateDocumentSyncBatchError({
      cause: new Error(
        `Document sync response update id is duplicated: ${duplicateUpdateId}`,
      ),
      stage: "encrypted_record",
      updateIds: (input.responseUpdates ?? input.decryptedUpdates).map(
        (update) => update.id,
      ),
    });
  }

  const currentSnapshot = exportFullHistorySnapshot(input.currentDocument);
  const responseById = new Map(
    (input.responseUpdates ?? []).map((update) => [update.id, update]),
  );
  const accepted: DecryptedDocumentSyncUpdate[] = [];
  const voided: VoidedDocumentSyncUpdate[] = [];
  let document: SyncDocument | null = await createValidationDocument(
    currentSnapshot,
    accepted,
  );
  try {
    for (const update of input.decryptedUpdates) {
      const failure = importFailure(document, update);
      if (failure === null) {
        accepted.push(update);
        continue;
      }
      const voidedUpdate = voidedDocumentSyncUpdate(
        isolateDocumentSyncUpdateError({
          cause: failure,
          responseUpdate: responseById.get(update.id),
          stage: "loro_import",
          updateId: update.id,
        }),
      );
      if (!voidedUpdate) throw failure;
      voided.push(voidedUpdate);
      // A failed import can leave pending or partial operations behind, so
      // the next update is judged against a clean rebuild of what was kept.
      document.free();
      document = null;
      document = await createValidationDocument(currentSnapshot, accepted);
    }
  } finally {
    document?.free();
  }
  return voided;
}
