import { DEFAULT_DOCUMENT_ACCESS_EPOCH } from "../../../../data/documents/documentConstants";
import type { DocumentRecord } from "../../../../workflows/documents";
import type { DocumentStoreRelinkInput } from "../../types";
import type { DocumentStoreState } from "../state";

/**
 * The record fields a relink rewrites: access and identity metadata. Optional
 * key material is written only when the relink carries it.
 */
export function relinkRecordPatch(
  record: DocumentStoreState["record"],
  input: DocumentStoreRelinkInput,
): Partial<DocumentRecord> {
  const { contentKeyBundle, documentKekTargets, documentManifestBundle } =
    input;
  return {
    accessEpoch: Math.max(
      record?.accessEpoch ?? DEFAULT_DOCUMENT_ACCESS_EPOCH,
      input.accessEpoch,
    ),
    accessStateHash:
      input.accessStateHash === undefined
        ? (record?.accessStateHash ?? null)
        : input.accessStateHash,
    containerId: input.containerId,
    documentId: input.documentId,
    ...(contentKeyBundle === undefined ? {} : { contentKeyBundle }),
    ...(documentKekTargets === undefined ? {} : { documentKekTargets }),
    ...(documentManifestBundle === undefined ? {} : { documentManifestBundle }),
  };
}
