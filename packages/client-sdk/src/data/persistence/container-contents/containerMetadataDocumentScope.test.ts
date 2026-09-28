import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentContainerProjectionPersistence as links } from "../containers/documentContainerProjectionPersistence";
import { loadLocalDocumentAccessEpoch } from "../documents/containerDocumentTombstoneHoldsPersistence";
import { sqlContainerContentsPersistence as metadata } from "./containerContentsPersistence";

const at = "2026-09-28T00:00:00.000Z";
const container = {
  effectiveAccessLevel: "write" as const,
  icon: null,
  id: "decoy-container",
  metadataDocumentId: "document-1",
  name: "Decoy",
  organizationId: "organization-1",
  parentId: null,
};
const record = {
  id: container.id,
  accessEpoch: Number.MAX_SAFE_INTEGER,
  documentId: "document-1",
  metadataUpdates: "",
  snapshotEndVersion: "",
};

test("metadata discovered first cannot raise an ordinary document's epoch floor or block placement", async () => {
  const { execSql, close } = await createTestExecSql("metadata-epoch-scope");
  try {
    await metadata.ensureSchema(execSql);
    await metadata.saveContainer(execSql, container, record);
    expect(await loadLocalDocumentAccessEpoch(execSql, "document-1")).toBe(0);
    await execSql(
      "INSERT INTO documents (app_kind, local_id, document_id, access_epoch, updated_at) VALUES (?, ?, ?, ?, ?)",
      ["documents", "local-document", "document-1", 2, at],
    );
    expect(await loadLocalDocumentAccessEpoch(execSql, "document-1")).toBe(2);
    await links.replaceDocumentLinksBatch(execSql, [
      {
        documentId: "document-1",
        containerIds: ["honest-container"],
        accessEpoch: 3,
      },
    ]);
    expect(await links.listLinkedContainerIds(execSql, "document-1")).toEqual([
      "honest-container",
    ]);
    await links.replaceDocumentLinksBatch(execSql, [
      {
        documentId: "document-1",
        containerIds: ["stale-container"],
        accessEpoch: 1,
      },
    ]);
    expect(await links.listLinkedContainerIds(execSql, "document-1")).toEqual([
      "honest-container",
    ]);
    expect(
      (await metadata.loadContainerMetadataRecord(execSql, container.id))
        ?.accessEpoch,
    ).toBe(Number.MAX_SAFE_INTEGER);
  } finally {
    await close();
  }
});

test.each(["create", "replace", "without-record", "record-only"] as const)(
  "metadata %s refuses a known ordinary document id atomically",
  async (mode) => {
    const { execSql, close } = await createTestExecSql(`metadata-id-${mode}`);
    try {
      await metadata.ensureSchema(execSql);
      await execSql(
        "INSERT INTO documents (app_kind, local_id, document_id, access_epoch, updated_at) VALUES (?, ?, ?, ?, ?)",
        ["documents", "local-document", "document-1", 2, at],
      );
      const existing = { ...container, metadataDocumentId: "honest-metadata" };
      const existingRecord = {
        ...record,
        documentId: "honest-metadata",
        accessEpoch: 4,
      };
      if (mode === "replace") {
        await metadata.saveContainer(execSql, existing, existingRecord);
      }
      await expect(
        metadata.saveContainer(
          execSql,
          mode === "record-only" ? existing : container,
          mode === "without-record" ? null : record,
        ),
      ).rejects.toThrow("Container metadata cannot name an ordinary document");
      if (mode === "replace") {
        const retained = await metadata.loadContainerMetadataState(
          execSql,
          container.id,
        );
        expect(retained?.container.metadataDocumentId).toBe("honest-metadata");
        expect(retained?.record?.documentId).toBe("honest-metadata");
        expect(retained?.record?.accessEpoch).toBe(4);
      } else {
        expect(await metadata.containerExists(execSql, container.id)).toBe(
          false,
        );
        expect(
          await metadata.loadContainerMetadataRecord(execSql, container.id),
        ).toBeNull();
      }
      expect(await loadLocalDocumentAccessEpoch(execSql, "document-1")).toBe(2);
    } finally {
      await close();
    }
  },
);
