import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { storeContainerRows } from "../../../../test/helpers/data/storedContainerRows";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import {
  ContainerSyncWatermarkRepository,
  containerContentsSyncLane,
  containerParentSyncLane,
  deleteContainerWatermarksInTransaction,
} from "./containerSyncWatermarkPersistence";

test("container sync watermarks are persisted independently per lane", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-sync-watermark-persistence-test",
  );

  const watermarks = new ContainerSyncWatermarkRepository(execSql);
  try {
    await storeContainerRows(execSql, ["parent-container"]);
    await expect(
      watermarks.loadWatermark(containerParentSyncLane(null)),
    ).resolves.toBeNull();

    await watermarks.saveWatermark(containerParentSyncLane(null), {
      id: "root-container",
      updatedAt: "2026-05-05T00:00:00.000Z",
    });
    await watermarks.saveWatermark(
      containerParentSyncLane("parent-container"),
      {
        id: "child-container",
        updatedAt: "2026-05-05T00:05:00.000Z",
      },
    );
    await watermarks.saveWatermark(containerParentSyncLane("root"), {
      id: "child-of-root-named-container",
      updatedAt: "2026-05-05T00:07:00.000Z",
    });
    await watermarks.saveWatermark(
      containerContentsSyncLane("parent-container"),
      {
        id: "document-1",
        updatedAt: "2026-05-05T00:10:00.000Z",
      },
    );

    await expect(
      watermarks.loadWatermark(containerParentSyncLane(null)),
    ).resolves.toEqual({
      id: "root-container",
      updatedAt: "2026-05-05T00:00:00.000Z",
    });
    await expect(
      watermarks
        .loadWatermarkRecords([containerParentSyncLane(null)])
        .then(([record]) => record),
    ).resolves.toMatchObject({
      laneId: "root",
      laneKind: "container_parent",
      updatedAt: expect.any(String),
      watermark: {
        id: "root-container",
        updatedAt: "2026-05-05T00:00:00.000Z",
      },
    });
    await expect(
      watermarks.loadWatermarkRecords([
        containerParentSyncLane(null),
        containerParentSyncLane("missing-parent"),
        containerContentsSyncLane("parent-container"),
      ]),
    ).resolves.toEqual([
      expect.objectContaining({
        laneId: "root",
        laneKind: "container_parent",
        watermark: {
          id: "root-container",
          updatedAt: "2026-05-05T00:00:00.000Z",
        },
      }),
      null,
      expect.objectContaining({
        laneId: "parent-container",
        laneKind: "container_documents",
        watermark: {
          id: "document-1",
          updatedAt: "2026-05-05T00:10:00.000Z",
        },
      }),
    ]);
    await expect(
      watermarks.loadWatermark(containerParentSyncLane("parent-container")),
    ).resolves.toEqual({
      id: "child-container",
      updatedAt: "2026-05-05T00:05:00.000Z",
    });
    await expect(
      watermarks.loadWatermark(containerParentSyncLane("root")),
    ).resolves.toEqual({
      id: "child-of-root-named-container",
      updatedAt: "2026-05-05T00:07:00.000Z",
    });
    await expect(
      watermarks.loadWatermark(containerContentsSyncLane("parent-container")),
    ).resolves.toEqual({
      id: "document-1",
      updatedAt: "2026-05-05T00:10:00.000Z",
    });

    await watermarks.saveWatermark(containerParentSyncLane(null), {
      id: "root-container-2",
      updatedAt: "2026-05-05T00:15:00.000Z",
    });

    await expect(
      watermarks.loadWatermark(containerParentSyncLane(null)),
    ).resolves.toEqual({
      id: "root-container-2",
      updatedAt: "2026-05-05T00:15:00.000Z",
    });
    await expect(
      watermarks.loadWatermark(containerParentSyncLane("parent-container")),
    ).resolves.toEqual({
      id: "child-container",
      updatedAt: "2026-05-05T00:05:00.000Z",
    });

    await watermarks.markChecked(containerParentSyncLane(null));
    await watermarks.markChecked(containerContentsSyncLane("parent-container"));

    await expect(
      watermarks.loadCheckRecords([
        containerParentSyncLane(null),
        containerParentSyncLane("missing-parent"),
        containerContentsSyncLane("parent-container"),
      ]),
    ).resolves.toEqual([
      {
        checkedAt: expect.any(String),
        laneId: "root",
        laneKind: "container_parent",
      },
      null,
      {
        checkedAt: expect.any(String),
        laneId: "parent-container",
        laneKind: "container_documents",
      },
    ]);
  } finally {
    close();
  }
});

test("lane reads chunk under SQLite's bind-variable limit", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-sync-watermark-batch-test",
  );

  const watermarks = new ContainerSyncWatermarkRepository(execSql);
  try {
    // Each lane predicate binds two variables, so this many lanes in one
    // unchunked OR blows SQLite's variable limit before returning a row.
    const lanes = Array.from({ length: 17_000 }, (_, index) =>
      containerContentsSyncLane(`container-${index}`),
    );
    const saved = containerContentsSyncLane("container-16999");
    await storeContainerRows(execSql, ["container-16999"]);
    await watermarks.saveWatermark(saved, {
      id: "tail-lane",
      updatedAt: "2026-05-05T00:00:00.000Z",
    });
    await watermarks.markChecked(saved);

    const records = await watermarks.loadWatermarkRecords(lanes);
    expect(records).toHaveLength(lanes.length);
    expect(
      records.flatMap((record) => (record ? [record.watermark.id] : [])),
    ).toEqual(["tail-lane"]);

    const checks = await watermarks.loadCheckRecords(lanes);
    expect(checks).toHaveLength(lanes.length);
    expect(checks.flatMap((record) => (record ? [record.laneId] : []))).toEqual(
      ["container-16999"],
    );
  } finally {
    close();
  }
});

test("root listings use one global cursor matching the cross-organization API feed", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-sync-watermark-global-root-test",
  );
  const watermarks = new ContainerSyncWatermarkRepository(execSql);
  try {
    const first = containerParentSyncLane(null);
    const second = containerParentSyncLane(null);
    await watermarks.saveWatermark(first, {
      id: "first-root",
      updatedAt: "2026-08-27T00:00:00.000Z",
    });
    await watermarks.saveWatermark(second, {
      id: "second-root",
      updatedAt: "2026-08-27T00:01:00.000Z",
    });

    await expect(watermarks.loadWatermark(first)).resolves.toEqual({
      id: "second-root",
      updatedAt: "2026-08-27T00:01:00.000Z",
    });
    await expect(watermarks.loadWatermark(second)).resolves.toEqual({
      id: "second-root",
      updatedAt: "2026-08-27T00:01:00.000Z",
    });
  } finally {
    close();
  }
});

test("a lane's cursor and freshness marker share one row without clobbering", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-sync-watermark-shared-row-test",
  );
  const watermarks = new ContainerSyncWatermarkRepository(execSql);
  try {
    const checkedOnly = containerParentSyncLane("checked-only");
    const both = containerParentSyncLane("both");
    await watermarks.markChecked(checkedOnly);
    // A drained page that carried a cursor records both halves at once.
    await watermarks.recordLaneFetch(both, {
      checked: true,
      watermark: { id: "first", updatedAt: "2026-05-05T00:00:00.000Z" },
    });
    // A later partial page advances the cursor and keeps the marker.
    await watermarks.saveWatermark(both, {
      id: "second",
      updatedAt: "2026-05-05T00:01:00.000Z",
    });

    await expect(
      watermarks.loadWatermarkRecords([checkedOnly, both]),
    ).resolves.toEqual([
      null,
      expect.objectContaining({
        watermark: { id: "second", updatedAt: "2026-05-05T00:01:00.000Z" },
      }),
    ]);
    await expect(
      watermarks.loadCheckRecords([checkedOnly, both]),
    ).resolves.toEqual([
      expect.objectContaining({ laneId: "parent:checked-only" }),
      expect.objectContaining({ laneId: "parent:both" }),
    ]);

    // Deleting the container drops the lane's single row.
    await getClientSQLitePersistenceRuntime(execSql).transaction((tx) =>
      deleteContainerWatermarksInTransaction(tx, ["both"]),
    );
    await expect(watermarks.loadCheckRecords([both])).resolves.toEqual([null]);
  } finally {
    close();
  }
});

test("a document lane's fetch writes no row for a container not stored", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-sync-watermark-stored-container-test",
  );
  const watermarks = new ContainerSyncWatermarkRepository(execSql);
  // A publication cursor, which reads back only under the current format.
  const watermark = { id: "d1/next", updatedAt: "2026-05-05T00:00:00.000Z" };
  try {
    // A listing in flight across the container's delete records afterwards,
    // with and without a guard on the commit.
    const gone = containerContentsSyncLane("deleted");
    await watermarks.recordLaneFetch(gone, { checked: true, watermark });
    await watermarks.recordLaneFetch(
      gone,
      { checked: true, watermark },
      { stillCurrent: () => true },
    );
    await expect(watermarks.loadWatermarkRecords([gone])).resolves.toEqual([
      null,
    ]);
    await expect(watermarks.loadCheckRecords([gone])).resolves.toEqual([null]);

    // A stored container's lane, and a parent lane, are recorded as before.
    await storeContainerRows(execSql, [
      "stored",
      "cursor-only",
      "checked-only",
    ]);
    const stored = containerContentsSyncLane("stored");
    await watermarks.recordLaneFetch(
      stored,
      { checked: true, watermark },
      { stillCurrent: () => true },
    );
    // Recording only one half writes its own timestamp column, not the other.
    const cursorOnly = containerContentsSyncLane("cursor-only");
    const checkedOnly = containerContentsSyncLane("checked-only");
    await watermarks.saveWatermark(cursorOnly, watermark);
    await watermarks.markChecked(checkedOnly);
    await watermarks.markChecked(containerParentSyncLane("deleted"));
    await expect(watermarks.loadWatermark(stored)).resolves.toEqual(watermark);
    await expect(watermarks.loadWatermark(cursorOnly)).resolves.toEqual(
      watermark,
    );
    await expect(watermarks.loadWatermark(checkedOnly)).resolves.toBeNull();
    await expect(
      watermarks.loadCheckRecords([
        stored,
        cursorOnly,
        checkedOnly,
        containerParentSyncLane("deleted"),
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ laneId: "stored" }),
      null,
      expect.objectContaining({ laneId: "checked-only" }),
      expect.objectContaining({ laneId: "parent:deleted" }),
    ]);
  } finally {
    close();
  }
});
