import { expect, test } from "bun:test";
import { MAX_DOCUMENT_PEER_FRONTIERS } from "@tearleads/validators/response";
import { judgeDocumentPeerSpans } from "./documentPeerOwners";

const writer = "writer-user";
const other = "other-user";

test("the walk raises each frontier, so only a span past it needs ownership", () => {
  const verdict = judgeDocumentPeerSpans({
    committedPeers: new Map([
      ["1", { committedEndCounter: 5, ownerUserId: other }],
      ["2", { committedEndCounter: 4, ownerUserId: null }],
    ]),
    spans: [
      { peerId: "1", startCounter: 0, endCounter: 5 },
      { peerId: "2", startCounter: 0, endCounter: 4 },
      { peerId: "3", startCounter: 0, endCounter: 2 },
      { peerId: "3", startCounter: 2, endCounter: 6 },
    ],
    userId: writer,
  });

  expect(verdict).toEqual({ claimedPeerIds: ["3"], refused: [] });
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
    spans: peerIds.flatMap((peerId) => [
      { peerId, startCounter: 0, endCounter: 2 },
      { peerId, startCounter: 2, endCounter: 3 },
    ]),
    userId: writer,
  });

  const expected = [...peerIds]
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .slice(0, MAX_DOCUMENT_PEER_FRONTIERS)
    .map((peerId) => ({ committedEndCounter: 1, peerId }));
  expect(verdict.refused).toEqual(expected);
});
