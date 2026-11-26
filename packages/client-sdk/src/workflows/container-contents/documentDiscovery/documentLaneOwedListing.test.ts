import { afterEach, beforeEach, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { DocumentLaneRevalidationRepository } from "../../../data/persistence/container-contents/documentLaneRevalidations";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  laneLister,
  nullContainerDocumentWatermarks,
} from "./documentDiscovery.testUtils";
import {
  type ContainerDocumentDiscoveryLane,
  discoverContainerDocumentLanes,
} from "./documentDiscoveryLanes";
import type { ListContainerDocumentsResponse } from "./documentDiscoveryTypes";
import {
  findOwedDocumentLaneListings,
  requestDocumentLaneListings,
  settleOwedDocumentLaneListing,
} from "./documentLaneDiscovery";

const EMPTY_PAGE: ListContainerDocumentsResponse = {
  hasMore: false,
  items: [],
  nextWatermark: null,
  tombstones: [],
};

let close: () => void = () => undefined;
let execSql: ExecSql;

beforeEach(async () => {
  const database = await createTestExecSql(`lane-owed-${crypto.randomUUID()}`);
  close = database.close;
  execSql = database.execSql;
});

afterEach(() => close());

function lane(
  containerId: string,
  overrides: Partial<ContainerDocumentDiscoveryLane> = {},
): ContainerDocumentDiscoveryLane {
  return {
    ...nullContainerDocumentWatermarks,
    containerId,
    replaceDocumentLinksBatch: async () => {},
    upsertDiscoveredDocuments: async () => [],
    ...overrides,
  } as ContainerDocumentDiscoveryLane;
}

/** Lists `lanes` as the runtime does, reading and settling owed listings. */
function discover(
  lanes: ReadonlyArray<ContainerDocumentDiscoveryLane>,
  list: (containerId: string) => Promise<ListContainerDocumentsResponse | null>,
) {
  return discoverContainerDocumentLanes({
    generation: 1,
    lanes,
    listContainerDocumentLanes: laneLister((containerId) => list(containerId)),
    loadContainerDocumentWatermark: async () => null,
    loadOwedLaneListings: (containerIds) =>
      findOwedDocumentLaneListings(execSql, containerIds),
    settleOwedLaneListing: (owed) =>
      settleOwedDocumentLaneListing(execSql, owed),
  });
}

const owedContainerIds = async () =>
  [
    ...(await new DocumentLaneRevalidationRepository(
      execSql,
    ).listOwedContainerIds()),
  ].sort();

test("a listing that applies completely settles the request it read", async () => {
  await requestDocumentLaneListings(execSql, ["moved", "other"]);

  await discover([lane("moved")], async () => EMPTY_PAGE);

  // The lane that was listed is settled; the other is still owed.
  expect(await owedContainerIds()).toEqual(["other"]);
});

test("a request made while the listing is in flight stays owed", async () => {
  await requestDocumentLaneListings(execSql, ["moved"]);

  await discover([lane("moved")], async () => {
    // A tree listing is served the container's row again: this listing may
    // have been answered before the write behind it.
    await requestDocumentLaneListings(execSql, ["moved"]);
    return EMPTY_PAGE;
  });

  expect(await owedContainerIds()).toEqual(["moved"]);
});

interface UnsettledListing {
  readonly lane?: Partial<ContainerDocumentDiscoveryLane>;
  readonly list: () => Promise<ListContainerDocumentsResponse | null>;
  readonly name: string;
}

/** How one listing's verification ends. */
function verification(outcome: {
  readonly complete: boolean;
  readonly current: boolean;
}): Partial<ContainerDocumentDiscoveryLane> {
  return {
    verifyDiscoveredDocuments: async () => ({
      commit: async () => outcome.complete,
      inputs: [],
      isCurrent: async () => outcome.current,
    }),
  };
}

const UNSETTLED_LISTINGS: ReadonlyArray<UnsettledListing> = [
  { list: async () => null, name: "the server refuses" },
  {
    lane: verification({ complete: false, current: true }),
    list: async () => EMPTY_PAGE,
    name: "leaves a candidate pending",
  },
  {
    lane: verification({ complete: true, current: false }),
    list: async () => EMPTY_PAGE,
    name: "is superseded before it applies",
  },
];

for (const unsettled of UNSETTLED_LISTINGS) {
  test(`a listing that ${unsettled.name} leaves the lane owed`, async () => {
    await requestDocumentLaneListings(execSql, ["moved"]);

    await discover([lane("moved", unsettled.lane)], unsettled.list);

    expect(await owedContainerIds()).toEqual(["moved"]);
  });
}

test("a failed request leaves every lane it carried owed", async () => {
  await requestDocumentLaneListings(execSql, ["a", "b"]);

  const outcomes = await discover([lane("a"), lane("b")], async () => {
    throw new Error("request failed");
  });

  expect(outcomes.map((outcome) => outcome.status)).toEqual([
    "rejected",
    "rejected",
  ]);
  expect(await owedContainerIds()).toEqual(["a", "b"]);
});

test("a lane with nothing owed settles nothing", async () => {
  await requestDocumentLaneListings(execSql, ["other"]);

  await discover([lane("quiet")], async () => EMPTY_PAGE);

  expect(await owedContainerIds()).toEqual(["other"]);
});

test("a settle failure leaves the listing applied and the request owed", async () => {
  await requestDocumentLaneListings(execSql, ["moved"]);
  const failure = new Error("settle failed");
  const reported: unknown[] = [];

  const outcomes = await discoverContainerDocumentLanes({
    generation: 1,
    lanes: [lane("moved")],
    listContainerDocumentLanes: laneLister(async () => EMPTY_PAGE),
    loadContainerDocumentWatermark: async () => null,
    loadOwedLaneListings: (containerIds) =>
      findOwedDocumentLaneListings(execSql, containerIds),
    reportSettleFailure: (error) => reported.push(error),
    settleOwedLaneListing: async () => {
      throw failure;
    },
  });

  // The listing applied: rejecting it would retry it with a force and drop
  // its documents from the outcome.
  expect(outcomes).toEqual([
    { containerId: "moved", status: "fulfilled", value: [] },
  ]);
  expect(reported).toEqual([failure]);
  expect(await owedContainerIds()).toEqual(["moved"]);
});
