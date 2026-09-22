import { expect, test } from "bun:test";
import type {
  ContainerDocumentTombstone,
  ContainerDocumentTombstoneVerdict,
  VerifiedContainerDocumentTombstone,
} from "./documentDiscoveryTypes";
import { settleContainerDocumentTombstones } from "./documentTombstoneGate";

const tombstone = (
  documentId: string,
  containerId: string,
  updatedAt = "2026-09-20T00:00:00.000Z",
): ContainerDocumentTombstone => ({ containerId, documentId, updatedAt });

function createGateStore(
  verdictFor: (
    candidate: ContainerDocumentTombstone,
  ) => ContainerDocumentTombstoneVerdict,
  held: ContainerDocumentTombstone[] = [],
) {
  const calls = {
    applied: [] as ReadonlyArray<
      ContainerDocumentTombstone | VerifiedContainerDocumentTombstone
    >[],
    held: [] as ReadonlyArray<ContainerDocumentTombstone>[],
    listed: [] as ReadonlyArray<string>[],
    released: [] as ReadonlyArray<{
      containerId: string;
      documentId: string;
    }>[],
    verified: [] as ReadonlyArray<ContainerDocumentTombstone>[],
  };
  const store = {
    applyContainerDocumentTombstones: async (
      tombstones: ReadonlyArray<ContainerDocumentTombstone>,
    ) => {
      calls.applied.push(tombstones);
      return tombstones.map((entry) => ({
        containerId: null,
        documentId: entry.documentId,
        id: entry.documentId,
        title: entry.documentId,
        updatedAt: entry.updatedAt,
      }));
    },
    holdContainerDocumentTombstones: async (
      tombstones: ReadonlyArray<ContainerDocumentTombstone>,
    ) => {
      calls.held.push(tombstones);
    },
    listHeldContainerDocumentTombstones: async (
      containerIds: ReadonlyArray<string>,
    ) => {
      calls.listed.push(containerIds);
      return held;
    },
    releaseContainerDocumentTombstoneHolds: async (
      placements: ReadonlyArray<{ containerId: string; documentId: string }>,
    ) => {
      calls.released.push(placements);
    },
    verifyContainerDocumentTombstones: async (
      tombstones: ReadonlyArray<ContainerDocumentTombstone>,
    ) => {
      calls.verified.push(tombstones);
      return tombstones.map(verdictFor);
    },
  };
  return { calls, store };
}

test("a tombstone the verified head still links is dropped, never applied", async () => {
  const { calls, store } = createGateStore((candidate) => ({
    kind: "refuted",
    tombstone: candidate,
  }));

  const summaries = await settleContainerDocumentTombstones({
    containerIds: ["real-folder"],
    store,
    tombstones: [tombstone("doc", "real-folder")],
  });

  expect(summaries).toEqual([]);
  expect(calls.applied).toEqual([[]]);
  expect(calls.held).toEqual([]);
  expect(calls.released).toEqual([[tombstone("doc", "real-folder")]]);
});

test("a tombstone the verified head omits is applied with the head link set", async () => {
  const { calls, store } = createGateStore((candidate) => ({
    kind: "verified",
    tombstone: { ...candidate, linkedContainerIds: ["kept"] },
  }));

  const summaries = await settleContainerDocumentTombstones({
    containerIds: ["removed"],
    store,
    tombstones: [tombstone("doc", "removed")],
  });

  expect(summaries).toMatchObject([{ documentId: "doc" }]);
  expect(calls.applied).toEqual([
    [{ ...tombstone("doc", "removed"), linkedContainerIds: ["kept"] }],
  ]);
  expect(calls.held).toEqual([]);
  expect(calls.released).toEqual([]);
});

test("an unverifiable tombstone is held instead of applied", async () => {
  const { calls, store } = createGateStore((candidate) => ({
    kind: "unverified",
    tombstone: candidate,
  }));

  await settleContainerDocumentTombstones({
    containerIds: ["folder"],
    store,
    tombstones: [tombstone("doc", "folder")],
  });

  expect(calls.applied).toEqual([[]]);
  expect(calls.held).toEqual([[tombstone("doc", "folder")]]);
  expect(calls.released).toEqual([]);
});

test("held tombstones are retried with the listing and the newest timestamp wins", async () => {
  const older = tombstone("doc", "folder", "2026-09-19T00:00:00.000Z");
  const newer = tombstone("doc", "folder", "2026-09-21T00:00:00.000Z");
  const other = tombstone("other", "folder");
  const { calls, store } = createGateStore(
    (candidate) =>
      candidate.documentId === "doc"
        ? {
            kind: "verified",
            tombstone: { ...candidate, linkedContainerIds: [] },
          }
        : { kind: "unverified", tombstone: candidate },
    [newer, other],
  );

  await settleContainerDocumentTombstones({
    containerIds: ["folder"],
    store,
    tombstones: [older],
  });

  expect(calls.listed).toEqual([["folder"]]);
  expect(calls.verified).toEqual([[newer, other]]);
  expect(calls.applied).toEqual([[{ ...newer, linkedContainerIds: [] }]]);
  expect(calls.held).toEqual([[other]]);
});

test("nothing is verified when there are no tombstones or holds", async () => {
  const { calls, store } = createGateStore(() => {
    throw new Error("unreachable");
  });

  await settleContainerDocumentTombstones({
    containerIds: ["folder"],
    store,
    tombstones: [],
  });

  expect(calls.verified).toEqual([]);
  expect(calls.applied).toEqual([]);
});

test("a verifier that skips or duplicates a tombstone is rejected", async () => {
  const { store } = createGateStore((candidate) => ({
    kind: "unverified",
    tombstone: candidate,
  }));

  await expect(
    settleContainerDocumentTombstones({
      containerIds: ["folder"],
      store: {
        ...store,
        verifyContainerDocumentTombstones: async () => [],
      },
      tombstones: [tombstone("doc", "folder")],
    }),
  ).rejects.toThrow("one verdict per tombstone");
  await expect(
    settleContainerDocumentTombstones({
      containerIds: ["folder"],
      store: {
        ...store,
        verifyContainerDocumentTombstones: async (candidates) =>
          candidates.flatMap((candidate) => [
            { kind: "unverified", tombstone: candidate },
            { kind: "unverified", tombstone: candidate },
          ]),
      },
      tombstones: [tombstone("doc", "folder")],
    }),
  ).rejects.toThrow("one verdict per tombstone");
});
