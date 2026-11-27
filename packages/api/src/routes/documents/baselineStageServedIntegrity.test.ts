// The server finds the latest whole baseline by its stored structure
// (indexes, counts, spans) and starts a new reader at it without
// authenticating its rows again. What it serves is still checked row by
// row: a baseline whose stored update rows no longer give what their writer
// signed is refused whole, as a conflict, and the reader is served no part
// of it and nothing else in its place. A span row is covered by no
// signature, so one altered in the database is not detected: the second
// test pins what the server then does.
import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  documentBaselineSegments,
  documentUpdateSpans,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { decodeVersionVector } from "@tearleads/loro";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  documentWithHistory,
  linkedForUnlink,
  postJson,
  pullAsNewReader,
} from "../../../test/helpers/baselineGroupRouteKit";
import { stageAllButFinal } from "../../../test/helpers/baselineStageKit";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";
import { readStoredBaselineGroupCoverage } from "../../documents/documentStoredBaselineGroup";

/** A rotation that committed a staged baseline of three segments. */
async function committedStagedBaseline() {
  const history = await documentWithHistory();
  const { created, owner } = history;
  // A rotation: the committed history is the rotated-away epoch's, and the
  // staged baseline carries it at the new one.
  const request = await (await linkedForUnlink(history))({
    rotationBaselineSegments: 3,
  });
  const group = request.rotationBaseline ?? [];
  const { baselineStageId, final, staged } = await stageAllButFinal(
    owner,
    created.id,
    group,
    { contentKeyEpoch: request.contentKeyBundle.contentKeyEpoch },
  );
  const response = await postJson(owner, `/documents/${created.id}/unlink`, {
    ...request,
    baselineStageId,
    rotationBaseline: [final],
  });
  expect(response.status).toBe(200);
  const unlinked = await response.json();
  const coldPull = () =>
    postDocumentSync(owner, created.id, {
      contentKeyEpoch: unlinked.contentKeyEpoch,
      expectedLinkSetManifestHash: unlinked.manifestHash,
      expectedTargetHash: unlinked.targetHash,
      localVersionVector: null,
      maxPageUpdates: 64,
      outgoingUpdates: [],
      supportsPullPagination: true,
    } satisfies DocumentSyncRequest);
  const servedIds = async () =>
    (await pullAsNewReader(owner, created.id, unlinked, 64))
      .flatMap((page) => page.updates)
      .map((update) => update.id);
  const groupIds = group.map((segment) => segment.id);
  expect(await servedIds()).toEqual(groupIds);
  return { coldPull, created, group, groupIds, servedIds, staged };
}

test("a committed baseline whose stored rows were altered is refused whole, and a missing payload is a coded conflict", async () => {
  const { coldPull, groupIds, servedIds, staged } =
    await committedStagedBaseline();
  const [, middle] = staged;
  if (!middle) throw new Error("Expected two staged segments");
  const alter = (values: Partial<typeof documentUpdates.$inferInsert>) =>
    db
      .update(documentUpdates)
      .set(values)
      .where(eq(documentUpdates.id, middle.id));
  // One committed row of the group altered in the database, in a field its
  // writer signed. The group is still whole by its structure, so the reader
  // is started at it, and the row's own signed metadata hash refuses it:
  // no page of the group is served, and neither is the older epoch's
  // history the group stands for.
  for (const [altered, honest] of [
    [{ plaintextHash: "altered" }, { plaintextHash: middle.plaintextHash }],
    [
      { partialEndVersionVector: staged[0]?.partialEndVersionVector ?? "" },
      { partialEndVersionVector: middle.partialEndVersionVector },
    ],
  ] satisfies [object, object][]) {
    await alter(altered);
    const refused = await coldPull();
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      code: DOCUMENT_SYNC_ERROR_CODES.conflict,
      error: "Document update metadata failed integrity validation",
    });
    await alter(honest);
    expect(await servedIds()).toEqual(groupIds);
  }

  // A committed segment whose staged payload row is gone has no ciphertext
  // anywhere. That is a damaged database, and the reader gets the same
  // coded conflict, not a server error.
  await db
    .delete(documentBaselineSegments)
    .where(eq(documentBaselineSegments.updateId, middle.id));
  const missing = await coldPull();
  expect(missing.status).toBe(409);
  expect(await missing.json()).toEqual({
    code: DOCUMENT_SYNC_ERROR_CODES.conflict,
    error: "Document update payload is missing",
  });
});

// What a group covers is read from its span rows, which nothing signs. The
// read notices a run that lost a row, because the run no longer adds up. It
// does not notice a row whose end was moved up in the database while the
// run stays gapless: the group then reads as covering more than its
// segments carry, which is the coverage the redirect weighs, and no pull
// is refused for it. Only a database altered outside the API holds such a
// row.
test("a span row inflated in the database enlarges a group's coverage, undetected", async () => {
  const { coldPull, created, group, groupIds, servedIds } =
    await committedStagedBaseline();
  const baselineId = group[0]?.baselineId;
  if (baselineId === undefined) throw new Error("Expected a group");
  const coverage = async () => {
    const stored = await readStoredBaselineGroupCoverage(db, {
      baselineId,
      documentId: created.id,
    });
    return stored === null
      ? null
      : Object.fromEntries(decodeVersionVector(stored).toJSON());
  };
  const honest = await coverage();
  if (honest === null) throw new Error("Expected the group's coverage");

  // The highest span the group stores of one peer.
  const [last] = await db
    .select()
    .from(documentUpdateSpans)
    .where(inArray(documentUpdateSpans.updateId, groupIds))
    .orderBy(desc(documentUpdateSpans.endCounter))
    .limit(1);
  if (!last) throw new Error("Expected a span");
  const isLast = and(
    eq(documentUpdateSpans.updateId, last.updateId),
    eq(documentUpdateSpans.peerId, last.peerId),
  );
  const setEnd = (endCounter: number) =>
    db.update(documentUpdateSpans).set({ endCounter }).where(isLast);

  // Its end moved up: the run still starts at zero and adds up, so the
  // group reads as covering a thousand operations nobody wrote, and its
  // rows, which are unaltered, are served as before.
  await setEnd(last.endCounter + 1000);
  expect(await coverage()).toEqual({
    ...honest,
    [last.peerId]: last.endCounter + 1000,
  });
  expect((await coldPull()).status).toBe(200);
  expect(await servedIds()).toEqual(groupIds);

  // Its start moved up instead: the run no longer adds up to where it
  // ends, and the group gives no coverage at all.
  await setEnd(last.endCounter);
  await db
    .update(documentUpdateSpans)
    .set({ startCounter: sql`${documentUpdateSpans.startCounter} + 1` })
    .where(isLast);
  expect(await coverage()).toBeNull();
});
