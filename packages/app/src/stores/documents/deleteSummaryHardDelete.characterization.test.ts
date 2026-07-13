import { expect, test } from "bun:test";
import {
  defaultDocumentsPersistence,
  deletePersistedDocument,
} from "@tearleads/client-sdk";
import { createTestExecSql } from "@tearleads/test-utils";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../document-types/projectors";

// CHARACTERIZATION TEST (PR 1 of 2) — pins the CURRENT, broken behavior of the
// Notes mini-app's "Move to Trash" context-menu action. It passes on today's code
// and documents what actually happens; PR 2 will change the behavior and replace
// these expectations with the desired ones.
//
// The Notes "Move to Trash" item (mini-apps/notes/context-menu/NotesContextMenu.tsx,
// label NOTES_LABELS.deleteNoteAction === "Move to Trash") calls:
//   deleteNote (mini-apps/notes/hooks/useNotesDirectory.ts:174)
//     -> deleteNoteSummary === useDocumentSummaries().deleteSummary
//        (stores/documents/useDocumentSummaries.ts:94-112)
//        -> tearleads.documents.delete(localId)
//           (packages/client-sdk/src/client/documents.ts:96-110)
//           -> deletePersistedDocument({ documentProjectors, execSql, localId, persistence })
//              (packages/client-sdk/src/workflows/documents/persistence.ts:367-391)
//
// deletePersistedDocument is the exact and only mutation that path performs, so
// driving it directly faithfully reproduces the Notes delete. It is a HARD PURGE:
// it removes every local row for the document keyed on localId. It resolves no
// Trash system container, performs no relink, and consults no organization — for
// notes there is no org-aware move-to-trash at all.
//
// Contrast with the working reference (Explorer) and with Contacts, both of which
// RELINK the document into a Trash container (defaultDocumentsPersistence
// .relinkPersistedDocument): there the row SURVIVES with containerId === the Trash
// container. Notes does not: the note simply disappears, contradicting its label.

const NOTES_CONTAINER_ID = "notes-container";
const TRASH_CONTAINER_ID = "trash-container";
const NOTE_ID = "note-1";

test("characterization: Notes 'Move to Trash' hard-deletes the note and never relinks it into Trash", async () => {
  const { close, execSql } = await createTestExecSql(
    "notes-delete-hard-purge-characterization",
  );

  try {
    await defaultDocumentsPersistence.ensureSchema(execSql);
    await defaultDocumentsPersistence.saveDocument(execSql, {
      accessEpoch: 1,
      accessStateHash: null,
      containerId: NOTES_CONTAINER_ID,
      contentKeyBundle: null,
      // Never-synced (device-first) note, so the purge is terminal and there is no
      // remote copy that could re-hydrate the row.
      documentId: null,
      documentKekTargets: null,
      documentKind: "note",
      documentManifestBundle: null,
      id: NOTE_ID,
      lastCommitLsn: null,
      loroSnapshot: "",
      text: "First note",
      title: "First note",
    });

    // Precondition: the note lives in its notes container.
    expect(
      await defaultDocumentsPersistence.loadDocument(execSql, NOTE_ID),
    ).toEqual(expect.objectContaining({ containerId: NOTES_CONTAINER_ID }));

    // Act: the exact mutation the Notes "Move to Trash" action performs.
    await deletePersistedDocument({
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
      execSql,
      localId: NOTE_ID,
      persistence: defaultDocumentsPersistence,
    });

    // Broken behavior #1: the note row is destroyed outright (hard purge), not
    // relinked. If Notes were org-aware like Explorer, the row would survive with
    // containerId === the org's Trash container.
    expect(
      await defaultDocumentsPersistence.loadDocument(execSql, NOTE_ID),
    ).toBeNull();

    // Broken behavior #2: the note is now present under NO container — in
    // particular it never lands in a Trash container. It is gone, not trashed.
    expect(
      await defaultDocumentsPersistence.listDocumentsByContainerIdsOrDocumentIds(
        execSql,
        {
          containerIds: [NOTES_CONTAINER_ID, TRASH_CONTAINER_ID],
          documentIds: [],
        },
      ),
    ).toEqual([]);
  } finally {
    close();
  }
});
