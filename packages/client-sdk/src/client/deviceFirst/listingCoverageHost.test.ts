import { afterEach, beforeEach, expect, test } from "bun:test";
import { encodeVersionVectorCounters } from "@tearleads/loro";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/workflows/internalRuntimeFixtures";
import { DocumentLaneRevalidationRepository } from "../../data/persistence/container-contents/documentLaneRevalidations";
import { DocumentListingRevalidationRepository } from "../../data/persistence/documents/documentListingRevalidationRepository";
import {
  createDomainScope,
  type DomainScope,
} from "../../data/shared/domainScope";
import { documentTables } from "../../data/sqlite/schema/documentRecordSchema";
import { type ExecSql, ensureSqlTables } from "../../data/sqlite/sqlSchema";
import { getOrCreateTreeCatchUp } from "../../stores/container-contents";
import { registerDocumentStore } from "../../stores/documents/registry";
import { registerDocumentStoreLoadedRecord } from "../../stores/documents/savedElsewhere";
import type { DocumentStoreFacade } from "../../stores/documents/types";
import { createListingCoverageHost } from "./listingCoverageHost";

const LOADED = encodeVersionVectorCounters({ "7": 4 });
const SAVED_ELSEWHERE = encodeVersionVectorCounters({ "7": 4, "9": 2 });

let close: () => void = () => undefined;
let execSql: ExecSql;
let domainScope: DomainScope;

beforeEach(async () => {
  const database = await createTestExecSql(`host-${crypto.randomUUID()}`);
  close = database.close;
  execSql = database.execSql;
  await ensureSqlTables(execSql, documentTables);
  domainScope = createDomainScope();
});

afterEach(() => close());

/** An open store whose record this runtime loaded at `LOADED`. */
async function openStore(localId: string, persistedFrontier: string) {
  const documentId = `document-${localId}`;
  await execSql(
    `INSERT INTO documents (app_kind, local_id, document_id,
       snapshot_end_version, updated_at)
     VALUES ('documents', ?, ?, ?, '2026-11-25T00:00:00.000Z')`,
    [localId, documentId, persistedFrontier],
  );
  let remoteSyncs = 0;
  const store = {
    requestRemoteSync: () => {
      remoteSyncs += 1;
    },
  } as unknown as DocumentStoreFacade;
  registerDocumentStoreLoadedRecord(store, () => ({
    localId,
    lacks: (frontier) => frontier !== LOADED,
  }));
  registerDocumentStore(domainScope, localId, store, documentId);
  return { documentId, remoteSyncs: () => remoteSyncs };
}

function hostFor(input: {
  readonly dbStatus?: "ready" | "idle";
  readonly scope?: DomainScope;
}) {
  const fixture = createWorkflowInputFixture({
    apiClient: createMockApiClient({}),
    dbStatus: input.dbStatus,
    domainScope: input.scope ?? domainScope,
    execSql,
  });
  return createListingCoverageHost(
    createInternalRuntimeFixture(() => fixture),
    domainScope,
  );
}

test("a catch-up asks the stores a listing owes and the stores another tab saved past", async () => {
  // A listing in this tab or another left this debt unsettled.
  const owed = await openStore("owed", LOADED);
  await new DocumentListingRevalidationRepository(execSql).request([
    { documentId: owed.documentId, updateCount: 3 },
  ]);
  // Another tab listed this row, pulled the edit, and settled the debt.
  const savedElsewhere = await openStore("saved-elsewhere", SAVED_ELSEWHERE);
  const current = await openStore("current", LOADED);

  await hostFor({}).requestOwedDocumentReads?.();

  expect(owed.remoteSyncs()).toBe(1);
  expect(savedElsewhere.remoteSyncs()).toBe(1);
  expect(current.remoteSyncs()).toBe(0);
});

test("a catch-up forgets the lane listings owed to containers it does not store", async () => {
  const lanes = new DocumentLaneRevalidationRepository(execSql);
  // A tree listing owed this lane before its row was refused.
  await lanes.request(["never-stored"]);

  await hostFor({}).requestOwedDocumentReads?.();

  expect(await lanes.listOwedContainerIds()).toEqual(new Set());
});

test("a catch-up of another scope or an unready database asks nothing", async () => {
  const savedElsewhere = await openStore("saved-elsewhere", SAVED_ELSEWHERE);

  await hostFor({ scope: createDomainScope() }).requestOwedDocumentReads?.();
  await hostFor({ dbStatus: "idle" }).requestOwedDocumentReads?.();

  expect(savedElsewhere.remoteSyncs()).toBe(0);
});

test("the catch-up asks the scope's tree crawl whether it vouches", async () => {
  const host = hostFor({});
  const treeCatchUp = getOrCreateTreeCatchUp(domainScope);

  // No acknowledged connection has owed a crawl yet: nothing vouches.
  expect(await host.whenTreeCrawlSettles?.()).toBe(false);

  treeCatchUp.crawlOwed();
  const settled = host.whenTreeCrawlSettles?.();
  treeCatchUp.crawlSettled(true);
  expect(await settled).toBe(true);
});
