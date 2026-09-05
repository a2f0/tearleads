import { expect, test } from "bun:test";
import { createDocument, encodeVersionVector } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import {
  clearDocumentSyncFailure,
  recordDocumentSyncFailure,
} from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  createContainerParentSyncLane,
  defaultContainerContentsPersistence,
  markContainerSyncLaneChecked,
} from "../../workflows/container-contents/containerPersistence";
import {
  saveTestDocument,
  saveTestSyncedContainer,
} from "../../workflows/container-contents/documentQueries.testFixtures";
import {
  hasStartupContainerSyncWork,
  scheduleStaleStartupRemoteHydration,
} from "./startupHydration";

const TEST_ORGANIZATION_ID = "org-1";

async function createStartupWorkFixture(testDbName: string) {
  const { close, execSql } = await createTestExecSql(testDbName);
  await defaultContainerContentsPersistence.ensureSchema(execSql);
  await sqlDocumentsPersistence.ensureSchema(execSql);
  await sqlDocumentMoveIntentPersistence.ensureSchema(execSql);
  const state = {
    containersById: new Map([["root-container", {}]]),
    persistence: defaultContainerContentsPersistence,
    runtime: { infra: { execSql } },
  };
  return { close, execSql, state };
}

async function saveSettledTestDocument(input: {
  execSql: Parameters<typeof sqlDocumentsPersistence.saveDocument>[0];
  id: string;
  seed: string;
}) {
  const settledDoc = await createDocument(input.seed);
  settledDoc.getText("text").update("settled");
  settledDoc.commit();
  const settledVersion = encodeVersionVector(settledDoc);
  await sqlDocumentsPersistence.saveDocument(
    input.execSql,
    {
      accessEpoch: 1,
      containerId: "root-container",
      documentId: `remote-${input.id}`,
      documentKind: "note",
      id: input.id,
      pendingBaseVersion: settledVersion,
      snapshotEndVersion: settledVersion,
      text: "settled",
      title: "Settled",
    },
    { updatedAt: "2026-07-20T00:00:00.000Z" },
  );
}

test("hasStartupContainerSyncWork is false when every document is settled", async () => {
  const { close, execSql, state } = await createStartupWorkFixture(
    "startup-work-settled",
  );
  try {
    await saveSettledTestDocument({ execSql, id: "settled-doc", seed: "s1" });
    await expect(hasStartupContainerSyncWork(state)).resolves.toBe(false);
  } finally {
    close();
  }
});

test("startup restores a fresh durable root-lane hydration marker", async () => {
  const { close, execSql } = await createTestExecSql(
    "startup-restores-root-lane-hydration",
  );
  try {
    await markContainerSyncLaneChecked(
      execSql,
      createContainerParentSyncLane(null),
    );
    let hydrationRequestCount = 0;
    const state = {
      containerParentIdsNeedingHydration: new Set<string | null>(),
      containersById: new Map([
        [
          "remote-root",
          {
            container: {
              metadataDocumentId: "remote-root-metadata",
              parentId: null,
            },
          },
        ],
      ]),
      rootLaneHydrated: false,
      runtime: {
        auth: {
          isAuthenticated: true,
          organizationId: TEST_ORGANIZATION_ID,
        },
        infra: { execSql },
        state: { containerId: "remote-root", online: true },
      },
    };

    const shouldScheduleStaleRootRecovery =
      await scheduleStaleStartupRemoteHydration({
        requestHydration: async () => {
          hydrationRequestCount += 1;
        },
        state,
      });

    expect(state.rootLaneHydrated).toBe(true);
    expect(hydrationRequestCount).toBe(0);
    expect(shouldScheduleStaleRootRecovery).toBe(false);
  } finally {
    close();
  }
});

test("startup schedules stale-root recovery with no durable sync work", async () => {
  const { close, execSql } = await createTestExecSql(
    "startup-schedules-stale-root-recovery",
  );
  try {
    await markContainerSyncLaneChecked(
      execSql,
      createContainerParentSyncLane(null),
    );
    let hydrationRequestCount = 0;
    const state = {
      containerParentIdsNeedingHydration: new Set<string | null>(),
      containersById: new Map([
        [
          "remote-root",
          {
            container: {
              metadataDocumentId: "remote-root-metadata",
              parentId: null,
            },
          },
        ],
      ]),
      rootLaneHydrated: false,
      runtime: {
        auth: {
          isAuthenticated: true,
          organizationId: TEST_ORGANIZATION_ID,
        },
        infra: { execSql },
        state: { containerId: "deleted-local-root", online: true },
      },
    };

    const shouldScheduleStaleRootRecovery =
      await scheduleStaleStartupRemoteHydration({
        requestHydration: async () => {
          hydrationRequestCount += 1;
        },
        state,
      });

    expect(state.rootLaneHydrated).toBe(true);
    expect(hydrationRequestCount).toBe(0);
    expect(shouldScheduleStaleRootRecovery).toBe(true);
  } finally {
    close();
  }
});

test("stale startup marker failures are not reported", async () => {
  let rejectRead: (error: Error) => void = () => {};
  let markReadStarted: () => void = () => {};
  const readStarted = new Promise<void>((resolve) => {
    markReadStarted = resolve;
  });
  const execSql = (() =>
    new Promise((_, reject) => {
      rejectRead = reject;
      markReadStarted();
    })) as ExecSql;
  const reportedErrors: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    reportedErrors.push(args);
  };
  let current = true;
  try {
    const hydration = scheduleStaleStartupRemoteHydration({
      isCurrent: () => current,
      requestHydration: async () => {},
      state: {
        containerParentIdsNeedingHydration: new Set(),
        containersById: new Map(),
        rootLaneHydrated: false,
        runtime: {
          auth: { isAuthenticated: true },
          infra: { execSql },
          state: { containerId: null, online: true },
        },
      },
    });
    await readStarted;
    current = false;
    rejectRead(new Error("stale database handle"));

    await expect(hydration).resolves.toBe(false);
    expect(reportedErrors).toHaveLength(0);
  } finally {
    console.error = originalConsoleError;
  }
});

test("hasStartupContainerSyncWork detects a durable pending document create", async () => {
  const { close, execSql, state } = await createStartupWorkFixture(
    "startup-work-pending-create",
  );
  try {
    // A never-synced local document: no remote id, create not yet attempted.
    await saveTestDocument({
      containerId: "root-container",
      documentId: null,
      execSql,
      id: "local-only-doc",
      title: "Pending create",
      updatedAt: "2026-07-23T14:19:12.658Z",
    });
    await expect(hasStartupContainerSyncWork(state)).resolves.toBe(true);
  } finally {
    close();
  }
});

test("hasStartupContainerSyncWork detects durable pending document updates", async () => {
  const { close, execSql, state } = await createStartupWorkFixture(
    "startup-work-pending-updates",
  );
  try {
    await saveSettledTestDocument({ execSql, id: "updated-doc", seed: "s2" });
    await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
      localId: "updated-doc",
      partialEndVersionVector: "{}",
      partialStartVersionVector: "{}",
      sourceVersionVector: null,
      updateData: "queued-update",
    });
    await expect(hasStartupContainerSyncWork(state)).resolves.toBe(true);
  } finally {
    close();
  }
});

test("hasStartupContainerSyncWork detects a durable metadata pull continuation", async () => {
  const { close, execSql, state } = await createStartupWorkFixture(
    "startup-work-metadata-pull-continuation",
  );
  try {
    await saveTestSyncedContainer({
      execSql,
      id: "root-container",
      name: "/",
      organizationId: "organization-id",
      pullContinuation: {
        commitLsn: "0/2",
        commitLsnMode: "tracked",
        cursor: "metadata-page-2",
      },
      timestamp: "2026-08-24T00:00:00.000Z",
    });

    await expect(hasStartupContainerSyncWork(state)).resolves.toBe(true);
  } finally {
    close();
  }
});

// Edge-case row 13's durable retry path: a fully-settled hydrated document
// with a recorded sync failure (a refused revalidation leaves no queued
// work) must still count as startup work so priming re-opens its store and
// retries — and stop counting once the row clears on a clean pass.
test("hasStartupContainerSyncWork detects a recorded sync failure", async () => {
  const { close, execSql, state } = await createStartupWorkFixture(
    "startup-work-sync-failure",
  );
  try {
    await saveSettledTestDocument({ execSql, id: "refused-doc", seed: "s9" });
    await expect(hasStartupContainerSyncWork(state)).resolves.toBe(false);

    await recordDocumentSyncFailure(
      execSql,
      { appKind: "documents", localId: "refused-doc" },
      {
        attemptedAt: "2026-07-27T00:00:00.000Z",
        message: "Remote revalidation failed: container unavailable (409)",
        status: 409,
      },
    );
    await expect(hasStartupContainerSyncWork(state)).resolves.toBe(true);

    await clearDocumentSyncFailure(execSql, {
      appKind: "documents",
      localId: "refused-doc",
    });
    await expect(hasStartupContainerSyncWork(state)).resolves.toBe(false);
  } finally {
    close();
  }
});

test("hasStartupContainerSyncWork detects a pending document move intent", async () => {
  const { close, execSql, state } = await createStartupWorkFixture(
    "startup-work-pending-move-intent",
  );
  try {
    await saveSettledTestDocument({ execSql, id: "moved-doc", seed: "s3" });
    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
      documentId: "remote-moved-doc",
      localId: "moved-doc",
      sourceContainerId: "root-container",
      targetContainerId: "target-container",
    });
    await expect(hasStartupContainerSyncWork(state)).resolves.toBe(true);
  } finally {
    close();
  }
});
