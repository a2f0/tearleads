import { afterEach, beforeEach, expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { ListContainerDocumentLanesRequest } from "@tearleads/validators/request";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/workflows/internalRuntimeFixtures";
import {
  HELD_FRONTIER,
  heldHead,
  holdListedRecord,
} from "../../data/persistence/documents/documentListingRevalidation.testUtils";
import { DocumentListingRevalidationRepository } from "../../data/persistence/documents/documentListingRevalidationRepository";
import {
  createDomainScope,
  type DomainScope,
} from "../../data/shared/domainScope";
import { documentTables } from "../../data/sqlite/schema/documentRecordSchema";
import { type ExecSql, ensureSqlTables } from "../../data/sqlite/sqlSchema";
import { registerDocumentStore } from "../../stores/documents/registry";
import { registerDocumentStoreLoadedRecord } from "../../stores/documents/savedElsewhere";
import type { DocumentStoreFacade } from "../../stores/documents/types";
import type { ListedContainerDocument } from "../../workflows/container-contents/documentDiscovery/documentDiscoveryTypes";
import { createProbeLaneListing } from "./listingCoverageHost";

type ListedRow = ListedContainerDocument & {
  readonly effectiveAccessLevel: "admin";
};

let close: () => void = () => undefined;
let execSql: ExecSql;
let domainScope: DomainScope;

beforeEach(async () => {
  const database = await createTestExecSql(`probe-${crypto.randomUUID()}`);
  close = database.close;
  execSql = database.execSql;
  await ensureSqlTables(execSql, documentTables);
  domainScope = createDomainScope();
});

afterEach(() => close());

/** A held record of `documentId` whose store this runtime has open. */
async function openRecord(documentId: string, head: string) {
  const localId = await holdListedRecord(execSql, { documentId, head });
  let remoteSyncs = 0;
  const store = {
    requestRemoteSync: () => {
      remoteSyncs += 1;
    },
  } as unknown as DocumentStoreFacade;
  registerDocumentStoreLoadedRecord(store, () => ({
    lacks: (frontier) => frontier !== HELD_FRONTIER,
    localId,
  }));
  registerDocumentStore(domainScope, localId, store, documentId);
  return { localId, remoteSyncs: () => remoteSyncs };
}

function row(id: string, updateCount = 0): ListedRow {
  return {
    createdAt: "2026-11-26T00:00:00.000Z",
    currentAccessEpoch: 1,
    currentAccessStateHash: heldHead(id),
    effectiveAccessLevel: "admin",
    id,
    linkedContainerIds: ["folder"],
    referencedPrincipals: [],
    updateCount,
    updatedAt: "2026-11-26T00:00:00.000Z",
  };
}

/** Lists `folder` with `rows` in one page; any other lane fails. */
function probeListing(
  rows: ReadonlyArray<ListedRow>,
  options: {
    readonly dbStatus?: "ready" | "idle";
    readonly logError?: (message: string | Error, cause?: unknown) => void;
    readonly scope?: DomainScope;
  } = {},
) {
  const requests: Array<{
    readonly input: ListContainerDocumentLanesRequest;
    readonly options: unknown;
  }> = [];
  const fixture = createWorkflowInputFixture({
    apiClient: createMockApiClient({
      listContainerDocumentLanes: async (input, requestOptions) => {
        requests.push({ input, options: requestOptions });
        return {
          results: input.lanes.map(({ containerId, laneId }) =>
            containerId === "folder"
              ? {
                  laneId,
                  page: {
                    hasMore: false,
                    items: [...rows],
                    nextWatermark: null,
                    tombstones: [],
                  },
                }
              : { failure: { error: "refused", status: 403 }, laneId },
          ),
        };
      },
    }),
    dbStatus: options.dbStatus,
    domainScope: options.scope ?? domainScope,
    execSql,
    ...(options.logError ? { logError: options.logError } : {}),
  });
  const list = createProbeLaneListing(
    createInternalRuntimeFixture(() => fixture),
    domainScope,
  );
  return { list, requests };
}

test("the initial probe's listing owes a read to each record its rows show behind", async () => {
  // A local backup restore put back this record's row from before the
  // document's head moved; no watermarked listing serves its row again.
  const restored = await openRecord("document-restored", "head:older");
  const current = await openRecord(
    "document-current",
    heldHead("document-current"),
  );
  // No pull of this record has saved a cursor yet, and its row lists an edit.
  const edited = await openRecord(
    "document-edited",
    heldHead("document-edited"),
  );
  const { list, requests } = probeListing([
    row("document-restored"),
    row("document-current"),
    row("document-edited", 2),
  ]);

  const listed = await list(["folder", "refused"]);

  expect(listed).toEqual(
    new Map([
      ["folder", ["document-restored", "document-current", "document-edited"]],
      ["refused", null],
    ]),
  );
  // One batched listing from no watermark, whose failures are not reported.
  expect(requests).toHaveLength(1);
  expect(requests[0]?.input.lanes.map(({ watermark }) => watermark)).toEqual([
    null,
    null,
  ]);
  expect(requests[0]?.options).toEqual({ reportErrors: false });
  const owed = await new DocumentListingRevalidationRepository(
    execSql,
  ).listOwed();
  expect(new Set(owed.map(({ localId }) => localId))).toEqual(
    new Set([restored.localId, edited.localId]),
  );
  expect(restored.remoteSyncs()).toBe(1);
  expect(edited.remoteSyncs()).toBe(1);
  expect(current.remoteSyncs()).toBe(0);
});

test("a probe listing of another scope or an unready database owes nothing", async () => {
  const restored = await openRecord("document-restored", "head:older");

  for (const options of [
    { scope: createDomainScope() },
    { dbStatus: "idle" as const },
  ]) {
    const { list } = probeListing([row("document-restored")], options);
    expect(await list(["folder"])).toEqual(
      new Map([["folder", ["document-restored"]]]),
    );
  }

  expect(
    await new DocumentListingRevalidationRepository(execSql).listOwed(),
  ).toEqual([]);
  expect(restored.remoteSyncs()).toBe(0);
});

test("a probe listing whose debts cannot be written keeps its ids", async () => {
  await openRecord("document-restored", "head:older");
  await execSql("DROP TABLE document_sync_progress");
  const errors: Array<string | Error> = [];
  const { list } = probeListing([row("document-restored")], {
    logError: (message) => errors.push(message),
  });

  expect(await list(["folder"])).toEqual(
    new Map([["folder", ["document-restored"]]]),
  );
  expect(errors).toEqual(["Initial document probe could not owe reads"]);
});
