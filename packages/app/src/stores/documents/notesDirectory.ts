import {
  DEFAULT_DOCUMENT_KIND,
  type DocumentSummary,
  getUntitledDocumentTitle,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import { DEFAULT_DOCUMENT_ID } from "./DocumentsProvider";

function isNoteSummary(documentSummary: DocumentSummary): boolean {
  return (
    (documentSummary.documentKind ?? DEFAULT_DOCUMENT_KIND) ===
    DEFAULT_DOCUMENT_KIND
  );
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

export function usePersistedNotesDirectory(explicitNoteId: string | null) {
  const appData = useTearleadsRuntime();
  const tearleads = useTearleads();
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
    if (appData.infra.dbStatus !== "ready") {
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
        const persistedNotes =
          (await tearleads.documents.listLocalSummaries({
            documentKind: DEFAULT_DOCUMENT_KIND,
          })) ?? [];
        const nextNotes = Array.from(persistedNotes).sort(compareNoteSummaries);

        if (cancelled) {
          return;
        }

        setNotes(nextNotes);
        setReady(true);
        setSelectedNoteId((currentNoteId) => {
          return resolveSelectedNoteId(
            currentNoteId,
            nextNotes,
            explicitNoteIdRef.current,
          );
        });
      } catch (error) {
        if (!cancelled) {
          appData.util.logError("Notes: failed to load notes.", error);
          setReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    appData.infra.dbStatus,
    appData.state.domainScope,
    appData.util.logError,
    tearleads,
  ]);

  useEffect(() => {
    return tearleads.documents.subscribeToLocalSummaries(
      (document) => {
        if (!isNoteSummary(document)) {
          return;
        }

        setNotes((currentNotes) => mergeNoteSummary(currentNotes, document));
        setSelectedNoteId((currentNoteId) => currentNoteId ?? document.id);
      },
      { containerId: appData.state.containerId },
    );
  }, [appData.state.containerId, appData.state.domainScope, tearleads]);

  const createNote = useCallback(() => {
    const noteId = crypto.randomUUID();
    const nextNote: DocumentSummary = {
      id: noteId,
      containerId: appData.state.containerId,
      documentKind: DEFAULT_DOCUMENT_KIND,
      documentId: null,
      title: getUntitledDocumentTitle(DEFAULT_DOCUMENT_KIND),
      updatedAt: new Date().toISOString(),
    };

    setNotes((currentNotes) => mergeNoteSummary(currentNotes, nextNote));
    setSelectedNoteId(noteId);
  }, [appData.state.containerId]);

  return {
    createNote,
    notes,
    ready,
    selectedNoteId,
    selectNote: setSelectedNoteId,
  };
}
