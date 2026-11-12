import { expect, test } from "bun:test";
import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import type { PrincipalPolicyStateChainEntryResponse } from "@tearleads/validators/response";
import {
  initialRosterAdmissionScan,
  nextRosterAdmissionPage,
  type RosterAdmissionScanState,
  transitionRosterAdmissionScan,
} from "./rosterAdmissionScanMachine";

const head: ReferencedPrincipalHead = {
  principalType: "group",
  principalId: "members-1",
  version: 4,
  stateHash: "h4",
  keyEpoch: 1,
  keyFingerprint: "k1",
};

/** A hash-linked entry: only the fields the scan reads are meaningful. */
function entry(version: number, principalId = head.principalId) {
  return {
    state: {
      principalType: "group",
      principalId,
      version,
      stateHash: `h${version}`,
      prevStateHash: version === 1 ? null : `h${version - 1}`,
    },
    projection: [],
    grants: [],
  } as unknown as PrincipalPolicyStateChainEntryResponse;
}

/** Ascending entries, as a page serves them. */
function page(versions: number[], nextBeforeVersion: number | null) {
  return {
    entries: versions.map((version) => entry(version)),
    predecessor: null,
    nextBeforeVersion,
  };
}

function loaded(
  state: RosterAdmissionScanState,
  served: ReturnType<typeof page>,
) {
  return transitionRosterAdmissionScan(
    transitionRosterAdmissionScan(state, { type: "pageRequested" }),
    { type: "pageLoaded", page: served },
  );
}

const versions = (state: RosterAdmissionScanState) =>
  state.entries.map(({ state: chained }) => chained.version);

test("a linked page advances the cursor and a final page ends the scan", () => {
  const first = loaded(initialRosterAdmissionScan(head), page([3, 4], 3));
  expect(first).toMatchObject({
    status: "scanning",
    beforeVersion: 3,
    expectedVersion: 2,
    expectedHash: "h2",
    pagesRequested: 1,
  });
  expect(versions(first)).toEqual([4, 3]);
  expect(nextRosterAdmissionPage(first)).toEqual({ beforeVersion: 3 });
  const genesis = loaded(first, page([1, 2], 1));
  expect(genesis.status).toBe("ended");
  expect(versions(genesis)).toEqual([4, 3, 2, 1]);
  expect(nextRosterAdmissionPage(genesis)).toBeNull();
  const last = loaded(first, page([2], null));
  expect(last.status).toBe("ended");
  expect(versions(last)).toEqual([4, 3, 2]);
});

test("a rejected page ends the scan and keeps only accepted entries", () => {
  const first = loaded(initialRosterAdmissionScan(head), page([3, 4], 3));
  const rejections = {
    empty: page([], 2),
    oversized: page(
      Array.from({ length: 33 }, () => 2),
      2,
    ),
    unlinked: page([1, 3], 1),
    foreign: {
      entries: [entry(2, "members-2")],
      predecessor: null,
      nextBeforeVersion: 2,
    },
    repeated: page([2], 3),
  };
  for (const served of Object.values(rejections)) {
    const rejected = loaded(first, served);
    expect(rejected).toEqual({ status: "ended", entries: first.entries });
    expect(nextRosterAdmissionPage(rejected)).toBeNull();
  }
});

test("an ended scan ignores every event", () => {
  const ended = loaded(initialRosterAdmissionScan(head), page([], 4));
  expect(transitionRosterAdmissionScan(ended, { type: "pageRequested" })).toBe(
    ended,
  );
  expect(
    transitionRosterAdmissionScan(ended, {
      type: "pageLoaded",
      page: page([3, 4], 3),
    }),
  ).toBe(ended);
});

test("the page budget stops reads without ending the accepted scan", () => {
  let state = initialRosterAdmissionScan({ ...head, version: 200 });
  for (let read = 0; read < 64; read += 1)
    state = transitionRosterAdmissionScan(state, { type: "pageRequested" });
  expect(state.status).toBe("scanning");
  expect(nextRosterAdmissionPage(state)).toBeNull();
});
