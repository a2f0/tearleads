import { expect, test } from "bun:test";
import { createTestExecSql } from "../../../test/helpers/createTestExecSql";
import {
  serializeCreditCardDocument,
  serializeDriverLicenseDocument,
} from "../../data/documents/documentKinds";
import {
  listNotesByContainerIds,
  sqlNotesPersistence,
} from "./notesPersistence";

test("concurrent note saves are serialized on a shared SQLite connection", async () => {
  const { close, execSql } = await createTestExecSql("notes-persistence-test");

  try {
    await sqlNotesPersistence.ensureSchema(execSql);

    await expect(
      Promise.all([
        sqlNotesPersistence.saveNote(execSql, {
          id: "default",
          containerId: "root-container",
          documentId: null,
          documentRecipientEnvelopes: null,
          text: "first",
          loroSnapshot: "snapshot-1",
          accessEpoch: 1,
        }),
        sqlNotesPersistence.saveNote(execSql, {
          id: "default",
          containerId: "root-container",
          documentId: null,
          documentRecipientEnvelopes: null,
          text: "second",
          loroSnapshot: "snapshot-2",
          accessEpoch: 2,
        }),
      ]),
    ).resolves.toEqual([expect.any(String), expect.any(String)]);

    await expect(
      sqlNotesPersistence.loadNote(execSql, "default"),
    ).resolves.toEqual({
      id: "default",
      containerId: "root-container",
      documentId: null,
      documentRecipientEnvelopes: null,
      lastCommitLsn: null,
      text: "second",
      loroSnapshot: "snapshot-2",
      accessEpoch: 2,
    });
  } finally {
    close();
  }
});

test("upsertDiscoveredNote reuses an existing local note bound to the remote document id", async () => {
  const { close, execSql } = await createTestExecSql("notes-persistence-test");

  try {
    await sqlNotesPersistence.ensureSchema(execSql);

    await sqlNotesPersistence.saveNote(
      execSql,
      {
        id: "local-note",
        containerId: "shared-container",
        documentId: "remote-document",
        documentRecipientEnvelopes: null,
        text: "Existing local note",
        loroSnapshot: "snapshot-1",
        accessEpoch: 2,
      },
      {
        updatedAt: "2026-04-05T00:00:00.000Z",
      },
    );

    await expect(
      sqlNotesPersistence.upsertDiscoveredNote(execSql, {
        accessEpoch: 3,
        containerId: "shared-container",
        createdAt: "2026-04-06T00:00:00.000Z",
        documentId: "remote-document",
        linkedContainerIds: ["shared-container"],
      }),
    ).resolves.toEqual({
      accessStateHash: null,
      id: "local-note",
      containerId: "shared-container",
      documentKind: "note",
      documentId: "remote-document",
      title: "Existing local note",
      updatedAt: "2026-04-05T00:00:00.000Z",
    });

    await expect(
      sqlNotesPersistence.loadNote(execSql, "local-note"),
    ).resolves.toEqual({
      id: "local-note",
      containerId: "shared-container",
      documentId: "remote-document",
      documentRecipientEnvelopes: null,
      lastCommitLsn: null,
      text: "Existing local note",
      loroSnapshot: "snapshot-1",
      accessEpoch: 3,
    });

    await expect(
      sqlNotesPersistence.loadNote(execSql, "remote-document"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("upsertDiscoveredNote preserves V2 document state for the same remote document id", async () => {
  const { close, execSql } = await createTestExecSql("notes-persistence-test");

  try {
    await sqlNotesPersistence.ensureSchema(execSql);

    await sqlNotesPersistence.saveNote(
      execSql,
      {
        accessEpoch: 2,
        containerId: "shared-container",
        documentId: "remote-document",
        documentRecipientEnvelopes: null,
        id: "local-note",
        lastCommitLsn: "0/10",
        loroSnapshot: "snapshot-1",
        text: "Existing local note",
        v2ContentKeyBundle: JSON.stringify({
          contentKeyEpoch: 1,
          linkSetManifestHash: "document-manifest-hash-1",
        }),
        v2DocumentKekTargets: JSON.stringify({
          documentKeyTargetHash: "document-target-hash-1",
        }),
        v2DocumentManifestBundle: JSON.stringify({
          manifestHash: "document-manifest-hash-1",
        }),
      },
      {
        updatedAt: "2026-04-05T00:00:00.000Z",
      },
    );

    await sqlNotesPersistence.upsertDiscoveredNote(execSql, {
      accessEpoch: 3,
      containerId: "shared-container",
      createdAt: "2026-04-06T00:00:00.000Z",
      documentId: "remote-document",
      linkedContainerIds: ["shared-container"],
    });

    await expect(
      sqlNotesPersistence.loadNote(execSql, "local-note"),
    ).resolves.toMatchObject({
      documentId: "remote-document",
      lastCommitLsn: "0/10",
      v2ContentKeyBundle: JSON.stringify({
        contentKeyEpoch: 1,
        linkSetManifestHash: "document-manifest-hash-1",
      }),
      v2DocumentKekTargets: JSON.stringify({
        documentKeyTargetHash: "document-target-hash-1",
      }),
      v2DocumentManifestBundle: JSON.stringify({
        manifestHash: "document-manifest-hash-1",
      }),
    });
  } finally {
    close();
  }
});

test("relinkPersistedNote clears V2 document state for a different remote document id", async () => {
  const { close, execSql } = await createTestExecSql("notes-persistence-test");

  try {
    await sqlNotesPersistence.ensureSchema(execSql);

    await sqlNotesPersistence.saveNote(execSql, {
      accessEpoch: 2,
      containerId: "container-a",
      documentId: "remote-document-a",
      documentRecipientEnvelopes: null,
      id: "local-note",
      lastCommitLsn: "0/10",
      loroSnapshot: "snapshot-1",
      text: "Existing local note",
      v2ContentKeyBundle: JSON.stringify({
        contentKeyEpoch: 1,
      }),
      v2DocumentKekTargets: JSON.stringify({
        documentKeyTargetHash: "document-target-hash-1",
      }),
      v2DocumentManifestBundle: JSON.stringify({
        manifestHash: "document-manifest-hash-1",
      }),
    });

    await sqlNotesPersistence.relinkPersistedNote(execSql, {
      accessEpoch: 3,
      accessStateHash: "access-state-hash-2",
      containerId: "container-b",
      documentId: "remote-document-b",
      noteId: "local-note",
    });

    const note = await sqlNotesPersistence.loadNote(execSql, "local-note");

    expect(note).toMatchObject({
      accessEpoch: 3,
      containerId: "container-b",
      documentId: "remote-document-b",
      lastCommitLsn: null,
    });
    expect(note?.v2ContentKeyBundle).toBeUndefined();
    expect(note?.v2DocumentKekTargets).toBeUndefined();
    expect(note?.v2DocumentManifestBundle).toBeUndefined();
  } finally {
    close();
  }
});

test("upsertDiscoveredNote preserves the active local container when another linked container rediscovers the document", async () => {
  const { close, execSql } = await createTestExecSql("notes-persistence-test");

  try {
    await sqlNotesPersistence.ensureSchema(execSql);

    await sqlNotesPersistence.saveNote(
      execSql,
      {
        id: "local-note",
        containerId: "container-a",
        documentId: "remote-document",
        documentRecipientEnvelopes: null,
        text: "Existing local note",
        loroSnapshot: "snapshot-1",
        accessEpoch: 2,
      },
      {
        updatedAt: "2026-04-05T01:00:00.000Z",
      },
    );

    await expect(
      sqlNotesPersistence.upsertDiscoveredNote(execSql, {
        accessEpoch: 3,
        containerId: "container-b",
        createdAt: "2026-04-06T01:00:00.000Z",
        documentId: "remote-document",
        linkedContainerIds: ["container-a", "container-b"],
      }),
    ).resolves.toEqual({
      accessStateHash: null,
      id: "local-note",
      containerId: "container-a",
      documentKind: "note",
      documentId: "remote-document",
      title: "Existing local note",
      updatedAt: "2026-04-05T01:00:00.000Z",
    });

    await expect(
      sqlNotesPersistence.loadNote(execSql, "local-note"),
    ).resolves.toEqual({
      id: "local-note",
      containerId: "container-a",
      documentId: "remote-document",
      documentRecipientEnvelopes: null,
      lastCommitLsn: null,
      text: "Existing local note",
      loroSnapshot: "snapshot-1",
      accessEpoch: 3,
    });
  } finally {
    close();
  }
});

test("relinkPersistedNote updates the stored container and clears stale bundles on epoch change", async () => {
  const { close, execSql } = await createTestExecSql("notes-persistence-test");

  try {
    await sqlNotesPersistence.ensureSchema(execSql);

    await sqlNotesPersistence.saveNote(
      execSql,
      {
        id: "local-note",
        containerId: "container-a",
        documentId: "remote-document",
        documentRecipientEnvelopes: '{"wrapped":true}',
        text: "Existing local note",
        loroSnapshot: "snapshot-1",
        accessEpoch: 2,
      },
      {
        updatedAt: "2026-04-05T02:00:00.000Z",
      },
    );

    await expect(
      sqlNotesPersistence.relinkPersistedNote(execSql, {
        accessEpoch: 3,
        containerId: "container-b",
        documentId: "remote-document",
        noteId: "local-note",
      }),
    ).resolves.toEqual({
      accessStateHash: null,
      id: "local-note",
      containerId: "container-b",
      documentKind: "note",
      documentId: "remote-document",
      title: "Existing local note",
      updatedAt: "2026-04-05T02:00:00.000Z",
    });

    await expect(
      sqlNotesPersistence.loadNote(execSql, "local-note"),
    ).resolves.toEqual({
      id: "local-note",
      containerId: "container-b",
      documentId: "remote-document",
      documentRecipientEnvelopes: null,
      lastCommitLsn: null,
      text: "Existing local note",
      loroSnapshot: "snapshot-1",
      accessEpoch: 3,
    });
  } finally {
    close();
  }
});

test("listNotesByContainerIds only returns notes for the requested containers", async () => {
  const { close, execSql } = await createTestExecSql("notes-persistence-test");

  try {
    await sqlNotesPersistence.ensureSchema(execSql);

    await sqlNotesPersistence.saveNote(execSql, {
      id: "note-a",
      containerId: "container-a",
      documentId: "document-a",
      documentRecipientEnvelopes: null,
      text: "Note A",
      loroSnapshot: "snapshot-a",
      accessEpoch: 1,
    });
    await sqlNotesPersistence.saveNote(execSql, {
      id: "note-b",
      containerId: "container-b",
      documentId: "document-b",
      documentRecipientEnvelopes: null,
      text: "Note B",
      loroSnapshot: "snapshot-b",
      accessEpoch: 1,
    });
    await sqlNotesPersistence.saveNote(execSql, {
      id: "note-c",
      containerId: "container-c",
      documentId: "document-c",
      documentRecipientEnvelopes: null,
      text: "Note C",
      loroSnapshot: "snapshot-c",
      accessEpoch: 1,
    });

    await expect(
      listNotesByContainerIds(execSql, ["container-a", "container-c"]),
    ).resolves.toEqual([
      {
        accessStateHash: null,
        id: "note-c",
        containerId: "container-c",
        documentKind: "note",
        documentId: "document-c",
        title: "Note C",
        updatedAt: expect.any(String),
      },
      {
        accessStateHash: null,
        id: "note-a",
        containerId: "container-a",
        documentKind: "note",
        documentId: "document-a",
        title: "Note A",
        updatedAt: expect.any(String),
      },
    ]);
  } finally {
    close();
  }
});

test("listNotesByContainerIdsOrDocumentIds returns directly and indirectly linked notes", async () => {
  const { close, execSql } = await createTestExecSql("notes-persistence-test");

  try {
    await sqlNotesPersistence.ensureSchema(execSql);

    await sqlNotesPersistence.saveNote(execSql, {
      id: "direct-note",
      containerId: "shared-container",
      documentId: "direct-document",
      documentRecipientEnvelopes: null,
      text: "Direct Note",
      loroSnapshot: "snapshot-direct",
      accessEpoch: 1,
    });
    await sqlNotesPersistence.saveNote(execSql, {
      id: "linked-note",
      containerId: "outside-container",
      documentId: "linked-document",
      documentRecipientEnvelopes: null,
      text: "Linked Note",
      loroSnapshot: "snapshot-linked",
      accessEpoch: 1,
    });
    await sqlNotesPersistence.saveNote(execSql, {
      id: "unrelated-note",
      containerId: "outside-container",
      documentId: "unrelated-document",
      documentRecipientEnvelopes: null,
      text: "Unrelated Note",
      loroSnapshot: "snapshot-unrelated",
      accessEpoch: 1,
    });

    await expect(
      sqlNotesPersistence.listNotesByContainerIdsOrDocumentIds(execSql, {
        containerIds: ["shared-container"],
        documentIds: ["linked-document"],
      }),
    ).resolves.toEqual([
      {
        accessStateHash: null,
        id: "linked-note",
        containerId: "outside-container",
        documentKind: "note",
        documentId: "linked-document",
        title: "Linked Note",
        updatedAt: expect.any(String),
      },
      {
        accessStateHash: null,
        id: "direct-note",
        containerId: "shared-container",
        documentKind: "note",
        documentId: "direct-document",
        title: "Direct Note",
        updatedAt: expect.any(String),
      },
    ]);
  } finally {
    close();
  }
});

test("listNotes derives driver license titles and document kinds from structured text", async () => {
  const { close, execSql } = await createTestExecSql("notes-persistence-test");

  try {
    await sqlNotesPersistence.ensureSchema(execSql);

    await sqlNotesPersistence.saveNote(execSql, {
      id: "drivers-license",
      containerId: "identity-container",
      documentId: "document-license",
      documentRecipientEnvelopes: null,
      text: serializeDriverLicenseDocument({
        expirationDate: "2030-05-01",
        licenseId: "D1234567",
      }),
      loroSnapshot: "snapshot-license",
      accessEpoch: 1,
    });

    await expect(sqlNotesPersistence.listNotes(execSql)).resolves.toEqual([
      {
        accessStateHash: null,
        id: "drivers-license",
        containerId: "identity-container",
        documentKind: "drivers_license",
        documentId: "document-license",
        title: "Driver's License D1234567",
        updatedAt: expect.any(String),
      },
    ]);
  } finally {
    close();
  }
});

test("listNotes derives masked credit card titles and document kinds from structured text", async () => {
  const { close, execSql } = await createTestExecSql("notes-persistence-test");

  try {
    await sqlNotesPersistence.ensureSchema(execSql);

    await sqlNotesPersistence.saveNote(execSql, {
      id: "credit-card",
      containerId: "billing-container",
      documentId: "document-card",
      documentRecipientEnvelopes: null,
      text: serializeCreditCardDocument({
        cardNumber: "4111 1111 1111 1234",
        cvvCode: "123",
        expirationDate: "2030-05",
        nameOnCard: "Ada Lovelace",
      }),
      loroSnapshot: "snapshot-card",
      accessEpoch: 1,
    });

    await expect(sqlNotesPersistence.listNotes(execSql)).resolves.toEqual([
      {
        accessStateHash: null,
        id: "credit-card",
        containerId: "billing-container",
        documentKind: "credit_card",
        documentId: "document-card",
        title: "Credit Card ending in 1234",
        updatedAt: expect.any(String),
      },
    ]);
  } finally {
    close();
  }
});

test("upsertDiscoveredNote uses the remote createdAt for a newly discovered document", async () => {
  const { close, execSql } = await createTestExecSql("notes-persistence-test");

  try {
    await sqlNotesPersistence.ensureSchema(execSql);

    await expect(
      sqlNotesPersistence.upsertDiscoveredNote(execSql, {
        accessEpoch: 1,
        containerId: "shared-container",
        createdAt: "2026-04-06T12:00:00.000Z",
        documentId: "remote-document",
        linkedContainerIds: ["shared-container"],
      }),
    ).resolves.toEqual({
      accessStateHash: null,
      id: "remote-document",
      containerId: "shared-container",
      documentKind: "note",
      documentId: "remote-document",
      title: "Untitled note",
      updatedAt: "2026-04-06T12:00:00.000Z",
    });

    await expect(sqlNotesPersistence.listNotes(execSql)).resolves.toEqual([
      {
        accessStateHash: null,
        id: "remote-document",
        containerId: "shared-container",
        documentKind: "note",
        documentId: "remote-document",
        title: "Untitled note",
        updatedAt: "2026-04-06T12:00:00.000Z",
      },
    ]);
  } finally {
    close();
  }
});
