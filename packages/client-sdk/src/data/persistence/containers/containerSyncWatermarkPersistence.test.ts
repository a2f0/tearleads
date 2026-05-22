import { expect, test } from "bun:test";
import { createTestExecSql } from "../../../../test/helpers/createTestExecSql";
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
      sqlContainerSyncWatermarkPersistence.loadWatermarkRecord(
        execSql,
        containerParentSyncLane(null),
      ),
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
  } finally {
    close();
  }
});
