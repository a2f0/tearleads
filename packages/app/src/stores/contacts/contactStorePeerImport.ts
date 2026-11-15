import {
  defaultDocumentsPersistence,
  deriveStableDocumentId,
} from "@tearleads/client-sdk";
import { findContactByUserId } from "./contactStoreLookup";
import type { ContactsStoreState } from "./contactStoreTypes";

export type PeerContactImportTarget =
  | {
      readonly status: "existing" | "create";
      readonly contactId: string;
      /** A discovered alias must still be bound to this history at the write. */
      readonly aliasOf: string | null;
    }
  | { readonly status: "refused" };

/**
 * Peer imports remain idempotent within their own address book. Every device
 * names the import's remote history D after the fixed local id; when D is
 * already known here under another local id (a discovery shell not yet
 * hydrated), complete that same history instead of refusing a second birth.
 */
export async function loadPeerContactImportTarget(
  state: ContactsStoreState,
  userId: string,
  current: () => boolean,
): Promise<PeerContactImportTarget> {
  const containerId = state.runtime.documents.state.containerId;
  if (!containerId || !current()) return { status: "refused" };
  const known = findContactByUserId(state.entriesById, userId);
  if (known) {
    return { status: "existing", contactId: known.id, aliasOf: null };
  }
  const fixedLocalId = `contact_v1_${containerId}_${userId}`;
  const documentId = await deriveStableDocumentId(fixedLocalId);
  const { execSql } = state.runtime.documents.infra;
  const alias = await defaultDocumentsPersistence.findLocalIdByDocumentId(
    execSql,
    documentId,
  );
  if (!current()) return { status: "refused" };
  if (!alias || alias === fixedLocalId) {
    return { status: "create", contactId: fixedLocalId, aliasOf: null };
  }
  const record = await defaultDocumentsPersistence.loadDocument(execSql, alias);
  if (!current() || !record) return { status: "refused" };
  const placements = await state.runtime.listPendingWrites();
  if (!current()) return { status: "refused" };
  // Never complete a history outside this address book, read-only to us, or
  // whose placement is still being decided.
  if (
    record.documentId !== documentId ||
    record.containerId !== containerId ||
    record.effectiveAccessLevel === "read" ||
    state.entriesById.get(alias)?.canWrite === false ||
    placements.some(
      (item) =>
        item.objectKind === "document" &&
        item.operations.some((operation) => operation.kind === "move") &&
        (item.localId === alias || item.remoteId === documentId),
    )
  ) {
    return { status: "refused" };
  }
  return { status: "existing", contactId: alias, aliasOf: documentId };
}
