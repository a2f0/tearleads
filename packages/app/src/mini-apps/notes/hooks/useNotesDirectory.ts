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

export function useNotesDirectory({
  explicitSelection,
  selectNoteRoute,
}: NotesDirectoryInput) {
  const appData = useTearleadsRuntime();
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
    explicitNoteId,
    notes,
    ready,
    selectedNoteId,
    selectNoteRoute,
  ]);

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

  return {
    createNote,
    notes,
    ready,
    selectedNoteId,
    selectNote,
  };
}
