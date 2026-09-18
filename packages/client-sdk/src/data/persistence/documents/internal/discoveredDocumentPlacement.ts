import { DEFAULT_DOCUMENT_ACCESS_EPOCH } from "../../../documents/documentConstants";
import type { DiscoveredDocumentInput } from "../../../documents/documentSummary";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";
import { loadDocumentMovePlacement } from "../../containers/documentPlacement";
import type { StoredDocumentRecord } from "../types";
import { resolvePersistedAccessStateHash } from "./documentRuntimeState";

export async function resolveDiscoveredDocumentPlacement(
  tx: ClientSQLiteTransactionScope,
  existing: StoredDocumentRecord | null,
  input: DiscoveredDocumentInput,
) {
  const intent = await loadDocumentMovePlacement(tx, input.documentId);
  const stale = existing !== null && existing.accessEpoch > input.accessEpoch;
  const accessEpoch = Math.max(
    existing?.accessEpoch ?? DEFAULT_DOCUMENT_ACCESS_EPOCH,
    input.accessEpoch,
  );
  const containerId =
    intent?.targetContainerId ??
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
