import { bytesToBase64 } from "@tearleads/encoding";
import { exportAllUpdates, getTextValue } from "@tearleads/loro";
import { DEFAULT_DOCUMENT_ACCESS_EPOCH } from "../../data/documents/documentConstants";
import type {
  StoredDocumentRecord as DocumentRecord,
  DocumentsPersistence,
} from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

type DocumentContentState = Parameters<typeof exportAllUpdates>[0];
type NullableDocumentRuntimeField =
  | "accessStateHash"
  | "lastCommitLsn"
  | "contentKeyBundle"
  | "documentKekTargets"
  | "documentManifestBundle";

interface PersistedDocumentState {
  record: DocumentRecord;
  updatedAt: string;
}

function resolveNullableDocumentRuntimeField(
  patch: Partial<DocumentRecord>,
  key: NullableDocumentRuntimeField,
  currentValue: string | null | undefined,
  resetWhenUnpatched = false,
): string | null {
  if (Object.hasOwn(patch, key)) {
    return patch[key] ?? null;
  }

  return resetWhenUnpatched ? null : (currentValue ?? null);
}

export async function persistDocumentState(input: {
  acceptedPendingUpdateIds?: readonly string[] | undefined;
  containerId?: string | null | undefined;
  currentDoc: DocumentContentState;
  currentRecord: DocumentRecord | null;
  execSql: ExecSql;
  localId: string;
  patch?: Partial<DocumentRecord> | undefined;
  persistence: DocumentsPersistence;
}): Promise<PersistedDocumentState> {
  const { currentDoc, currentRecord, execSql, localId, persistence } = input;
  const patch = input.patch ?? {};
  const acceptedPendingUpdateIds = input.acceptedPendingUpdateIds ?? [];
  const currentDocumentId = currentRecord?.documentId ?? null;
  const nextDocumentId = patch.documentId ?? currentDocumentId;
  const documentIdChanged = nextDocumentId !== currentDocumentId;
  const currentAccessEpoch =
    currentRecord?.accessEpoch ?? DEFAULT_DOCUMENT_ACCESS_EPOCH;
  const nextAccessEpoch = patch.accessEpoch ?? currentAccessEpoch;
  const securityContextChanged =
    documentIdChanged || nextAccessEpoch !== currentAccessEpoch;
  const nextRecord: DocumentRecord = {
    id: currentRecord?.id ?? localId,
    containerId:
      patch.containerId ??
      currentRecord?.containerId ??
      input.containerId ??
      null,
    documentId: nextDocumentId,
    text: patch.text ?? getTextValue(currentDoc),
    loroSnapshot:
      patch.loroSnapshot ?? bytesToBase64(exportAllUpdates(currentDoc)),
    accessEpoch: nextAccessEpoch,
    accessStateHash: resolveNullableDocumentRuntimeField(
      patch,
      "accessStateHash",
      currentRecord?.accessStateHash,
      securityContextChanged,
    ),
    lastCommitLsn: resolveNullableDocumentRuntimeField(
      patch,
      "lastCommitLsn",
      currentRecord?.lastCommitLsn,
      documentIdChanged,
    ),
    contentKeyBundle: resolveNullableDocumentRuntimeField(
      patch,
      "contentKeyBundle",
      currentRecord?.contentKeyBundle,
      securityContextChanged,
    ),
    documentKekTargets: resolveNullableDocumentRuntimeField(
      patch,
      "documentKekTargets",
      currentRecord?.documentKekTargets,
      securityContextChanged,
    ),
    documentManifestBundle: resolveNullableDocumentRuntimeField(
      patch,
      "documentManifestBundle",
      currentRecord?.documentManifestBundle,
      securityContextChanged,
    ),
  };

  const updatedAt =
    acceptedPendingUpdateIds.length > 0
      ? await persistence.saveDocumentAndDeletePendingUpdates(
          execSql,
          nextRecord,
          acceptedPendingUpdateIds,
        )
      : await persistence.saveDocument(execSql, nextRecord);

  return {
    record: nextRecord,
    updatedAt,
  };
}
