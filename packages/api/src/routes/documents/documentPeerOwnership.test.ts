import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documentPeerOwners } from "@tearleads/api-shared/schema";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  isDocumentSyncErrorResponse,
} from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import {
  baselineSpan,
  committedUpdateIds,
  peerOwner,
  peerSpan,
  sharedWriterDocument,
  syncPeerSpans,
} from "../../../test/helpers/documentPeerOwnership";

const ownerPeer = "900";
const otherOwnerPeer = "1000";
const freshPeer = "777";

test("another user may re-assert a peer's committed counters", async () => {
  const fixture = await sharedWriterDocument();
  const { owner, writer } = fixture;
  expect(
    (await syncPeerSpans(fixture, owner, [peerSpan(ownerPeer, 0, 5)])).response
      .status,
  ).toBe(200);

  const reassertion = await syncPeerSpans(fixture, writer, [
    peerSpan(ownerPeer, 2, 5),
  ]);

  expect(reassertion.response.status).toBe(200);
  expect(await committedUpdateIds(reassertion.updateIds)).toHaveLength(1);
  expect(await peerOwner(fixture.created.id, ownerPeer)).toBe(owner.userId);
}, 30_000);

test("extending an unowned peer claims it for the writer, who may extend it again", async () => {
  const fixture = await sharedWriterDocument();
  const { writer } = fixture;

  const claim = await syncPeerSpans(fixture, writer, [
    peerSpan(freshPeer, 0, 3),
  ]);
  expect(claim.response.status).toBe(200);
  expect(await peerOwner(fixture.created.id, freshPeer)).toBe(writer.userId);

  const extension = await syncPeerSpans(fixture, writer, [
    peerSpan(freshPeer, 3, 8),
  ]);
  expect(extension.response.status).toBe(200);
  expect(await committedUpdateIds(extension.updateIds)).toHaveLength(1);
}, 30_000);

test("extending another user's peers is refused with their committed frontiers, and nothing commits", async () => {
  const fixture = await sharedWriterDocument();
  const { owner, writer } = fixture;
  expect(
    (
      await syncPeerSpans(fixture, owner, [
        peerSpan(ownerPeer, 0, 5),
        peerSpan(otherOwnerPeer, 0, 2),
      ])
    ).response.status,
  ).toBe(200);

  // The first update alone would claim a fresh peer; the refusal rolls it
  // back with the two that extend the owner's peers.
  const refused = await syncPeerSpans(fixture, writer, [
    peerSpan(freshPeer, 0, 2),
    peerSpan(ownerPeer, 3, 8),
    peerSpan(otherOwnerPeer, 1, 4),
  ]);

  expect(refused.response.status).toBe(409);
  const body = await refused.response.json();
  expect(isDocumentSyncErrorResponse(body)).toBe(true);
  expect(body).toEqual({
    code: DOCUMENT_SYNC_ERROR_CODES.peerOwned,
    error: "Document peer is owned by another user",
    peerFrontiers: [
      { committedEndCounter: 2, peerId: otherOwnerPeer },
      { committedEndCounter: 5, peerId: ownerPeer },
    ],
  });
  expect(await committedUpdateIds(refused.updateIds)).toEqual([]);
  expect(await peerOwner(fixture.created.id, freshPeer)).toBeNull();
}, 30_000);

test("one request may chain updates on a new peer", async () => {
  const fixture = await sharedWriterDocument();
  const { writer } = fixture;

  const chained = await syncPeerSpans(fixture, writer, [
    peerSpan(freshPeer, 0, 3),
    peerSpan(freshPeer, 3, 6),
    peerSpan(freshPeer, 6, 7),
  ]);

  expect(chained.response.status).toBe(200);
  expect(await committedUpdateIds(chained.updateIds)).toHaveLength(3);
  expect(await peerOwner(fixture.created.id, freshPeer)).toBe(writer.userId);
}, 30_000);

test("a rotation baseline re-asserts every user's peers but cannot extend another user's", async () => {
  const fixture = await sharedWriterDocument();
  const { owner, writer } = fixture;
  expect(
    (await syncPeerSpans(fixture, owner, [peerSpan(ownerPeer, 0, 5)])).response
      .status,
  ).toBe(200);
  expect(
    (await syncPeerSpans(fixture, writer, [peerSpan(freshPeer, 0, 3)])).response
      .status,
  ).toBe(200);

  const covering = await syncPeerSpans(
    fixture,
    writer,
    [baselineSpan({ [freshPeer]: 3, [ownerPeer]: 5 })],
    { checkpoint: true },
  );
  expect(covering.response.status).toBe(200);

  const extending = await syncPeerSpans(
    fixture,
    writer,
    [baselineSpan({ [freshPeer]: 3, [ownerPeer]: 7 })],
    { checkpoint: true },
  );
  expect(extending.response.status).toBe(409);
  expect(await extending.response.json()).toMatchObject({
    code: DOCUMENT_SYNC_ERROR_CODES.peerOwned,
    peerFrontiers: [{ committedEndCounter: 5, peerId: ownerPeer }],
  });
  expect(await committedUpdateIds(extending.updateIds)).toEqual([]);
}, 30_000);

test("a peer with spans but no owner row is never claimed by a re-assertion", async () => {
  const fixture = await sharedWriterDocument();
  const { owner, writer } = fixture;
  expect(
    (await syncPeerSpans(fixture, owner, [peerSpan(ownerPeer, 0, 5)])).response
      .status,
  ).toBe(200);
  await db
    .delete(documentPeerOwners)
    .where(
      and(
        eq(documentPeerOwners.documentId, fixture.created.id),
        eq(documentPeerOwners.peerId, ownerPeer),
      ),
    );

  expect(
    (await syncPeerSpans(fixture, writer, [peerSpan(ownerPeer, 0, 5)])).response
      .status,
  ).toBe(200);
  expect(await peerOwner(fixture.created.id, ownerPeer)).toBeNull();

  expect(
    (await syncPeerSpans(fixture, writer, [peerSpan(ownerPeer, 5, 6)])).response
      .status,
  ).toBe(200);
  expect(await peerOwner(fixture.created.id, ownerPeer)).toBe(writer.userId);
}, 30_000);

test("an owned peer with no committed spans refuses another user from counter 0", async () => {
  const fixture = await sharedWriterDocument();
  const { owner, writer } = fixture;
  await db.insert(documentPeerOwners).values({
    documentId: fixture.created.id,
    ownerUserId: owner.userId,
    peerId: ownerPeer,
  });

  const refused = await syncPeerSpans(fixture, writer, [
    peerSpan(ownerPeer, 0, 1),
  ]);

  expect(refused.response.status).toBe(409);
  expect(await refused.response.json()).toMatchObject({
    code: DOCUMENT_SYNC_ERROR_CODES.peerOwned,
    peerFrontiers: [{ committedEndCounter: 0, peerId: ownerPeer }],
  });
}, 30_000);
