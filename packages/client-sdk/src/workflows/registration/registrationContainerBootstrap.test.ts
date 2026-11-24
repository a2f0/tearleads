import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  exportAllUpdates,
  type LoroMap,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import { persistMissingContainerBootstrap } from "./registrationContainerBootstrap";

const container = {
  effectiveAccessLevel: "admin" as const,
  icon: null,
  id: "container-without-record",
  metadataDocumentId: "metadata-seeded",
  name: "Seeded",
  organizationId: "organization-1",
  parentId: null,
};

test("a container held without metadata keeps the cursor its committed seed stands for", async () => {
  const { close, execSql } = await createTestExecSql(
    "registration-bootstrap-held-container",
  );
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    // Held locally, but no metadata record is stored for it yet.
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      container,
      null,
    );
    const doc = await createDocument("held-container-seed");
    (doc.getMap("container") as LoroMap).set("name", "Seeded");
    doc.commit();

    await expect(
      persistMissingContainerBootstrap(
        execSql,
        container,
        {
          accessEpoch: 1,
          accessStateHash: "access-seeded",
          documentId: container.metadataDocumentId,
          id: container.id,
          metadataUpdates: bytesToBase64(exportAllUpdates(doc)),
          snapshotEndVersion: "",
        },
        { committedSeedUpdateId: "seed-update" },
      ),
    ).resolves.toBe(true);
    expect(
      await execSql(
        `SELECT through_update_count AS "count", through_update_id AS "updateId"
         FROM document_sync_progress WHERE local_id = ?`,
        [container.id],
      ),
    ).toEqual([{ count: 1, updateId: "seed-update" }]);
  } finally {
    close();
  }
});
