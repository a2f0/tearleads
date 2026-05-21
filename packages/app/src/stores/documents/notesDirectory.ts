import {
  type DocumentSummary,
  getUntitledDocumentTitle,
} from "@tearleads/client-sdk/documents";
import { defaultDocumentsPersistence } from "@tearleads/client-sdk/workflows/documents";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppData } from "../../providers/data/AppDataProvider";
import {
  DEFAULT_DOCUMENT_ID,
  subscribeToPersistedDocuments,
} from "./DocumentsProvider";

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

export function usePersistedNotesDirectory(explicitNoteId: string | null) {
  const appData = useAppData();
  const [notes, setNotes] = useState<ReadonlyArray<DocumentSummary>>([]);
  const [ready, setReady] = useState(false);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(
    explicitNoteId,
  );
  const explicitNoteIdRef = useRef(explicitNoteId);

  useEffect(() => {
    explicitNoteIdRef.current = explicitNoteId;
    if (explicitNoteId) {
      setSelectedNoteId(explicitNoteId);
    }
  }, [explicitNoteId]);

  useEffect(() => {
    if (appData.dbStatus !== "ready") {
      setNotes([]);
      setReady(false);
      if (!explicitNoteIdRef.current) {
        setSelectedNoteId(null);
      }
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        await defaultDocumentsPersistence.ensureSchema(appData.execSql);
        const nextNotes = (
          await defaultDocumentsPersistence.listDocuments(appData.execSql)
        )
          .filter(isNoteSummary)
          .sort(compareNoteSummaries);

        if (cancelled) {
          return;
        }

        setNotes(nextNotes);
        setReady(true);
        setSelectedNoteId((currentNoteId) => {
          const latestExplicitNoteId = explicitNoteIdRef.current;
          if (latestExplicitNoteId) {
            return latestExplicitNoteId;
          }
          if (
            currentNoteId &&
            (currentNoteId === DEFAULT_DOCUMENT_ID ||
              nextNotes.some((note) => note.id === currentNoteId))
          ) {
            return currentNoteId;
          }

          return nextNotes[0]?.id ?? DEFAULT_DOCUMENT_ID;
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
