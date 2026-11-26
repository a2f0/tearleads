import { afterEach, beforeEach, expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import { DocumentLaneRevalidationRepository } from "../../../data/persistence/container-contents/documentLaneRevalidations";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { listContainerDocumentLanesFromApi } from "./containerDocumentListing";
import { nullContainerDocumentWatermarks } from "./documentDiscovery.testUtils";
import {
  type ContainerDocumentDiscoveryLane,
  discoverContainerDocumentLanes,
} from "./documentDiscoveryLanes";
import {
  findOwedDocumentLaneListings,
  requestDocumentLaneListings,
  settleOwedDocumentLaneListing,
} from "./documentLaneDiscovery";

const CONTAINER_ID = "550e8400-e29b-41d4-a716-446655440000";

let close: () => void = () => undefined;
let execSql: ExecSql;
let stopServer: () => void = () => undefined;

beforeEach(async () => {
  const database = await createTestExecSql(`joined-${crypto.randomUUID()}`);
  close = database.close;
  execSql = database.execSql;
});

afterEach(() => {
  stopServer();
  close();
});

/**
 * An API that answers each listing with an empty page, holding the first
 * one until `answerFirst` is called.
 */
function serveListings() {
  const firstReceived = Promise.withResolvers<void>();
  const firstAnswered = Promise.withResolvers<void>();
  let received = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as {
        lanes: ReadonlyArray<{ laneId: string }>;
      };
      received += 1;
      if (received === 1) {
        firstReceived.resolve();
        await firstAnswered.promise;
      }
      return Response.json({
        results: body.lanes.map(({ laneId }) => ({
          laneId,
          page: {
            hasMore: false,
            items: [],
            nextWatermark: null,
            tombstones: [],
          },
        })),
      });
    },
  });
  stopServer = () => server.stop(true);
  return {
    answerFirst: () => firstAnswered.resolve(),
    apiClient: new ApiClient(server.url.origin),
    firstReceived: firstReceived.promise,
    received: () => received,
  };
}

test("a listing that settles a request never joins one sent before it", async () => {
  const api = serveListings();
  const lane = {
    ...nullContainerDocumentWatermarks,
    containerId: CONTAINER_ID,
    replaceDocumentLinksBatch: async () => {},
    upsertDiscoveredDocuments: async () => [],
  } as ContainerDocumentDiscoveryLane;
  const discover = () =>
    discoverContainerDocumentLanes({
      generation: 1,
      lanes: [lane],
      listContainerDocumentLanes: (lanes) =>
        listContainerDocumentLanesFromApi(api.apiClient, lanes),
      loadContainerDocumentWatermark: async () => null,
      loadOwedLaneListings: (containerIds) =>
        findOwedDocumentLaneListings(execSql, containerIds),
      settleOwedLaneListing: (owed) =>
        settleOwedDocumentLaneListing(execSql, owed),
    });

  // The lane's listing is in flight, answered from before a peer's write.
  const older = discover();
  await api.firstReceived;
  // A tree listing is then served the container's row and owes the lane a
  // listing, which the catch-up sends from the same watermark.
  await requestDocumentLaneListings(execSql, [CONTAINER_ID]);
  const catchUp = discover();
  // Joined to the older request, the catch-up would wait on its answer.
  const settledAlone = await Promise.race([
    catchUp.then(() => true),
    Bun.sleep(1_000).then(() => false),
  ]);
  api.answerFirst();
  await Promise.all([older, catchUp]);
  expect(settledAlone).toBe(true);

  // The catch-up's listing was its own request, sent after the row was
  // served, so it may settle. Joined to the older one it would have settled
  // on an answer that predates the write.
  expect(api.received()).toBe(2);
  expect(
    await new DocumentLaneRevalidationRepository(
      execSql,
    ).listOwedContainerIds(),
  ).toEqual(new Set());
});
