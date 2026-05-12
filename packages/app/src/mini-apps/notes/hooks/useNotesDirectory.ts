import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentSummary } from "../../../data/documentSummary";
import { getUntitledDocumentTitle } from "../../../data/documents/documentKinds";
import { useAppData } from "../../../providers/data/AppDataProvider";
import { subscribeToPersistedDocuments } from "../../../stores/documents/DocumentsProvider";
import { DEFAULT_NOTE_ID } from "../../../stores/notes/NotesProvider";
import { defaultNotesPersistence } from "../../../workflows/notes";
import type { ActiveNoteSelection } from "../types";

function isNoteSummary(documentSummary: DocumentSummary): boolean {
  return (documentSummary.documentKind ?? "note") === "note";
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

function mergeNoteSummary(
  currentNotes: ReadonlyArray<DocumentSummary>,
  nextNote: DocumentSummary,
): DocumentSummary[] {
  if (!isNoteSummary(nextNote)) {
    return [...currentNotes];
  }

  const notesById = new Map(currentNotes.map((note) => [note.id, note]));
  notesById.set(nextNote.id, nextNote);

  return Array.from(notesById.values()).sort(compareNoteSummaries);
}

export function useNotesDirectory(
  explicitSelection: ActiveNoteSelection | null,
) {
  const appData = useAppData();
  const [notes, setNotes] = useState<ReadonlyArray<DocumentSummary>>([]);
  const [ready, setReady] = useState(false);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(
    explicitSelection?.noteId ?? null,
  );
  const explicitSelectionRef = useRef(explicitSelection);

  useEffect(() => {
    explicitSelectionRef.current = explicitSelection;
    if (explicitSelection) {
      setSelectedNoteId(explicitSelection.noteId);
    }
  }, [explicitSelection]);

  useEffect(() => {
    if (appData.dbStatus !== "ready") {
      setNotes([]);
      setReady(false);
      if (!explicitSelectionRef.current) {
        setSelectedNoteId(null);
      }
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        await defaultNotesPersistence.ensureSchema(appData.execSql);
        const nextNotes = (
          await defaultNotesPersistence.listNotes(appData.execSql)
        )
          .filter(isNoteSummary)
          .sort(compareNoteSummaries);

        if (cancelled) {
          return;
        }

        setNotes(nextNotes);
        setReady(true);
        setSelectedNoteId((currentNoteId) => {
          const latestExplicitSelection = explicitSelectionRef.current;
          if (latestExplicitSelection) {
            return latestExplicitSelection.noteId;
          }
          if (
            currentNoteId &&
            (currentNoteId === DEFAULT_NOTE_ID ||
              nextNotes.some((note) => note.id === currentNoteId))
          ) {
            return currentNoteId;
          }

          return nextNotes[0]?.id ?? DEFAULT_NOTE_ID;
        });
      } catch (error) {
        if (!cancelled) {
          appData.logError("Notes: failed to load notes.", error);
          setReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appData.dbStatus, appData.execSql, appData.logError]);

  useEffect(() => {
    return subscribeToPersistedDocuments(appData.domainScope, (document) => {
      if (!isNoteSummary(document)) {
        return;
      }

      setNotes((currentNotes) => mergeNoteSummary(currentNotes, document));
      setSelectedNoteId((currentNoteId) => currentNoteId ?? document.id);
    });
  }, [appData.domainScope]);

  const createNote = useCallback(() => {
    const noteId = crypto.randomUUID();
    const nextNote: DocumentSummary = {
      id: noteId,
      containerId: appData.containerId,
      documentKind: "note",
      documentId: null,
      title: getUntitledDocumentTitle("note"),
      updatedAt: new Date().toISOString(),
    };

    setNotes((currentNotes) => mergeNoteSummary(currentNotes, nextNote));
    setSelectedNoteId(noteId);
  }, [appData.containerId]);

  return {
    createNote,
    notes,
    ready,
    selectedNoteId,
    selectNote: setSelectedNoteId,
  };
}
