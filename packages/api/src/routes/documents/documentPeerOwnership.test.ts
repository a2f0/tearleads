import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  documentPeerOwners,
  purgedDocumentPeerOwners,
  users,
} from "@tearleads/api-shared/schema";
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
import { routeApp } from "../../routeApp";
import {
  restorePurgedDocumentPeerOwners,
  snapshotPurgedDocumentPeerOwners,
} from "../../workflows/billing/purgedObjectReservations";

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

test("post-purge restored peer owners preserve ownership, cap recovery restore, and gate member restore behind owner authorization", async () => {
  const fixture = await sharedWriterDocument();
  const { owner, writer } = fixture;
  const memberPeer = "555";
  const thirdUserId = crypto.randomUUID();

  const [ownerRow] = await db
    .select({ defaultOrganizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, owner.userId))
    .limit(1);
  if (!ownerRow) throw new Error("Expected owner row");
  const organizationId = ownerRow.defaultOrganizationId;

  // Member commits counters 0..5 on memberPeer before a billing purge.
  expect(
    (await syncPeerSpans(fixture, writer, [peerSpan(memberPeer, 0, 5)]))
      .response.status,
  ).toBe(200);
  expect(await peerOwner(fixture.created.id, memberPeer)).toBe(writer.userId);

  // Snapshot pre-purge peer owners, simulate purge delete, and restore on recreation.
  await db.transaction(async (tx) => {
    await snapshotPurgedDocumentPeerOwners({
      documentIds: [fixture.created.id],
      executor: tx,
      organizationId,
    });
    await tx
      .delete(documentPeerOwners)
      .where(eq(documentPeerOwners.documentId, fixture.created.id));
  });
  const [snapshotted] = await db
    .select()
    .from(purgedDocumentPeerOwners)
    .where(
      and(
        eq(purgedDocumentPeerOwners.documentId, fixture.created.id),
        eq(purgedDocumentPeerOwners.peerId, memberPeer),
      ),
    );
  expect(snapshotted).toMatchObject({
    ownerUserId: writer.userId,
    purgedEndCounter: 5,
    recoveryOwnerUserId: owner.userId,
  });

  // Restore into a fresh document row with a foreign owner on peer "888" (no spans yet).
  const restoredPeer = "888";
  await db.transaction(async (tx) => {
    const restored = await restorePurgedDocumentPeerOwners(tx, {
      documentId: fixture.created.id,
      recoveryOwnerUserId: owner.userId,
    });
    expect(restored).toBe(true);
    await tx.insert(documentPeerOwners).values({
      allowMemberRestore: false,
      documentId: fixture.created.id,
      ownerUserId: thirdUserId,
      peerId: restoredPeer,
      recoveryOwnerUserId: owner.userId,
      restorableEndCounter: 4,
    });
  });

  // Recovery owner can restore counters 0..3 on thirdUserId's peer without claiming it.
  expect(
    (await syncPeerSpans(fixture, owner, [peerSpan(restoredPeer, 0, 3)]))
      .response.status,
  ).toBe(200);
  expect(await peerOwner(fixture.created.id, restoredPeer)).toBe(thirdUserId);

  // Recovery owner cannot extend past restorableEndCounter (4).
  expect(
    (await syncPeerSpans(fixture, owner, [peerSpan(restoredPeer, 3, 5)]))
      .response.status,
  ).toBe(409);

  // Another member (writer) cannot restore restoredPeer while allow_member_restore is false.
  expect(
    (await syncPeerSpans(fixture, writer, [peerSpan(restoredPeer, 3, 4)]))
      .response.status,
  ).toBe(409);

  // Non-owner member is forbidden from calling allow-restore.
  const memberAttempt = await routeApp.request(
    `/documents/${fixture.created.id}/peer-owners/allow-restore`,
    {
      body: JSON.stringify({ allowMemberRestore: true }),
      headers: {
        authorization: `Bearer ${writer.token}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
  );
  expect(memberAttempt.status).toBe(403);

  // Personal organization owner authorizes member restore.
  const ownerEnable = await routeApp.request(
    `/documents/${fixture.created.id}/peer-owners/allow-restore`,
    {
      body: JSON.stringify({ allowMemberRestore: true }),
      headers: {
        authorization: `Bearer ${owner.token}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
  );
  expect(ownerEnable.status).toBe(200);
  expect(await ownerEnable.json()).toEqual({
    allowMemberRestore: true,
    documentId: fixture.created.id,
    updatedPeerCount: 2,
  });

  // Now writer can restore counters 3..4 without hijacking ownership from thirdUserId,
  // and is still refused past restorableEndCounter (4).
  expect(
    (await syncPeerSpans(fixture, writer, [peerSpan(restoredPeer, 3, 4)]))
      .response.status,
  ).toBe(200);
  expect(await peerOwner(fixture.created.id, restoredPeer)).toBe(thirdUserId);
  expect(
    (await syncPeerSpans(fixture, writer, [peerSpan(restoredPeer, 4, 5)]))
      .response.status,
  ).toBe(409);

  // Repeated purge snapshot preserves GREATEST(restorableEndCounter, max span) = 5.
  await db.transaction(async (tx) => {
    await snapshotPurgedDocumentPeerOwners({
      documentIds: [fixture.created.id],
      executor: tx,
      organizationId,
    });
  });
  const [resnapshotted] = await db
    .select()
    .from(purgedDocumentPeerOwners)
    .where(
      and(
        eq(purgedDocumentPeerOwners.documentId, fixture.created.id),
        eq(purgedDocumentPeerOwners.peerId, restoredPeer),
      ),
    );
  expect(resnapshotted?.purgedEndCounter).toBe(4);
}, 30_000);
