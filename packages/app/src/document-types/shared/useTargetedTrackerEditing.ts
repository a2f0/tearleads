import { useCallback, useEffect, useState } from "react";
import { useStructuredDocumentEditing } from "./StructuredDocument";

/** Owns the document edit mode and its optional row-specific target. */
export function useTargetedTrackerEditing(
  canWrite: boolean,
  initialEditing = false,
) {
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useStructuredDocumentEditing(
    canWrite,
    initialEditing,
  );

  useEffect(() => {
    if (!canWrite || !isEditing) {
      setEditingRowId(null);
    }
  }, [canWrite, isEditing]);

  const enterRowEdit = useCallback(
    (id: string) => {
      setEditingRowId(id);
      setIsEditing(true);
    },
    [setIsEditing],
  );
  const toggleEditing = useCallback(() => {
    setEditingRowId(null);
    setIsEditing((editing) => !editing);
  }, [setIsEditing]);

  return { editingRowId, enterRowEdit, isEditing, toggleEditing };
}
