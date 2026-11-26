// A rotation baseline that is not one whole group is refused on both
// rotation paths, and the refusal writes nothing.
import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  documentContentWriteHeaders,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { computeWriteHeaderHash } from "@tearleads/crypto";
import type {
  DocumentLinkSetMutationRequest,
  DocumentOutgoingUpdate,
} from "@tearleads/validators/request";
import {
  DOCUMENT_MUTATION_ERROR_CODES,
  DOCUMENT_SYNC_ERROR_CODES,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  expectNothingWritten,
  peerRanges,
  REFUSED_GROUPS,
  signerFor,
} from "../../../test/helpers/baselineGroupRefusals";
import {
  documentWithHistory,
  GROUP_INVALID,
  linkedForUnlink,
  NOT_WHOLE,
  postJson,
  storedUpdates,
} from "../../../test/helpers/baselineGroupRouteKit";
import { currentDocumentLinkRows } from "../../../test/helpers/currentDocumentLinks";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";
import { readWriteHeader } from "../../workflows/documents/mutations/shared/records";

test("a sync refuses a baseline that breaks a group rule and writes nothing", async () => {
  const history = await documentWithHistory();
  const { created, frontier, owner, root } = history;
  expect(peerRanges(frontier)).toHaveLength(3);
  const sign = signerFor(history, {
    accessManifestHash: created.manifestHash,
    contentKeyEpoch: created.contentKeyEpoch,
    dependencyManifestHashes: [root.bundle.manifestHash],
    targetHash: created.targetHash,
  });
  const trailing = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  const send = (outgoingUpdates: DocumentOutgoingUpdate[]) =>
    postDocumentSync(owner, created.id, {
      ...trailing.request,
      outgoingUpdates,
    });

  for (const refused of REFUSED_GROUPS) {
    const response = await send([
      ...(await refused.baseline({ frontier, sign })),
      ...trailing.request.outgoingUpdates,
    ]);
    expect([refused.name, response.status]).toEqual([refused.name, 409]);
    expect(await response.json()).toEqual({
      code: GROUP_INVALID,
      error: `${NOT_WHOLE}${refused.reason}`,
    });
    await expectNothingWritten(history);
  }

  // A group travels together: an ordinary update between two segments
  // would be committed inside the group.
  const [first, ...rest] = await sign({ ranges: peerRanges(frontier) });
  if (!first) throw new Error("Expected a segment");
  const interleaved = await send([
    first,
    ...trailing.request.outgoingUpdates,
    ...rest,
  ]);
  expect(interleaved.status).toBe(409);
  expect(await interleaved.json()).toEqual({
    code: GROUP_INVALID,
    error: `${NOT_WHOLE}other updates sit between its segments`,
  });
  await expectNothingWritten(history);

  // A whole group that stops short of the committed frontier is stale, not
  // malformed: the client proves its history again.
  const [onePeer] = peerRanges(frontier);
  if (!onePeer) throw new Error("Expected a range");
  const uncovering = await send(await sign({ ranges: [onePeer] }));
  expect(uncovering.status).toBe(409);
  expect(await uncovering.json()).toEqual({
    code: DOCUMENT_SYNC_ERROR_CODES.checkpointCoverageConflict,
    error:
      "Document content-key rotation baseline does not cover the committed frontier",
  });
  await expectNothingWritten(history);

  // The cursor is signed with the final segment: the same group sent with
  // another cursor is not the group its writer signed.
  const cursored = await sign({
    coversThroughUpdateId: history.committed[0]?.id,
    ranges: peerRanges(frontier),
  });
  const final = cursored.at(-1);
  if (!final) throw new Error("Expected a final segment");
  const moved = await send([
    ...cursored.slice(0, -1),
    { ...final, coversThroughUpdateId: history.committed[2]?.id },
  ]);
  expect(moved.status).toBe(400);
  expect((await moved.json()).error).toBe(
    "Document update metadata hash mismatch",
  );
  await expectNothingWritten(history);
});

test("a sync refuses a group of which only some segments are committed", async () => {
  const history = await documentWithHistory();
  const { committed, created, frontier, owner, root } = history;
  const sign = signerFor(history, {
    accessManifestHash: created.manifestHash,
    contentKeyEpoch: created.contentKeyEpoch,
    dependencyManifestHashes: [root.bundle.manifestHash],
    targetHash: created.targetHash,
  });
  const trailing = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  const send = (outgoingUpdates: DocumentOutgoingUpdate[]) =>
    postDocumentSync(owner, created.id, {
      ...trailing.request,
      outgoingUpdates,
    });
  const baselineId = crypto.randomUUID();
  const group = await sign({ baselineId, ranges: peerRanges(frontier) });
  expect((await send(group)).status).toBe(200);
  const written = committed.length + group.length;
  expect(await storedUpdates(created.id)).toHaveLength(written);

  // A new group under a committed group's baseline id collides with it on
  // the unique index over a baseline's segments.
  const sameId = await send(
    await sign({ baselineId, ranges: peerRanges(frontier) }),
  );
  expect(sameId.status).toBe(409);
  expect((await sameId.json()).error).toBe("Document sync write conflict");
  expect(await storedUpdates(created.id)).toHaveLength(written);

  // A group commits whole, so its rows are all there or none are. With one
  // row gone, sending the group again would insert that row beside the
  // rest: a group that was never written as one. It is refused instead.
  const lost = group[1]?.id;
  if (!lost) throw new Error("Expected a segment");
  await db
    .delete(documentContentWriteHeaders)
    .where(eq(documentContentWriteHeaders.updateId, lost));
  await db.delete(documentUpdates).where(eq(documentUpdates.id, lost));
  const partial = await send(group);
  expect(partial.status).toBe(409);
  expect(await partial.json()).toEqual({
    code: GROUP_INVALID,
    error: `${NOT_WHOLE}some of its segments are committed already`,
  });
  expect(await storedUpdates(created.id)).toHaveLength(written - 1);
});

test("an unlink refuses a baseline that breaks a group rule and changes nothing", async () => {
  const history = await documentWithHistory();
  const { created, frontier, owner } = history;
  const unlink = await linkedForUnlink(history);
  const honest = await unlink();
  const [path] = honest.authorizingContainerPathRefs;
  const sign = signerFor(history, {
    accessManifestHash: honest.contentKeyBundle.linkSetManifestHash,
    contentKeyEpoch: honest.contentKeyBundle.contentKeyEpoch,
    dependencyManifestHashes: (path ?? []).map((ref) => ref.manifestHash),
    targetHash: honest.contentKeyBundle.targetHash,
  });
  const send = (rotationBaseline: DocumentOutgoingUpdate[]) =>
    postJson(owner, `/documents/${created.id}/unlink`, {
      ...honest,
      rotationBaseline,
    } satisfies DocumentLinkSetMutationRequest);
  const expectUnchanged = async () => {
    await expectNothingWritten(history);
    expect(await currentDocumentLinkRows(created.id)).toHaveLength(2);
  };

  for (const refused of REFUSED_GROUPS) {
    const response = await send(await refused.baseline({ frontier, sign }));
    expect([refused.name, response.status]).toEqual([refused.name, 409]);
    expect(await response.json()).toEqual({
      code: GROUP_INVALID,
      error: `${NOT_WHOLE}${refused.reason}`,
    });
    await expectUnchanged();
  }

  // An ordinary update is no baseline.
  const [segment] = honest.rotationBaseline ?? [];
  if (!segment) throw new Error("Expected a segment");
  const {
    baselineId: _id,
    baselineSegmentCount: _count,
    baselineSegmentIndex: _index,
    baselineSegmentsDigest: _digest,
    ...ordinary
  } = segment;
  const unmarked = await send([ordinary]);
  expect(unmarked.status).toBe(409);
  expect((await unmarked.json()).code).toBe(GROUP_INVALID);
  await expectUnchanged();

  // A whole group of several segments that stops short of the frontier.
  const [onePeer, otherPeer] = peerRanges(frontier);
  if (!onePeer || !otherPeer) throw new Error("Expected ranges");
  const stale = await send(await sign({ ranges: [onePeer, otherPeer] }));
  expect(stale.status).toBe(409);
  expect(await stale.json()).toEqual({
    code: DOCUMENT_MUTATION_ERROR_CODES.unlinkRotationBaselineStale,
    error: "Document unlink rotation baseline is stale",
  });
  await expectUnchanged();

  // A segment whose update id is committed already cannot anchor an unlink:
  // the group would be written only in part.
  const whole = await sign({ ranges: peerRanges(frontier) });
  const [first] = whole;
  const committedId = history.committed[0]?.id;
  if (!first || !committedId) throw new Error("Expected a segment");
  await db
    .update(documentUpdates)
    .set({ id: first.id })
    .where(eq(documentUpdates.id, committedId));
  await db
    .update(documentContentWriteHeaders)
    .set({ updateId: first.id })
    .where(eq(documentContentWriteHeaders.updateId, committedId));
  const reused = await send(whole);
  expect(reused.status).toBe(409);
  expect(await storedUpdates(created.id)).toHaveLength(3);
  expect(await currentDocumentLinkRows(created.id)).toHaveLength(2);

  // The same holds when the committed row is that segment byte for byte: a
  // retry of it inserts nothing, so the unlink did not write the group whole.
  const header = readWriteHeader(first.writeHeader, "segment write header");
  await db
    .update(documentUpdates)
    .set({
      dependencyVersionVector: first.dependencyVersionVector,
      encryptedData: first.encryptedData,
      partialEndVersionVector: first.partialEndVersionVector,
      partialStartVersionVector: first.partialStartVersionVector,
      plaintextHash: first.plaintextHash,
    })
    .where(eq(documentUpdates.id, first.id));
  await db
    .update(documentContentWriteHeaders)
    .set({ header, headerHash: await computeWriteHeaderHash(header) })
    .where(eq(documentContentWriteHeaders.updateId, first.id));
  const identical = await send(whole);
  expect(identical.status).toBe(409);
  expect(await identical.json()).toEqual({
    error: "Document rotation baseline was not inserted",
  });
  expect(await storedUpdates(created.id)).toHaveLength(3);
  expect(await currentDocumentLinkRows(created.id)).toHaveLength(2);
});
