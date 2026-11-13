import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { and, eq } from "drizzle-orm";
import { DOCUMENTS_APP_KIND } from "../../documents/documentConstants";
import { documents } from "../../sqlite/schema/documentRecordSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../sqlite/sqlSchema";
import {
  CONTAINER_METADATA_APP_KIND,
  sqlContainerContentsPersistence,
} from "../container-contents/containerContentsPersistence";
import { sqlDocumentsPersistence } from "./documentsPersistence";
import type { LocalAttachmentRecord } from "./types";

const LOCAL_ID = "shared-local-id";
const attachment: LocalAttachmentRecord = {
  blobId: "downloaded-blob",
  byteLength: 4,
  contentSha256: "0".repeat(64),
  detachedAt: null,
  localId: LOCAL_ID,
  mimeType: "text/plain",
  slotId: "preview",
  storageKey: "downloaded-copy",
};

async function saveMetadata(execSql: ExecSql) {
  await sqlContainerContentsPersistence.ensureSchema(execSql);
  await sqlContainerContentsPersistence.saveContainer(
    execSql,
    {
      effectiveAccessLevel: "write",
      icon: null,
      id: LOCAL_ID,
      metadataDocumentId: "metadata-document",
      name: "Container",
      organizationId: "organization",
      parentId: null,
    },
    {
      accessEpoch: 1,
      documentId: "metadata-document",
      id: LOCAL_ID,
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
  );
}

async function saveDocument(execSql: ExecSql) {
  await sqlDocumentsPersistence.saveDocument(execSql, {
    accessEpoch: 1,
    containerId: null,
    documentId: "remote-document",
    id: LOCAL_ID,
    snapshotEndVersion: "document-frontier",
    text: "",
  });
}

for (const metadataFirst of [true, false]) {
  test(`hydration's local-id-only guard observes insertion order: metadata first ${metadataFirst}`, async () => {
    const { execSql, close } = await createTestExecSql(
      "hydration-kind-identity",
    );
    try {
      await sqlDocumentsPersistence.ensureSchema(execSql);
      if (metadataFirst) await saveMetadata(execSql);
      await saveDocument(execSql);
      if (!metadataFirst) await saveMetadata(execSql);
      const { db } = getClientSQLitePersistenceRuntime(execSql);
      expect(
        await db
          .select({ appKind: documents.appKind })
          .from(documents)
          .where(eq(documents.localId, LOCAL_ID))
          .orderBy(documents.appKind),
      ).toEqual([
        { appKind: CONTAINER_METADATA_APP_KIND },
        { appKind: DOCUMENTS_APP_KIND },
      ]);
      // The ordinary loader selects the documents namespace even when the
      // metadata writer created the same local id first. No corrupt/raw rows.
      const loaded = await sqlDocumentsPersistence.loadDocument(
        execSql,
        LOCAL_ID,
      );
      expect(loaded?.snapshotEndVersion).toBe("document-frontier");
      expect(
        await db
          .select({ snapshot: documents.snapshotEndVersion })
          .from(documents)
          .where(
            and(
              eq(documents.appKind, DOCUMENTS_APP_KIND),
              eq(documents.localId, LOCAL_ID),
            ),
          ),
      ).toEqual([{ snapshot: "document-frontier" }]);
      // Characterization, not an endorsement of LIMIT 1 identity semantics.
      // A full-primary-key control changes the metadata-first result to true.
      const committed = await sqlDocumentsPersistence.saveHydratedAttachment(
        execSql,
        {
          attachment,
          expectedStorageKey: null,
          expectedSnapshotEndVersion: loaded?.snapshotEndVersion ?? null,
          stillCurrent: () => true,
        },
      );
      expect(committed).toBe(!metadataFirst);
      expect(
        await sqlDocumentsPersistence.listLocalAttachments(execSql, LOCAL_ID),
      ).toEqual(metadataFirst ? [] : [attachment]);
    } finally {
      close();
    }
  });
}

for (const expectedSnapshotEndVersion of [null, "", "document-frontier"]) {
  test(`missing document hydration compares the snapshot to ${JSON.stringify(expectedSnapshotEndVersion)}`, async () => {
    const { execSql, close } = await createTestExecSql(
      "hydration-missing-document",
    );
    try {
      await sqlDocumentsPersistence.ensureSchema(execSql);
      expect(
        await sqlDocumentsPersistence.loadDocument(execSql, LOCAL_ID),
      ).toBeNull();
      const committed = await sqlDocumentsPersistence.saveHydratedAttachment(
        execSql,
        {
          attachment,
          expectedStorageKey: null,
          expectedSnapshotEndVersion,
          stillCurrent: () => true,
        },
      );
      expect(committed).toBe(expectedSnapshotEndVersion === null);
      expect(
        await sqlDocumentsPersistence.listLocalAttachments(execSql, LOCAL_ID),
      ).toEqual(committed ? [attachment] : []);
    } finally {
      close();
    }
  });
}

for (const expectedSnapshotEndVersion of [null, "", "document-frontier"]) {
  test(`metadata-only hydration compares its frontier to ${JSON.stringify(expectedSnapshotEndVersion)}`, async () => {
    const { execSql, close } = await createTestExecSql(
      "hydration-metadata-only",
    );
    try {
      await sqlDocumentsPersistence.ensureSchema(execSql);
      await saveMetadata(execSql);
      expect(
        await sqlDocumentsPersistence.loadDocument(execSql, LOCAL_ID),
      ).toBeNull();
      const committed = await sqlDocumentsPersistence.saveHydratedAttachment(
        execSql,
        {
          attachment,
          expectedStorageKey: null,
          expectedSnapshotEndVersion,
          stillCurrent: () => true,
        },
      );
      expect(committed).toBe(expectedSnapshotEndVersion === "");
      expect(
        await sqlDocumentsPersistence.listLocalAttachments(execSql, LOCAL_ID),
      ).toEqual(committed ? [attachment] : []);
    } finally {
      close();
    }
  });
}
