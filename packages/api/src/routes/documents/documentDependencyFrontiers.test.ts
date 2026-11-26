import { expect, test } from "bun:test";
import { encodeVersionVectorCounters } from "@tearleads/loro";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  isDocumentSyncErrorResponse,
  MAX_DOCUMENT_PEER_FRONTIERS,
} from "@tearleads/validators/response";
import {
  baselineSpan,
  committedUpdateIds,
  dependingOn,
  peerOwner,
  peerSpan,
  sharedWriterDocument,
  syncPeerSpans,
} from "../../../test/helpers/documentPeerOwnership";

const ownerPeer = "900";
const freshPeer = "777";

test("an update may depend on committed operations of another user's peer", async () => {
  const fixture = await sharedWriterDocument();
  const { owner, writer } = fixture;
  expect(
    (await syncPeerSpans(fixture, owner, [peerSpan(ownerPeer, 0, 5)])).response
      .status,
  ).toBe(200);

  const built = await syncPeerSpans(fixture, writer, [
    dependingOn(peerSpan(freshPeer, 0, 2), { [ownerPeer]: 5 }),
  ]);

  expect(built.response.status).toBe(200);
  expect(await committedUpdateIds(built.updateIds)).toHaveLength(1);
}, 30_000);

test("an update depending on another user's next operation is refused with its frontier, and nothing commits", async () => {
  const fixture = await sharedWriterDocument();
  const { owner, writer } = fixture;
  expect(
    (await syncPeerSpans(fixture, owner, [peerSpan(ownerPeer, 0, 5)])).response
      .status,
  ).toBe(200);

  // Its spans name only a fresh peer, which ownership alone would let it
  // claim; the owner holds counter 5 unsent, so no other reader could
  // import it.
  const forged = await syncPeerSpans(fixture, writer, [
    dependingOn(peerSpan(freshPeer, 0, 2), { [ownerPeer]: 6 }),
  ]);

  expect(forged.response.status).toBe(409);
  const body = await forged.response.json();
  expect(isDocumentSyncErrorResponse(body)).toBe(true);
  expect(body).toEqual({
    code: DOCUMENT_SYNC_ERROR_CODES.dependencyUncommitted,
    error: "Document update depends on an uncommitted operation",
    peerFrontiers: [{ committedEndCounter: 5, peerId: ownerPeer }],
  });
  expect(await committedUpdateIds(forged.updateIds)).toEqual([]);
  expect(await peerOwner(fixture.created.id, freshPeer)).toBeNull();
}, 30_000);

test("an update may depend on an earlier update of its request, never a later one", async () => {
  const fixture = await sharedWriterDocument();
  const { writer } = fixture;
  const first = peerSpan(freshPeer, 0, 3);
  const second = dependingOn(peerSpan(freshPeer, 3, 5), { [freshPeer]: 3 });

  const reversed = await syncPeerSpans(fixture, writer, [second, first]);
  expect(reversed.response.status).toBe(409);
  expect(await reversed.response.json()).toMatchObject({
    code: DOCUMENT_SYNC_ERROR_CODES.dependencyUncommitted,
    peerFrontiers: [{ committedEndCounter: 0, peerId: freshPeer }],
  });

  const ordered = await syncPeerSpans(fixture, writer, [first, second]);
  expect(ordered.response.status).toBe(200);
  expect(await committedUpdateIds(ordered.updateIds)).toHaveLength(2);
}, 30_000);

// A baseline carries a history from nothing, so its first segment depends on
// nothing: a dependency no earlier segment carries fails the group rule.
test("a rotation baseline that depends on operations outside it is refused", async () => {
  const fixture = await sharedWriterDocument();
  const { writer } = fixture;
  expect(
    (await syncPeerSpans(fixture, writer, [peerSpan(freshPeer, 0, 3)])).response
      .status,
  ).toBe(200);

  const baseline = await syncPeerSpans(
    fixture,
    writer,
    [dependingOn(baselineSpan({ [freshPeer]: 3 }), { [freshPeer]: 3 })],
    { checkpoint: true },
  );

  expect(baseline.response.status).toBe(409);
  expect(await baseline.response.json()).toEqual({
    code: DOCUMENT_SYNC_ERROR_CODES.baselineGroupInvalid,
    error:
      "Document rotation baseline is not one whole group: the segments do not carry each peer's operations gapless from zero, each depending only on earlier segments",
  });
  expect(await committedUpdateIds(baseline.updateIds)).toEqual([]);
}, 30_000);

test("a dependency vector that does not decode is refused", async () => {
  const fixture = await sharedWriterDocument();
  const { writer } = fixture;

  const garbled = await syncPeerSpans(fixture, writer, [
    {
      ...peerSpan(freshPeer, 0, 2),
      dependencyVersionVector: `${encodeVersionVectorCounters({ [ownerPeer]: 1 })}!`,
    },
  ]);

  expect(garbled.response.status).toBe(400);
  expect(await garbled.response.json()).toMatchObject({
    error: "Document update dependency version vector is invalid",
  });
}, 30_000);

test("a dependency vector naming more peers than one statement can bind is still judged", async () => {
  const fixture = await sharedWriterDocument();
  // Postgres binds at most 65,535 parameters to one statement, and the read
  // names each peer twice; the byte ceiling admits far more peers than that.
  const peerCount = 40_000;
  const ends = Object.fromEntries(
    Array.from({ length: peerCount }, (_, index) => [`${index + 1000}`, 1]),
  );

  const refused = await syncPeerSpans(fixture, fixture.writer, [
    dependingOn(peerSpan(freshPeer, 0, 2), ends),
  ]);

  expect(refused.response.status).toBe(409);
  const body = await refused.response.json();
  expect(body).toMatchObject({
    code: DOCUMENT_SYNC_ERROR_CODES.dependencyUncommitted,
  });
  expect(body.peerFrontiers).toHaveLength(MAX_DOCUMENT_PEER_FRONTIERS);
}, 60_000);
