import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  containerContentsSyncLane,
  containerParentSyncLane,
  sqlContainerSyncWatermarkPersistence,
} from "./containerSyncWatermarkPersistence";

test("container sync watermarks are persisted independently per lane", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-sync-watermark-persistence-test",
  );

  try {
    await expect(
      sqlContainerSyncWatermarkPersistence.loadWatermark(
        execSql,
        containerParentSyncLane(null),
      ),
    ).resolves.toBeNull();

    await sqlContainerSyncWatermarkPersistence.saveWatermark(
      execSql,
      containerParentSyncLane(null),
      {
        id: "root-container",
        updatedAt: "2026-05-05T00:00:00.000Z",
      },
    );
    await sqlContainerSyncWatermarkPersistence.saveWatermark(
      execSql,
      containerParentSyncLane("parent-container"),
      {
        id: "child-container",
        updatedAt: "2026-05-05T00:05:00.000Z",
      },
    );
    await sqlContainerSyncWatermarkPersistence.saveWatermark(
      execSql,
      containerParentSyncLane("root"),
      {
        id: "child-of-root-named-container",
        updatedAt: "2026-05-05T00:07:00.000Z",
      },
    );
    await sqlContainerSyncWatermarkPersistence.saveWatermark(
      execSql,
      containerContentsSyncLane("parent-container"),
      {
        id: "document-1",
        updatedAt: "2026-05-05T00:10:00.000Z",
      },
    );

    await expect(
      sqlContainerSyncWatermarkPersistence.loadWatermark(
        execSql,
        containerParentSyncLane(null),
      ),
    ).resolves.toEqual({
      id: "root-container",
      updatedAt: "2026-05-05T00:00:00.000Z",
    });
    await expect(
      sqlContainerSyncWatermarkPersistence
        .loadWatermarkRecords(execSql, [containerParentSyncLane(null)])
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
      sqlContainerSyncWatermarkPersistence.loadWatermarkRecords(execSql, [
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
      sqlContainerSyncWatermarkPersistence.loadWatermark(
        execSql,
        containerParentSyncLane("parent-container"),
      ),
    ).resolves.toEqual({
      id: "child-container",
      updatedAt: "2026-05-05T00:05:00.000Z",
    });
    await expect(
      sqlContainerSyncWatermarkPersistence.loadWatermark(
        execSql,
        containerParentSyncLane("root"),
      ),
    ).resolves.toEqual({
      id: "child-of-root-named-container",
      updatedAt: "2026-05-05T00:07:00.000Z",
    });
    await expect(
      sqlContainerSyncWatermarkPersistence.loadWatermark(
        execSql,
        containerContentsSyncLane("parent-container"),
      ),
    ).resolves.toEqual({
      id: "document-1",
      updatedAt: "2026-05-05T00:10:00.000Z",
    });

    await sqlContainerSyncWatermarkPersistence.saveWatermark(
      execSql,
      containerParentSyncLane(null),
      {
        id: "root-container-2",
        updatedAt: "2026-05-05T00:15:00.000Z",
      },
    );

    await expect(
      sqlContainerSyncWatermarkPersistence.loadWatermark(
        execSql,
        containerParentSyncLane(null),
      ),
    ).resolves.toEqual({
      id: "root-container-2",
      updatedAt: "2026-05-05T00:15:00.000Z",
    });
    await expect(
      sqlContainerSyncWatermarkPersistence.loadWatermark(
        execSql,
        containerParentSyncLane("parent-container"),
      ),
    ).resolves.toEqual({
      id: "child-container",
      updatedAt: "2026-05-05T00:05:00.000Z",
    });

    await sqlContainerSyncWatermarkPersistence.markChecked(
      execSql,
      containerParentSyncLane(null),
    );
    await sqlContainerSyncWatermarkPersistence.markChecked(
      execSql,
      containerContentsSyncLane("parent-container"),
    );

    await expect(
      sqlContainerSyncWatermarkPersistence.loadCheckRecords(execSql, [
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

  try {
    // Each lane predicate binds two variables, so this many lanes in one
    // unchunked OR blows SQLite's variable limit before returning a row.
    const lanes = Array.from({ length: 17_000 }, (_, index) =>
      containerContentsSyncLane(`container-${index}`),
    );
    const saved = containerContentsSyncLane("container-16999");
    await sqlContainerSyncWatermarkPersistence.saveWatermark(execSql, saved, {
      id: "tail-lane",
      updatedAt: "2026-05-05T00:00:00.000Z",
    });
    await sqlContainerSyncWatermarkPersistence.markChecked(execSql, saved);

    const watermarks =
      await sqlContainerSyncWatermarkPersistence.loadWatermarkRecords(
        execSql,
        lanes,
      );
    expect(watermarks).toHaveLength(lanes.length);
    expect(
      watermarks.flatMap((record) => (record ? [record.watermark.id] : [])),
    ).toEqual(["tail-lane"]);

    const checks = await sqlContainerSyncWatermarkPersistence.loadCheckRecords(
      execSql,
      lanes,
    );
    expect(checks).toHaveLength(lanes.length);
    expect(checks.flatMap((record) => (record ? [record.laneId] : []))).toEqual(
      ["container-16999"],
    );
  } finally {
    close();
  }
});
