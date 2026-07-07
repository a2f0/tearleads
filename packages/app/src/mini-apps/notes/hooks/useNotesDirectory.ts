import {
  DEFAULT_DOCUMENT_KIND,
  type DocumentSummary,
  getUntitledDocumentTitle,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useState } from "react";
import { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import { DEFAULT_DOCUMENT_ID } from "../../../stores/documents/DocumentsProvider";
import { useDocumentSummaries } from "../../../stores/documents/useDocumentSummaries";
import type { ActiveNoteSelection } from "../types";

type SelectNoteRoute = (
  selection: ActiveNoteSelection,
  options?: { replace?: boolean | undefined },
) => void;

interface NotesDirectoryInput {
  autoSelectInitialNote: boolean;
  explicitSelection: ActiveNoteSelection | null;
  selectNoteRoute: SelectNoteRoute;
}

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

// Keeps the in-memory note selection valid as the database comes online and the
// note list changes (e.g. a note is created or deleted out from under it).
function useSyncSelectedNote(input: {
  autoSelectInitialNote: boolean;
  explicitNoteId: string | null;
  notes: ReadonlyArray<DocumentSummary>;
  ready: boolean;
  selectNoteRoute: SelectNoteRoute;
}) {
  const appData = useTearleadsRuntime();
  const {
    autoSelectInitialNote,
    explicitNoteId,
    notes,
    ready,
    selectNoteRoute,
  } = input;
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(
    explicitNoteId,
  );

  useEffect(() => {
    if (explicitNoteId) {
      setSelectedNoteId(explicitNoteId);
    } else if (!autoSelectInitialNote) {
      setSelectedNoteId(null);
    }
  }, [autoSelectInitialNote, explicitNoteId]);

  useEffect(() => {
    if (!autoSelectInitialNote && !explicitNoteId) {
      return;
    }

    if (appData.infra.dbStatus !== "ready") {
      if (!explicitNoteId && selectedNoteId !== null) {
        setSelectedNoteId(null);
      }
      return;
    }

    if (!ready) {
      return;
    }

    const nextSelectedNoteId = resolveSelectedNoteId(
      selectedNoteId,
      notes,
      explicitNoteId,
    );
    if (nextSelectedNoteId === selectedNoteId) {
      return;
    }

    setSelectedNoteId(nextSelectedNoteId);
    if (!explicitNoteId) {
      selectNoteRoute({ noteId: nextSelectedNoteId }, { replace: true });
    }
  }, [
    appData.infra.dbStatus,
    autoSelectInitialNote,
    explicitNoteId,
    notes,
    ready,
    selectedNoteId,
    selectNoteRoute,
  ]);

  return { selectedNoteId, setSelectedNoteId };
}

export function useNotesDirectory({
  autoSelectInitialNote,
  explicitSelection,
  selectNoteRoute,
}: NotesDirectoryInput) {
  const appData = useTearleadsRuntime();
  const explicitNoteId = explicitSelection?.noteId ?? null;
  const {
    deleteSummary: deleteNoteSummary,
    mergeSummary: mergeNoteSummary,
    ready,
    summaries: notes,
  } = useDocumentSummaries({
    documentKind: DEFAULT_DOCUMENT_KIND,
    loadErrorMessage: "Notes: failed to load notes.",
    sortSummaries: compareNoteSummaries,
  });
  const { selectedNoteId, setSelectedNoteId } = useSyncSelectedNote({
    autoSelectInitialNote,
    explicitNoteId,
    notes,
    ready,
    selectNoteRoute,
  });

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
    selectNoteRoute({ noteId });
  }, [appData.state.containerId, mergeNoteSummary, selectNoteRoute]);

  const selectNote = useCallback(
    (noteId: string) => {
      setSelectedNoteId(noteId);
      selectNoteRoute({ noteId });
    },
    [selectNoteRoute],
  );

  const deleteNote = useCallback(
    async (noteId: string) => {
      const deleted = await deleteNoteSummary(noteId);
      if (!deleted || selectedNoteId !== noteId) {
        return;
      }

      // The deleted note was selected; fall back to the next note in the list,
      // or the default blank note when nothing else remains.
      const nextNoteId =
        notes.find((note) => note.id !== noteId)?.id ?? DEFAULT_DOCUMENT_ID;
      setSelectedNoteId(nextNoteId);
      selectNoteRoute({ noteId: nextNoteId }, { replace: true });
    },
    [deleteNoteSummary, notes, selectedNoteId, selectNoteRoute],
  );

  return {
    createNote,
    deleteNote,
    notes,
    ready,
    selectedNoteId,
    selectNote,
  };
}
