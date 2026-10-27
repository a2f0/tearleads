import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DiscoveredDocumentInput } from "../../../data/documents/documentSummary";
import {
  containerContentsSyncLane,
  sqlContainerSyncWatermarkPersistence,
} from "../../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import { runSerializedSqlMutation } from "../../../data/sqlite/sqlExec";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  applyListedContainerDocuments,
  type ContainerDocumentDiscoveryLane,
} from "../documentDiscovery/documentDiscoveryApply";
import { guardDocumentDiscoveryWrites } from "./discoveryGuard";

const CONTAINER_ID = "paused-folder";
const WATERMARK = { id: "doc-1", updatedAt: "2026-01-01T00:00:00.000Z" };

async function withWatermarks(run: (execSql: ExecSql) => Promise<void>) {
  const { close, execSql } = await createTestExecSql("discovery-pause-guard");
  try {
    await sqlContainerSyncWatermarkPersistence.ensureSchema(execSql);
    await run(execSql);
  } finally {
    close();
  }
}

function loadWatermark(execSql: ExecSql) {
  return sqlContainerSyncWatermarkPersistence.loadWatermark(
    execSql,
    containerContentsSyncLane(CONTAINER_ID),
  );
}

// The listing's documents verify, so the apply reaches every write.
const verifiedListing = async () => ({
  commit: async () => true,
  inputs: [{ documentId: "doc-1" } as DiscoveredDocumentInput],
  isCurrent: async () => true,
});

test("a pause landing while a listing applies stores none of it", async () => {
  await withWatermarks(async (execSql) => {
    let paused = false;
    const guarded = guardDocumentDiscoveryWrites({
      execSql,
      isPaused: () => paused,
      verifyDiscoveredDocuments: async () => {
        const verification = await verifiedListing();
        // The pause cleanup runs after the listing was verified.
        paused = true;
        return verification;
      },
    });
    const lane = {
      ...guarded,
      containerId: CONTAINER_ID,
      listHeldContainerDocumentTombstones: async () => [],
      listKnownContainerDocumentPlacements: async () => [],
    } as unknown as ContainerDocumentDiscoveryLane;

    const applied = await applyListedContainerDocuments(lane, 1, {
      isFullListing: false,
      items: [],
      nextWatermark: WATERMARK,
      tombstones: [],
    });

    expect(applied).toBeNull();
    // Saved now, the watermark would let the listing after a resume skip the
    // documents the cleanup removed.
    expect(await loadWatermark(execSql)).toBeNull();
  });
});

test("a write queued behind the pause cleanup is skipped", async () => {
  await withWatermarks(async (execSql) => {
    let paused = false;
    const guarded = guardDocumentDiscoveryWrites({
      execSql,
      isPaused: () => paused,
      verifyDiscoveredDocuments: verifiedListing,
    });
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The cleanup holds the mutation lock while the listing's writes arrive.
    const cleanup = runSerializedSqlMutation(execSql, async () => {
      await held;
      paused = true;
    });
    const writes = Promise.all([
      guarded.upsertDiscoveredDocuments(
        [{ documentId: "doc-1" } as DiscoveredDocumentInput],
        async () => true,
      ),
      guarded.replaceDocumentLinksBatch(
        [{ accessEpoch: 1, containerIds: [CONTAINER_ID], documentId: "doc-1" }],
        async () => true,
      ),
      guarded.saveContainerDocumentWatermark(
        CONTAINER_ID,
        WATERMARK,
        async () => true,
      ),
    ]);
    release();
    await cleanup;

    const [documents] = await writes;
    expect(documents).toEqual([]);
    expect(await loadWatermark(execSql)).toBeNull();
  });
});
