import {
  DEFAULT_DOCUMENT_KIND,
  type DocumentSummary,
  getUntitledDocumentTitle,
} from "@symcrypt/client-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSymCryptRuntime } from "../../../providers/sdk/SymCryptProvider";
import { DEFAULT_DOCUMENT_ID } from "../../../stores/documents/DocumentsProvider";
import { useDocumentSummaries } from "../../../stores/documents/useDocumentSummaries";
import { useDocumentTrash } from "../../shared/trash/useDocumentTrash";
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
  const appData = useSymCryptRuntime();
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

// Move-to-trash handler for the selected/any note: relink it into its org's
// Trash (org-aware, lazily provisioned) instead of hard-deleting, then keep the
// selection valid. Extracted from useNotesDirectory to keep that hook focused.
function useDeleteNote(input: {
  mergeNoteSummary: (summary: DocumentSummary) => void;
  moveToTrash: (document: DocumentSummary) => Promise<DocumentSummary | null>;
  notes: ReadonlyArray<DocumentSummary>;
  selectNoteRoute: SelectNoteRoute;
  selectedNoteId: string | null;
  setSelectedNoteId: (noteId: string) => void;
  visibleNotes: ReadonlyArray<DocumentSummary>;
}) {
  const appData = useSymCryptRuntime();
  const {
    mergeNoteSummary,
    moveToTrash,
    notes,
    selectNoteRoute,
    selectedNoteId,
    setSelectedNoteId,
    visibleNotes,
  } = input;
  return useCallback(
    async (noteId: string) => {
      const note = notes.find((entry) => entry.id === noteId);
      if (!note) {
        return;
      }

      try {
        // Move the note into its organization's Trash (org-aware, lazily creating
        // the Trash when needed) instead of hard-deleting it — matching Explorer.
        const movedNote = await moveToTrash(note);
        if (!movedNote) {
          return;
        }

        // Reflect the move locally so the note leaves the visible list immediately,
        // before the persisted-document subscription re-emits it under Trash.
        mergeNoteSummary(movedNote);
        if (selectedNoteId !== noteId) {
          return;
        }

        // The trashed note was selected; fall back to the next visible note, or the
        // default blank note when nothing else remains.
        const nextNoteId =
          visibleNotes.find((entry) => entry.id !== noteId)?.id ??
          DEFAULT_DOCUMENT_ID;
        setSelectedNoteId(nextNoteId);
        selectNoteRoute({ noteId: nextNoteId }, { replace: true });
      } catch (error) {
        appData.util.logError("Failed to move note to trash", error);
      }
    },
    [
      appData.util.logError,
      mergeNoteSummary,
      moveToTrash,
      notes,
      selectNoteRoute,
      selectedNoteId,
      setSelectedNoteId,
      visibleNotes,
    ],
  );
}

export function useNotesDirectory({
  autoSelectInitialNote,
  explicitSelection,
  selectNoteRoute,
}: NotesDirectoryInput) {
  const appData = useSymCryptRuntime();
  const explicitNoteId = explicitSelection?.noteId ?? null;
  const {
    mergeSummary: mergeNoteSummary,
    ready,
    summaries: notes,
  } = useDocumentSummaries({
    documentKind: DEFAULT_DOCUMENT_KIND,
    loadErrorMessage: "Notes: failed to load notes.",
    sortSummaries: compareNoteSummaries,
  });
  const { isContainerTrashed, moveToTrash } = useDocumentTrash();
  // Notes are listed app-wide by kind, so a note moved to Trash (here or via the
  // Explorer) still comes back from documents.list. Hide trashed notes so
  // "Move to Trash" removes the note from the directory, matching the Explorer.
  const visibleNotes = useMemo(
    () => notes.filter((note) => !isContainerTrashed(note.containerId)),
    [isContainerTrashed, notes],
  );
  const { selectedNoteId, setSelectedNoteId } = useSyncSelectedNote({
    autoSelectInitialNote,
    explicitNoteId,
    notes: visibleNotes,
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

  const deleteNote = useDeleteNote({
    mergeNoteSummary,
    moveToTrash,
    notes,
    selectNoteRoute,
    selectedNoteId,
    setSelectedNoteId,
    visibleNotes,
  });

  return {
    createNote,
    deleteNote,
    isContainerTrashed,
    notes: visibleNotes,
    ready,
    selectedNoteId,
    selectNote,
  };
}
