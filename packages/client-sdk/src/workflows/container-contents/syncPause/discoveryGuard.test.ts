import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DiscoveredDocumentInput } from "../../../data/documents/documentSummary";
import {
  ContainerSyncWatermarkRepository,
  containerContentsSyncLane,
} from "../../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import { containerSyncWatermarkTables } from "../../../data/sqlite/schema/containerSyncWatermarkSchema";
import { runSerializedSqlMutation } from "../../../data/sqlite/sqlExec";
import { type ExecSql, ensureSqlTables } from "../../../data/sqlite/sqlSchema";
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
    await ensureSqlTables(execSql, containerSyncWatermarkTables);
    await run(execSql);
  } finally {
    close();
  }
}

function loadWatermark(execSql: ExecSql) {
  return new ContainerSyncWatermarkRepository(execSql).loadWatermark(
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
        // The pause lands after the listing was verified.
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

    expect(applied).toEqual({ status: "superseded" });
    // Saved now, the watermark would let the listing after a resume skip the
    // documents this one did not apply.
    expect(await loadWatermark(execSql)).toBeNull();
  });
});

test("a write queued behind the pause is skipped", async () => {
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
    // The pause holds the mutation lock while the listing's writes arrive.
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
      guarded.recordContainerDocumentListing(
        CONTAINER_ID,
        { settled: true, watermark: WATERMARK },
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

test("a pause set and cleared around the debt write stops the listing", async () => {
  await withWatermarks(async (execSql) => {
    // The pause is in force when the debt write takes the lock, and resumed
    // by the time anything later checks.
    let pausesLeft = 0;
    const guarded = guardDocumentDiscoveryWrites({
      execSql,
      isPaused: () => {
        if (pausesLeft === 0) return false;
        pausesLeft -= 1;
        return true;
      },
      verifyDiscoveredDocuments: verifiedListing,
    });
    const applied: string[] = [];
    const lane = {
      ...guarded,
      containerId: CONTAINER_ID,
      listHeldContainerDocumentTombstones: async () => [],
      listKnownContainerDocumentPlacements: async () => [],
      oweListedDocumentReads: (
        ...args: Parameters<typeof guarded.oweListedDocumentReads>
      ) => {
        pausesLeft = 1;
        return guarded.oweListedDocumentReads(...args);
      },
      replaceDocumentLinksBatch: async () => {
        applied.push("links");
      },
      upsertDiscoveredDocuments: async () => {
        applied.push("documents");
        return [];
      },
    } as unknown as ContainerDocumentDiscoveryLane;

    const outcome = await applyListedContainerDocuments(lane, 1, {
      isFullListing: false,
      items: [
        {
          createdAt: WATERMARK.updatedAt,
          currentAccessEpoch: 1,
          currentAccessStateHash: "head",
          id: "doc-1",
          linkedContainerIds: [CONTAINER_ID],
          referencedPrincipals: [],
          updateCount: 2,
          updatedAt: WATERMARK.updatedAt,
        },
      ] as never,
      nextWatermark: WATERMARK,
      tombstones: [],
    });

    // The skipped write owed nothing, so nothing of the listing may land.
    expect(outcome).toEqual({ status: "superseded" });
    expect(applied).toEqual([]);
    expect(await loadWatermark(execSql)).toBeNull();
  });
});

test("a pause set and cleared around the document upsert stops the listing", async () => {
  await withWatermarks(async (execSql) => {
    // The pause is in force when the upsert takes the lock, and resumed by
    // the time anything later checks.
    let pausesLeft = 0;
    const guarded = guardDocumentDiscoveryWrites({
      execSql,
      isPaused: () => {
        if (pausesLeft === 0) return false;
        pausesLeft -= 1;
        return true;
      },
      verifyDiscoveredDocuments: verifiedListing,
    });
    const linked: string[] = [];
    const lane = {
      ...guarded,
      containerId: CONTAINER_ID,
      listHeldContainerDocumentTombstones: async () => [],
      listKnownContainerDocumentPlacements: async () => [],
      replaceDocumentLinksBatch: async (
        ...args: Parameters<typeof guarded.replaceDocumentLinksBatch>
      ) => {
        if (await args[1]()) linked.push("links");
      },
      upsertDiscoveredDocuments: (
        ...args: Parameters<typeof guarded.upsertDiscoveredDocuments>
      ) => {
        pausesLeft = 1;
        return guarded.upsertDiscoveredDocuments(...args);
      },
    } as unknown as ContainerDocumentDiscoveryLane;

    const outcome = await applyListedContainerDocuments(lane, 1, {
      isFullListing: false,
      items: [],
      nextWatermark: WATERMARK,
      tombstones: [],
    });

    // Its documents were not stored, so nothing after them may land.
    expect(outcome).toEqual({ status: "superseded" });
    expect(linked).toEqual([]);
    expect(await loadWatermark(execSql)).toBeNull();
  });
});
