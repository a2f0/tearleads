import { afterEach, beforeEach, expect, test } from "bun:test";
import { encodeVersionVectorCounters } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type { SyncWatermark } from "@tearleads/validators/response";
import { documentVerdictJudge } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import {
  ContainerSyncWatermarkRepository,
  containerContentsSyncLane,
} from "../../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import { DocumentListingRevalidationRepository } from "../../../data/persistence/documents/documentListingRevalidationRepository";
import { documentTables } from "../../../data/sqlite/schema/documentRecordSchema";
import { type ExecSql, ensureSqlTables } from "../../../data/sqlite/sqlSchema";
import { oweListedDocumentReadsBehindListing } from "../../documents";
import {
  laneLister,
  nullContainerDocumentWatermarks,
} from "./documentDiscovery.testUtils";
import {
  type ContainerDocumentDiscoveryLane,
  discoverContainerDocumentLanes,
} from "./documentDiscoveryLanes";
import type { ListContainerDocumentsResponse } from "./documentDiscoveryTypes";

const AT = "2026-11-25T00:00:00.000Z";
const LANE = "folder";
const FRONTIER = encodeVersionVectorCounters({ "7": 4 });
const NEXT: SyncWatermark = { id: "d1/next", updatedAt: AT };

let close: () => void = () => undefined;
let execSql: ExecSql;

beforeEach(async () => {
  const database = await createTestExecSql(`owed-${crypto.randomUUID()}`);
  close = database.close;
  execSql = database.execSql;
  await ensureSqlTables(execSql, documentTables);
});

afterEach(() => close());

/** A held document whose completed pull counted `processed` updates. */
async function holdDocument(documentId: string, processed: number) {
  await execSql(
    `INSERT INTO documents (app_kind, local_id, document_id,
       snapshot_end_version, content_key_bundle, updated_at)
     VALUES ('documents', ?, ?, ?, ?, ?)`,
    [
      `local-${documentId}`,
      documentId,
      FRONTIER,
      JSON.stringify({ linkSetManifestHash: `head:${documentId}` }),
      AT,
    ],
  );
  await execSql(
    `INSERT INTO document_sync_progress (app_kind, local_id, document_id,
       through_update_id, through_update_count, through_version, judge)
     VALUES ('documents', ?, ?, 'update', ?, ?, ?)`,
    [
      `local-${documentId}`,
      documentId,
      processed,
      FRONTIER,
      documentVerdictJudge(),
    ],
  );
}

function listing(
  counts: Readonly<Record<string, number>>,
  heads: Readonly<Record<string, string>> = {},
): ListContainerDocumentsResponse {
  return {
    hasMore: false,
    items: Object.entries(counts).map(([id, updateCount]) => ({
      createdAt: AT,
      currentAccessEpoch: 1,
      currentAccessStateHash: heads[id] ?? `head:${id}`,
      id,
      linkedContainerIds: [LANE],
      referencedPrincipals: [],
      updateCount,
      updatedAt: AT,
    })),
    nextWatermark: NEXT,
    tombstones: [],
  };
}

function owedDocumentIds() {
  return new DocumentListingRevalidationRepository(
    execSql,
  ).listOwedDocumentIds();
}

function savedWatermark() {
  return new ContainerSyncWatermarkRepository(execSql).loadWatermark(
    containerContentsSyncLane(LANE),
  );
}

/** One lane over the real debt and watermark tables; `steps` records order. */
function discover(input: {
  readonly lane?: Partial<ContainerDocumentDiscoveryLane>;
  readonly page: ListContainerDocumentsResponse | null;
  readonly steps: string[];
}) {
  const lane: ContainerDocumentDiscoveryLane = {
    ...nullContainerDocumentWatermarks,
    containerId: LANE,
    onDocumentReadsOwed: (documentIds) => {
      input.steps.push(`asked:${documentIds.join(",")}`);
    },
    oweListedDocumentReads: (listed) =>
      oweListedDocumentReadsBehindListing(execSql, listed),
    replaceDocumentLinksBatch: async () => {},
    recordContainerDocumentListing: async (containerId, listing) => {
      // What the watermark is about to pass must already be owed.
      input.steps.push(`saved:${(await owedDocumentIds()).join(",")}`);
      await new ContainerSyncWatermarkRepository(execSql).recordLaneFetch(
        containerContentsSyncLane(containerId),
        { checked: listing.settled, watermark: listing.watermark },
      );
    },
    upsertDiscoveredDocuments: async () => {
      // Applying a row whose access epoch moved drops the key bundle its
      // record held, so whatever the listing owes must be durable by now.
      input.steps.push(`applied:${(await owedDocumentIds()).join(",")}`);
      await execSql("UPDATE documents SET content_key_bundle = NULL");
      return [];
    },
    ...input.lane,
  };
  return discoverContainerDocumentLanes({
    generation: 1,
    lanes: [lane],
    listContainerDocumentLanes: laneLister(async () => input.page),
    loadContainerDocumentWatermark: async () => null,
  });
}

test("a listing owes each read before its watermark passes the row", async () => {
  await holdDocument("behind", 1);
  await holdDocument("covered", 3);
  const steps: string[] = [];

  const [outcome] = await discover({
    page: listing({ behind: 2, covered: 3, empty: 0 }),
    steps,
  });

  expect(outcome?.status).toBe("fulfilled");
  // Durable before the rows are applied, then the registered store is asked,
  // then the watermark.
  expect(steps).toEqual(["applied:behind", "asked:behind", "saved:behind"]);
  expect(await savedWatermark()).toEqual(NEXT);
  expect(
    (await new DocumentListingRevalidationRepository(execSql).find("behind"))
      ?.advertisedUpdateCount,
  ).toBe(2);
});

test("a listing every cursor covers owes nothing and asks no store", async () => {
  await holdDocument("covered", 3);
  const steps: string[] = [];

  await discover({ page: listing({ covered: 3 }), steps });

  expect(steps).toEqual(["applied:", "saved:"]);
  expect(await savedWatermark()).toEqual(NEXT);
});

test("a listed access head the record's key bundle does not name owes a read before it is applied", async () => {
  // A peer moved the document: its head changed and no update was added.
  await holdDocument("moved", 3);
  await holdDocument("still", 3);
  const steps: string[] = [];

  await discover({
    page: listing({ moved: 3, still: 3 }, { moved: "head:moved-again" }),
    steps,
  });

  expect(steps).toEqual(["applied:moved", "asked:moved", "saved:moved"]);
  expect(
    (await new DocumentListingRevalidationRepository(execSql).find("moved"))
      ?.advertisedUpdateCount,
  ).toBe(3);
});

test("a debt that cannot be written leaves the lane's watermark behind the row", async () => {
  await holdDocument("behind", 1);
  const steps: string[] = [];

  const [outcome] = await discover({
    lane: {
      oweListedDocumentReads: async () => {
        throw new Error("local database unavailable");
      },
    },
    page: listing({ behind: 2 }),
    steps,
  });

  expect(outcome?.status).toBe("rejected");
  expect(steps).toEqual([]);
  // The next listing of the lane returns the row again.
  expect(await savedWatermark()).toBeNull();
});

test("a lane the server refused is reported unlisted and passes nothing", async () => {
  const steps: string[] = [];

  const [outcome] = await discover({ page: null, steps });

  expect(outcome).toEqual({
    containerId: LANE,
    status: "fulfilled",
    unlisted: true,
    value: null,
  });
  expect(steps).toEqual([]);
  expect(await savedWatermark()).toBeNull();
});
