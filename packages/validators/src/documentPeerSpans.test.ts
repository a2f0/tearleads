import { expect, test } from "bun:test";
import {
  compareDocumentPeerIds,
  type DocumentPeerSpan,
  type DocumentUpdatePeers,
  judgeDocumentPeerSpans,
} from "./documentPeerSpans";
import { MAX_DOCUMENT_PEER_FRONTIERS } from "./response/documentSyncError";

const writer = "writer-user";
const other = "other-user";

test("the walk raises each frontier, so only a span past it needs ownership", () => {
  const verdict = judgeDocumentPeerSpans({
    committedPeers: new Map([
      ["1", { committedEndCounter: 5, ownerUserId: other }],
      ["2", { committedEndCounter: 4, ownerUserId: null }],
    ]),
    updates: [
      {
        dependencies: [],
        spans: [
          { peerId: "1", endCounter: 5 },
          { peerId: "2", endCounter: 4 },
          { peerId: "3", endCounter: 2 },
          { peerId: "3", endCounter: 6 },
        ],
      },
    ],
    userId: writer,
  });

  expect(verdict).toEqual({ claimedPeerIds: ["3"], kind: "accepted" });
});

test("refused peers are named once each, in canonical order, at most the wire bound", () => {
  const peerIds = Array.from(
    { length: MAX_DOCUMENT_PEER_FRONTIERS + 2 },
    (_, index) => `${index + 10}`,
  );
  const verdict = judgeDocumentPeerSpans({
    committedPeers: new Map(
      peerIds.map((peerId) => [
        peerId,
        { committedEndCounter: 1, ownerUserId: other },
      ]),
    ),
    updates: [
      {
        dependencies: [],
        spans: peerIds.flatMap((peerId) => [
          { peerId, endCounter: 2 },
          { peerId, endCounter: 3 },
        ]),
      },
    ],
    userId: writer,
  });

  const expected = [...peerIds]
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .slice(0, MAX_DOCUMENT_PEER_FRONTIERS)
    .map((peerId) => ({ committedEndCounter: 1, peerId }));
  expect(verdict).toEqual({ kind: "peer_owned", peerFrontiers: expected });
});

test("a dependency on a committed op passes, and one past the frontier is refused", () => {
  const committedPeers = new Map([
    ["7", { committedEndCounter: 4, ownerUserId: other }],
  ]);
  const ownSpan: DocumentPeerSpan = { peerId: "9", endCounter: 2 };

  expect(
    judgeDocumentPeerSpans({
      committedPeers,
      updates: [
        { dependencies: [{ endCounter: 4, peerId: "7" }], spans: [ownSpan] },
      ],
      userId: writer,
    }),
  ).toEqual({ claimedPeerIds: ["9"], kind: "accepted" });

  // The op the owner would write next: nobody committed it, so readers who
  // lack it could never import the update. The request claims nothing.
  expect(
    judgeDocumentPeerSpans({
      committedPeers,
      updates: [
        { dependencies: [{ endCounter: 5, peerId: "7" }], spans: [ownSpan] },
      ],
      userId: writer,
    }),
  ).toEqual({
    kind: "dependency_uncommitted",
    peerFrontiers: [{ committedEndCounter: 4, peerId: "7" }],
  });

  // A peer nothing has committed on has a frontier of zero.
  expect(
    judgeDocumentPeerSpans({
      committedPeers: new Map(),
      updates: [
        { dependencies: [{ endCounter: 1, peerId: "8" }], spans: [ownSpan] },
      ],
      userId: writer,
    }),
  ).toEqual({
    kind: "dependency_uncommitted",
    peerFrontiers: [{ committedEndCounter: 0, peerId: "8" }],
  });
});

test("an update may depend on an earlier update of its request, never a later one", () => {
  const first: DocumentUpdatePeers = {
    dependencies: [],
    spans: [{ peerId: "9", endCounter: 3 }],
  };
  const second: DocumentUpdatePeers = {
    dependencies: [{ endCounter: 3, peerId: "9" }],
    spans: [{ peerId: "9", endCounter: 5 }],
  };

  expect(
    judgeDocumentPeerSpans({
      committedPeers: new Map(),
      updates: [first, second],
      userId: writer,
    }),
  ).toEqual({ claimedPeerIds: ["9"], kind: "accepted" });
  expect(
    judgeDocumentPeerSpans({
      committedPeers: new Map(),
      updates: [second, first],
      userId: writer,
    }),
  ).toEqual({
    kind: "dependency_uncommitted",
    peerFrontiers: [{ committedEndCounter: 0, peerId: "9" }],
  });
});

test("a peer another user owns outranks an uncommitted dependency", () => {
  expect(
    judgeDocumentPeerSpans({
      committedPeers: new Map([
        ["1", { committedEndCounter: 2, ownerUserId: other }],
      ]),
      updates: [
        {
          dependencies: [{ endCounter: 9, peerId: "5" }],
          spans: [{ peerId: "1", endCounter: 3 }],
        },
      ],
      userId: writer,
    }),
  ).toEqual({
    kind: "peer_owned",
    peerFrontiers: [{ committedEndCounter: 2, peerId: "1" }],
  });
});

test("a recovery owner may restore a foreign peer within its restorable window without claiming it", () => {
  const recoveryOwner = "recovery-owner";
  const committedPeers = new Map([
    [
      "11",
      {
        allowMemberRestore: false,
        committedEndCounter: 2,
        ownerUserId: other,
        recoveryOwnerUserId: recoveryOwner,
        restorableEndCounter: 5,
      },
    ],
  ]);

  expect(
    judgeDocumentPeerSpans({
      committedPeers,
      updates: [{ dependencies: [], spans: [{ peerId: "11", endCounter: 5 }] }],
      userId: recoveryOwner,
    }),
  ).toEqual({ claimedPeerIds: [], kind: "accepted" });

  // Past the pre-purge frontier, even the recovery owner is refused.
  expect(
    judgeDocumentPeerSpans({
      committedPeers,
      updates: [{ dependencies: [], spans: [{ peerId: "11", endCounter: 6 }] }],
      userId: recoveryOwner,
    }),
  ).toEqual({
    kind: "peer_owned",
    peerFrontiers: [{ committedEndCounter: 2, peerId: "11" }],
  });

  // Another member is refused while allowMemberRestore is false.
  expect(
    judgeDocumentPeerSpans({
      committedPeers,
      updates: [{ dependencies: [], spans: [{ peerId: "11", endCounter: 5 }] }],
      userId: writer,
    }),
  ).toEqual({
    kind: "peer_owned",
    peerFrontiers: [{ committedEndCounter: 2, peerId: "11" }],
  });
});

test("member restore allows any writer up to the restorable frontier without transferring ownership", () => {
  const committedPeers = new Map([
    [
      "11",
      {
        allowMemberRestore: true,
        committedEndCounter: 0,
        ownerUserId: other,
        recoveryOwnerUserId: "recovery-owner",
        restorableEndCounter: 4,
      },
    ],
  ]);

  expect(
    judgeDocumentPeerSpans({
      committedPeers,
      updates: [{ dependencies: [], spans: [{ peerId: "11", endCounter: 4 }] }],
      userId: writer,
    }),
  ).toEqual({ claimedPeerIds: [], kind: "accepted" });

  expect(
    judgeDocumentPeerSpans({
      committedPeers,
      updates: [{ dependencies: [], spans: [{ peerId: "11", endCounter: 5 }] }],
      userId: writer,
    }),
  ).toEqual({
    kind: "peer_owned",
    peerFrontiers: [{ committedEndCounter: 0, peerId: "11" }],
  });

  // The rightful owner still owns the peer past the restorable frontier.
  expect(
    judgeDocumentPeerSpans({
      committedPeers,
      updates: [{ dependencies: [], spans: [{ peerId: "11", endCounter: 7 }] }],
      userId: other,
    }),
  ).toEqual({ claimedPeerIds: [], kind: "accepted" });
});

test("compareDocumentPeerIds orders strings by code unit", () => {
  expect(["10", "2", "1", "100", "9"].sort(compareDocumentPeerIds)).toEqual([
    "1",
    "10",
    "100",
    "2",
    "9",
  ]);
});
