import type {
  DocumentStructuredFieldPatch,
  StoredDocumentKind,
} from "@tearleads/client-sdk";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import { useDocumentRowWriters } from "../../stores/documents/useDocumentRowWriters";
import { useDocumentRowEditing } from "./useDocumentRowEditing";
import { useTargetedTrackerEditing } from "./useTargetedTrackerEditing";

/** Store and edit operations shared by tracker document containers. */
export function useTrackerDocument(initialEditing = false) {
  const document = useDocument();
  const { editingRowId, enterRowEdit, isEditing, toggleEditing } =
    useTargetedTrackerEditing(document.canWrite, initialEditing);
  const { clearRow, readCell, stageCell } = useDocumentRowEditing(
    document.rows,
  );
  const resolveRowWriter = useDocumentRowWriters(document.rows.length > 0);

  return {
    canWrite: document.canWrite,
    currentAuthorId: document.currentAuthorId,
    editingRowId,
    enterRowEdit,
    isEditing,
    readCell,
    ready: document.ready,
    resolveRowWriter,
    rows: document.rows,
    structuredFields: document.structuredFields,
    toggleEditing,
    addRow: (fields: Readonly<Record<string, string>>) =>
      document.canWrite ? document.addRow(fields) : Promise.resolve(null),
    removeRow: (id: string) => {
      if (document.canWrite) {
        void document.removeRow(id);
      }
      clearRow(id);
    },
    setFields: (
      kind: Exclude<StoredDocumentKind, "note">,
      fields: DocumentStructuredFieldPatch,
    ) => {
      if (document.canWrite) {
        void document.setStructuredFields(kind, fields);
      }
    },
    updateRow: (id: string, field: string, value: string) => {
      stageCell(id, field, value);
      if (document.canWrite) {
        void document.updateRowFields(id, { [field]: value });
      }
    },
  };
}
