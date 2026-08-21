import { expect, test } from "bun:test";
import { defaultDocumentsPersistence } from "@symcrypt/client-sdk";
import { createTestExecSql } from "@symcrypt/test-utils";

// Desired-behavior successor to the PR-1 characterization test that pinned the
// Notes "Move to Trash" hard delete. Notes now moves a note into its org's Trash
// container (mini-apps/notes/hooks/useNotesDirectory.ts deleteNote -> the shared
// useDocumentTrash().moveToTrash -> documentLinks.moveDocumentToContainer), whose
// terminal persistence effect is a RELINK: the document row SURVIVES with its
// containerId changed to Trash — the opposite of the old hard purge, and
// recoverable from the Explorer's Trash.

const NOTES_CONTAINER_ID = "notes-container";
const TRASH_CONTAINER_ID = "trash-container";
const NOTE_ID = "note-1";

test("Notes 'Move to Trash' relinks the note into Trash instead of destroying it", async () => {
  const { close, execSql } = await createTestExecSql(
    "notes-move-to-trash-relink-behavior",
  );

  try {
    await defaultDocumentsPersistence.ensureSchema(execSql);
    await defaultDocumentsPersistence.saveDocument(execSql, {
      accessEpoch: 1,
      accessStateHash: null,
      containerId: NOTES_CONTAINER_ID,
      contentKeyBundle: null,
      documentId: null,
      documentKekTargets: null,
      documentKind: "note",
      documentManifestBundle: null,
      id: NOTE_ID,
      lastCommitLsn: null,
      snapshotEndVersion: "",
      text: "First note",
      title: "First note",
    });

    const existing = await defaultDocumentsPersistence.loadDocument(
      execSql,
      NOTE_ID,
    );
    if (!existing) {
      throw new Error("Note fixture was not persisted.");
    }

    // The terminal effect of the org-aware move-to-trash.
    await defaultDocumentsPersistence.relinkPersistedDocument(execSql, {
      accessEpoch: existing.accessEpoch,
      containerId: TRASH_CONTAINER_ID,
      documentId: existing.documentId,
      localId: NOTE_ID,
    });

    // The note row SURVIVES, now homed under Trash (not purged).
    expect(
      await defaultDocumentsPersistence.loadDocument(execSql, NOTE_ID),
    ).toEqual(expect.objectContaining({ containerId: TRASH_CONTAINER_ID }));

    // It has left the notes container and lives under Trash — where the notes
    // directory's isContainerTrashed filter hides it and the Explorer surfaces it.
    const documents =
      await defaultDocumentsPersistence.listDocumentsByContainerIdsOrDocumentIds(
        execSql,
        {
          containerIds: [NOTES_CONTAINER_ID, TRASH_CONTAINER_ID],
          documentIds: [],
        },
      );
    expect(documents.map((summary) => summary.containerId)).toEqual([
      TRASH_CONTAINER_ID,
    ]);
  } finally {
    close();
  }
});
