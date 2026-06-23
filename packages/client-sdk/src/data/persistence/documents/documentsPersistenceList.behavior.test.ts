import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  listDocumentsByContainerIds,
  sqlDocumentsPersistence,
} from "./documentsPersistence";

test("listDocumentsByContainerIds only returns notes for the requested containers", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-list-behavior-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);

    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "note-a",
      containerId: "container-a",
      documentId: "document-a",
      text: "Note A",
      loroSnapshot: "snapshot-a",
      accessEpoch: 1,
    });
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "note-b",
      containerId: "container-b",
      documentId: "document-b",
      text: "Note B",
      loroSnapshot: "snapshot-b",
      accessEpoch: 1,
    });
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "note-c",
      containerId: "container-c",
      documentId: "document-c",
      text: "Note C",
      loroSnapshot: "snapshot-c",
      accessEpoch: 1,
    });
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "org-profile",
      containerId: "container-a",
      documentId: "document-org-profile",
      documentKind: "organization_profile",
      text: "",
      title: "Organization Profile",
      loroSnapshot: "snapshot-org-profile",
      accessEpoch: 1,
    });

    await expect(
      listDocumentsByContainerIds(execSql, ["container-a", "container-c"]),
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

test("listDocumentsByContainerIdsOrDocumentIds returns directly and indirectly linked notes", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-list-behavior-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);

    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "direct-note",
      containerId: "shared-container",
      documentId: "direct-document",
      text: "Direct Note",
      loroSnapshot: "snapshot-direct",
      accessEpoch: 1,
    });
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "linked-note",
      containerId: "outside-container",
      documentId: "linked-document",
      text: "Linked Note",
      loroSnapshot: "snapshot-linked",
      accessEpoch: 1,
    });
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "unrelated-note",
      containerId: "outside-container",
      documentId: "unrelated-document",
      text: "Unrelated Note",
      loroSnapshot: "snapshot-unrelated",
      accessEpoch: 1,
    });
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "linked-org-profile",
      containerId: "shared-container",
      documentId: "linked-org-profile-document",
      documentKind: "organization_profile",
      text: "",
      title: "Organization Profile",
      loroSnapshot: "snapshot-linked-org-profile",
      accessEpoch: 1,
    });

    await expect(
      sqlDocumentsPersistence.listDocumentsByContainerIdsOrDocumentIds(
        execSql,
        {
          containerIds: ["shared-container"],
          documentIds: ["linked-document", "linked-org-profile-document"],
        },
      ),
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

test("listDocuments reads driver license titles and document kinds from projection metadata", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-list-behavior-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);

    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "drivers-license",
      containerId: "identity-container",
      documentId: "document-license",
      documentKind: "drivers_license",
      text: "",
      title: "Driver's License D1234567",
      loroSnapshot: "snapshot-license",
      accessEpoch: 1,
    });
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "org-profile",
      containerId: "identity-container",
      documentId: "document-org-profile",
      documentKind: "organization_profile",
      text: "",
      title: "Organization Profile",
      loroSnapshot: "snapshot-org-profile",
      accessEpoch: 1,
    });

    await expect(
      sqlDocumentsPersistence.listDocuments(execSql),
    ).resolves.toEqual([
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

test("listDocuments reads masked credit card titles and document kinds from projection metadata", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-list-behavior-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);

    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "credit-card",
      containerId: "billing-container",
      documentId: "document-card",
      documentKind: "credit_card",
      text: "",
      title: "Credit Card ending in 1234",
      loroSnapshot: "snapshot-card",
      accessEpoch: 1,
    });

    await expect(
      sqlDocumentsPersistence.listDocuments(execSql),
    ).resolves.toEqual([
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

test("upsertDiscoveredDocument uses the remote createdAt for a newly discovered document", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-list-behavior-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);

    await expect(
      sqlDocumentsPersistence.upsertDiscoveredDocument(execSql, {
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
      title: "Syncing document...",
      updatedAt: "2026-04-06T12:00:00.000Z",
    });

    await expect(
      sqlDocumentsPersistence.listDocuments(execSql),
    ).resolves.toEqual([
      {
        accessStateHash: null,
        id: "remote-document",
        containerId: "shared-container",
        documentKind: "note",
        documentId: "remote-document",
        title: "Syncing document...",
        updatedAt: "2026-04-06T12:00:00.000Z",
      },
    ]);
  } finally {
    close();
  }
});
