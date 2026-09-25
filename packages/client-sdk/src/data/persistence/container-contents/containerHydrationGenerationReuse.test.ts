import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlContainerContentsPersistence as persistence } from "./containerContentsPersistence";

test("a remove-restore-remove cycle cannot reuse an earlier hydration observation", async () => {
  const { execSql, close } = await createTestExecSql(
    "hydration-generation-reuse",
  );
  const container = {
    id: "folder",
    organizationId: "org",
    parentId: null,
    metadataDocumentId: "metadata",
    name: "Folder",
    icon: null,
  };
  const removal = {
    containerId: "folder",
    reason: "deleted" as const,
    updatedAt: "9999-01-01T00:00:00.000Z",
  };
  const restore = (
    fence: Awaited<
      ReturnType<typeof persistence.loadContainerHydrationTombstones>
    >[number],
  ) =>
    persistence.commitHydratedContainer(execSql, {
      container,
      expectedDormantRecord: null,
      expectedHydrationTombstone: fence,
      purgeDormantMetadata: false,
      record: {
        id: container.id,
        documentId: container.metadataDocumentId,
        accessEpoch: 1,
        accessStateHash: "access",
        contentKeyBundle: null,
        documentKekTargets: null,
        documentManifestBundle: null,
        lastCommitLsn: null,
        metadataUpdates: "",
        snapshotEndVersion: "",
      },
      remoteUpdatedAt: "2026-01-01T00:00:00.000Z",
      saveOptions: {},
    });
  try {
    await persistence.ensureSchema(execSql);
    await persistence.deleteContainers(execSql, [removal], {
      discoveryOnly: true,
    });
    const [first] = await persistence.loadContainerHydrationTombstones(execSql);
    if (!first) throw new Error("Missing first observation");
    expect((await restore(first)).committed).toBe(true);
    expect(await persistence.loadContainerHydrationTombstones(execSql)).toEqual(
      [],
    );
    await persistence.deleteContainers(execSql, [removal], {
      discoveryOnly: true,
    });
    expect((await restore(first)).committed).toBe(false);
    const [second] =
      await persistence.loadContainerHydrationTombstones(execSql);
    if (!second) throw new Error("Missing second observation");
    expect(second.generation).toBeGreaterThan(first.generation);
    expect((await restore(second)).committed).toBe(true);
    expect(await persistence.loadContainerHydrationTombstones(execSql)).toEqual(
      [],
    );
  } finally {
    await close();
  }
});
