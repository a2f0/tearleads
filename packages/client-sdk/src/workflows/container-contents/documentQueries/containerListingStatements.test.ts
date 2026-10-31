import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { countingExecSql } from "../../../../test/helpers/statementCounting";
import { sqlContainerContentsPersistence as containers } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { selectContainerMetadataRecord } from "../../../data/persistence/container-contents/containerMetadataRows";
import { loadContainers } from "../../../data/persistence/container-contents/containerPersistence";
import { sqlDocumentMoveIntentPersistence as intents } from "../../../data/persistence/container-contents/documentMoveIntentPersistence";
import { saveTestSyncedContainer } from "./documentQueries.testFixtures";

test("the container listing reads every container and its metadata in one statement", async () => {
  const { close, execSql } = await createTestExecSql("container-listing-count");
  try {
    await containers.ensureSchema(execSql);
    for (let index = 0; index < 24; index += 1)
      await saveTestSyncedContainer({
        execSql,
        id: `folder-${String(index).padStart(2, "0")}`,
        metadataUpdates: index % 2 === 0 ? `snapshot-${index}` : "",
        name: index % 3 === 0 ? `Folder ${index}` : `folder ${index}`,
        organizationId: "org",
        parentId: index === 0 ? null : "folder-00",
        timestamp: "2026-01-01T00:00:00.000Z",
      });
    // A container whose metadata row is gone lists with a null record.
    await execSql(
      "DELETE FROM documents WHERE app_kind = 'container-metadata' AND local_id = ?",
      ["folder-05"],
    );
    const counted = countingExecSql(execSql);
    let listed: Awaited<ReturnType<typeof containers.loadContainers>> = [];
    // One joined read (was 1 + N: 25 at 24 containers).
    expect(
      await counted.count(async () => {
        listed = await containers.loadContainers(counted.execSql);
      }),
    ).toBe(1);
    const reference = await Promise.all(
      (await loadContainers(execSql)).map(async (container) => ({
        container,
        record: await selectContainerMetadataRecord(execSql, container.id),
      })),
    );
    expect(listed).toEqual(reference);
    expect(listed).toHaveLength(24);
    expect(
      listed.find((entry) => entry.container.id === "folder-05")?.record,
    ).toBeNull();
  } finally {
    close();
  }
});

test("pending placement intents load their link targets in one read", async () => {
  const { close, execSql } = await createTestExecSql("move-intent-link-count");
  try {
    for (let index = 0; index < 17; index += 1) {
      const base = {
        documentId: `remote-${index}`,
        localId: `local-${index}`,
        sourceContainerId: "source",
      };
      for (const targetContainerId of ["one", "two"])
        await intents.enqueueLinkIntent(execSql, {
          ...base,
          targetContainerId,
        });
      if (index % 4 === 0)
        await intents.enqueueUnlinkIntent(execSql, {
          ...base,
          removedContainerId: "one",
          targetContainerId: "source",
        });
    }
    const counted = countingExecSql(execSql);
    await intents.listPendingMoveIntents(counted.execSql);
    let listed: Awaited<ReturnType<typeof intents.listPendingMoveIntents>> = [];
    // BEGIN, the intent read, one link-target read, COMMIT (was 3 + N: 20 at
    // 17 intents).
    expect(
      await counted.count(async () => {
        listed = await intents.listPendingMoveIntents(counted.execSql);
      }),
    ).toBe(4);
    expect(listed).toHaveLength(17);
    expect(listed[0]).toMatchObject({
      additionalLinkContainerIds: ["two"],
      removedLinkContainerIds: ["one"],
    });
    expect(listed[1]).toMatchObject({
      additionalLinkContainerIds: ["one", "two"],
    });
    expect(listed[1]?.removedLinkContainerIds).toBeUndefined();
  } finally {
    close();
  }
});
