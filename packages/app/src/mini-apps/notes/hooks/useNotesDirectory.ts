import {
  DEFAULT_DOCUMENT_KIND,
  type DocumentSummary,
  getUntitledDocumentTitle,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useState } from "react";
import { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import { DEFAULT_DOCUMENT_ID } from "../../../stores/documents/DocumentsProvider";
import { useLocalDocumentSummaries } from "../../../stores/documents/useLocalDocumentSummaries";

function compareNoteSummaries(
  left: DocumentSummary,
  right: DocumentSummary,
): number {
  const updatedAtComparison = right.updatedAt.localeCompare(left.updatedAt);
  return updatedAtComparison === 0
    ? right.id.localeCompare(left.id)
    : updatedAtComparison;
}

function resolveSelectedNoteId(
  currentNoteId: string | null,
  nextNotes: ReadonlyArray<DocumentSummary>,
  explicitNoteId: string | null,
): string {
  if (explicitNoteId) {
    return explicitNoteId;
  }
  if (
    currentNoteId &&
    (currentNoteId === DEFAULT_DOCUMENT_ID ||
      nextNotes.some((note) => note.id === currentNoteId))
  ) {
    return currentNoteId;
  }

  return nextNotes[0]?.id ?? DEFAULT_DOCUMENT_ID;
}

export function useNotesDirectory(explicitNoteId: string | null) {
  const appData = useTearleadsRuntime();
  const {
    mergeSummary: mergeNoteSummary,
    ready,
    summaries: notes,
  } = useLocalDocumentSummaries({
    documentKind: DEFAULT_DOCUMENT_KIND,
    loadErrorMessage: "Notes: failed to load notes.",
    sortSummaries: compareNoteSummaries,
  });
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(
    explicitNoteId,
  );

  useEffect(() => {
    if (explicitNoteId) {
      setSelectedNoteId(explicitNoteId);
    }
  }, [explicitNoteId]);

  useEffect(() => {
    if (appData.infra.dbStatus !== "ready") {
      if (!explicitNoteId) {
        setSelectedNoteId(null);
      }
      return;
    }

    if (!ready) {
      return;
    }

    setSelectedNoteId((currentNoteId) =>
      resolveSelectedNoteId(currentNoteId, notes, explicitNoteId),
    );
  }, [appData.infra.dbStatus, explicitNoteId, notes, ready]);

  const createNote = useCallback(() => {
    const noteId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const nextNote: DocumentSummary = {
      createdAt,
      id: noteId,
      containerId: appData.state.containerId,
      documentKind: DEFAULT_DOCUMENT_KIND,
      documentId: null,
      title: getUntitledDocumentTitle(DEFAULT_DOCUMENT_KIND),
      updatedAt: createdAt,
    };

    mergeNoteSummary(nextNote);
    setSelectedNoteId(noteId);
  }, [appData.state.containerId, mergeNoteSummary]);

  return {
    createNote,
    notes,
    ready,
    selectedNoteId,
    selectNote: setSelectedNoteId,
  };
}
