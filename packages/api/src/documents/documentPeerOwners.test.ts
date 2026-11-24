import { expect, test } from "bun:test";
import type { VersionVectorSpan } from "@tearleads/loro";
import { MAX_DOCUMENT_PEER_FRONTIERS } from "@tearleads/validators/response";
import {
  type DocumentUpdatePeers,
  judgeDocumentPeerSpans,
} from "./documentPeerOwners";

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
          { peerId: "1", startCounter: 0, endCounter: 5 },
          { peerId: "2", startCounter: 0, endCounter: 4 },
          { peerId: "3", startCounter: 0, endCounter: 2 },
          { peerId: "3", startCounter: 2, endCounter: 6 },
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
    (_, index) => `${index + 10}` as const,
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
          { peerId, startCounter: 0, endCounter: 2 },
          { peerId, startCounter: 2, endCounter: 3 },
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
  const ownSpan: VersionVectorSpan = {
    peerId: "9",
    startCounter: 0,
    endCounter: 2,
  };

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
    spans: [{ peerId: "9", startCounter: 0, endCounter: 3 }],
  };
  const second: DocumentUpdatePeers = {
    dependencies: [{ endCounter: 3, peerId: "9" }],
    spans: [{ peerId: "9", startCounter: 3, endCounter: 5 }],
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
          spans: [{ peerId: "1", startCounter: 2, endCounter: 3 }],
        },
      ],
      userId: writer,
    }),
  ).toEqual({
    kind: "peer_owned",
    peerFrontiers: [{ committedEndCounter: 2, peerId: "1" }],
  });
});
