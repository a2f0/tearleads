import { DEFAULT_DOCUMENT_ACCESS_EPOCH } from "../../../documents/documentConstants";
import type { DiscoveredDocumentInput } from "../../../documents/documentSummary";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";
import {
  type DocumentMovePlacement,
  loadDocumentMovePlacement,
} from "../../container-contents/documentPlacement";
import type { StoredDocumentRecord } from "../types";
import { resolvePersistedAccessStateHash } from "./documentRuntimeState";

export async function resolveDiscoveredDocumentPlacement(
  tx: ClientSQLiteTransactionScope,
  existing: StoredDocumentRecord | null,
  input: DiscoveredDocumentInput,
) {
  return discoveredDocumentPlacement(
    existing,
    input,
    await loadDocumentMovePlacement(tx, input.documentId),
  );
}

/** The placement discovery writes, given the document's pending move intent. */
export function discoveredDocumentPlacement(
  existing: StoredDocumentRecord | null,
  input: DiscoveredDocumentInput,
  intent: DocumentMovePlacement | undefined,
) {
  const stale = existing !== null && existing.accessEpoch > input.accessEpoch;
  const accessEpoch = Math.max(
    existing?.accessEpoch ?? DEFAULT_DOCUMENT_ACCESS_EPOCH,
    input.accessEpoch,
  );
  const pendingContainerId =
    intent?.intentType === "document.link"
      ? (existing?.containerId ?? intent.targetContainerId)
      : intent?.targetContainerId;
  const containerId =
    pendingContainerId ??
    (stale
      ? existing.containerId
      : existing?.containerId &&
          input.linkedContainerIds.includes(existing.containerId)
        ? existing.containerId
        : (input.linkedContainerIds.find((id) => id === input.containerId) ??
          input.linkedContainerIds[0] ??
          input.containerId));
  return {
    accessEpoch,
    containerId,
    accessStateHash: resolvePersistedAccessStateHash(existing, {
      accessEpoch,
      accessStateHash: stale ? existing.accessStateHash : input.accessStateHash,
      documentId: input.documentId,
    }),
  };
}
