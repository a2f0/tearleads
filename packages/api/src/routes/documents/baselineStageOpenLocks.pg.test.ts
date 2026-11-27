// What an open waits for, and what waits behind it. An open waits for the
// caller's own lock and then for the document's lifecycle lock, and holds
// no stage row in either wait; under the lifecycle lock it waits for no
// lock. Only a database with several connections can show a wait.
import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { documentBaselineStages } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import { openDocumentBaselineStageOperation as operation } from "@tearleads/validators/operation";
import { DOCUMENT_BASELINE_STAGE_ERROR_CODES as STAGE } from "@tearleads/validators/response";
import { MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER } from "@tearleads/validators/util";
import { eq, sql } from "drizzle-orm";
import {
  peerRanges,
  signerFor,
} from "../../../test/helpers/baselineGroupRefusals";
import { documentWithHistory } from "../../../test/helpers/baselineGroupRouteKit";
import {
  openStage,
  putSegment,
  setStageExpiry,
  stagedRows,
} from "../../../test/helpers/baselineStageKit";
import { createDocument } from "../../../test/helpers/keyingWriterProjectionKit";
import {
  holdPostgresLock,
  waitForPostgresLockWait,
  settledWithoutWaiting as withoutWaiting,
} from "../../../test/helpers/postgresConcurrency";
import { registerAndAuthenticate } from "../../../test/helpers/registerUser";
import { lockDocumentBaselineStageRow } from "../../documents/documentBaselineStageStore";
import { deriveDocumentLifecycleLockKeys } from "../../workflows/documents/mutations/documentLifecycleLock";

const onPostgres = getDefaultApiDatabaseKind() === "postgres";

/** Holds a document's lifecycle lock, as a purge or a create of it does. */
async function holdLifecycleLock(documentId: string) {
  const [first, second] = await deriveDocumentLifecycleLockKeys(documentId);
  return holdPostgresLock(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${first}, ${second})`);
  });
}

function open(
  owner: TestUser,
  document: { id: string; contentKeyEpoch: number },
) {
  return openStage(owner, document.id, {
    baselineId: crypto.randomUUID(),
    contentKeyEpoch: document.contentKeyEpoch,
  });
}

function stagesOf(userId: string) {
  return db
    .select({ documentId: documentBaselineStages.documentId })
    .from(documentBaselineStages)
    .where(eq(documentBaselineStages.ownerUserId, userId));
}

// The caller's commit of a stage holds its document's manifest head and
// asks for the stage row. An open elsewhere that held that row while it
// waited for another document's lifecycle lock would stall every writer of
// the first document behind a purge of the second.
test.skipIf(!onPostgres)(
  "an open that waits for a lifecycle lock holds none of the caller's stages",
  async () => {
    const history = await documentWithHistory();
    const { created, frontier, owner, root } = history;
    const other = await createDocument({ owner, root });
    const [first] = await signerFor(history, {
      accessManifestHash: created.manifestHash,
      contentKeyEpoch: created.contentKeyEpoch,
      dependencyManifestHashes: [root.bundle.manifestHash],
      targetHash: created.targetHash,
    })({ ranges: peerRanges(frontier) });
    if (!first?.baselineId) throw new Error("Expected a segment");
    expect(
      (
        await openStage(owner, created.id, {
          baselineId: first.baselineId,
          contentKeyEpoch: created.contentKeyEpoch,
        })
      ).status,
    ).toBe(200);

    const purging = await holdLifecycleLock(other.id);
    let opening: Promise<Response> | undefined;
    try {
      opening = Promise.resolve(open(owner, other));
      await waitForPostgresLockWait({
        blockerPid: purging.backendPid,
        queryFragment: "pg_advisory_xact_lock",
      });
      // A write to the caller's stage on the first document takes its row.
      const staged = await withoutWaiting(putSegment(owner, created.id, first));
      expect(staged.status).toBe(200);
    } finally {
      await purging.release();
    }
    if (!opening) throw new Error("Expected the open");
    expect((await opening).status).toBe(200);
  },
  60_000,
);

// A request of the caller's own may hold its stage on this document for a
// long time: a segment being verified, or a commit. An open that waited
// for the row would wait under the lifecycle lock, and keep a purge of the
// document and every other user's open there waiting with it.
test.skipIf(!onPostgres)(
  "an open whose stage here is in use is refused, and waits for nothing",
  async () => {
    const { created, owner } = await documentWithHistory();
    const here = crypto.randomUUID();
    const stage = {
      baselineId: here,
      contentKeyEpoch: created.contentKeyEpoch,
    };
    expect((await openStage(owner, created.id, stage)).status).toBe(200);

    const busy = await holdPostgresLock(async (tx) => {
      await lockDocumentBaselineStageRow(tx, {
        baselineId: here,
        documentId: created.id,
      });
    });
    try {
      // Replacing the stage and opening it again both ask for its row.
      for (const request of [
        open(owner, created),
        openStage(owner, created.id, stage),
      ]) {
        const refused = await withoutWaiting(request);
        const body = await refused.json();
        expect([refused.status, body]).toEqual([
          503,
          {
            error:
              "Document baseline stage is in use by another request; retry",
          },
        ]);
        // As the operation declares it: the plain error body, and the
        // delay to wait before the open is sent again.
        expect(operation.failureResponses[503].safeParse(body).success).toBe(
          true,
        );
        expect(refused.headers.get("retry-after")).toBe("1");
        expect(
          operation.responseHeaders[503].safeParse({
            "retry-after": refused.headers.get("retry-after"),
          }).success,
        ).toBe(true);
      }
      // The refused opens left the document's lifecycle lock free.
      const [first, second] = await deriveDocumentLifecycleLockKeys(created.id);
      const free = await db.transaction(async (tx) => {
        const result = await tx.execute(
          sql`select pg_try_advisory_xact_lock(${first}, ${second}) as free`,
        );
        return Reflect.get(result.rows[0] ?? {}, "free");
      });
      expect(free).toBe(true);
    } finally {
      await busy.release();
    }
    expect((await stagedRows(created.id)).stages).toEqual([
      { id: here, nextSegmentIndex: 0 },
    ]);
    expect((await open(owner, created)).status).toBe(200);
  },
  60_000,
);

// The lifecycle lock is what a create and a purge of the document wait
// for. A caller who cannot write the document is refused before it asks
// for the lock, so it cannot hold up either.
test.skipIf(!onPostgres)(
  "an open by a caller without access takes no lifecycle lock",
  async () => {
    const { created, owner } = await documentWithHistory();
    const outsider = createTestUser();
    await registerAndAuthenticate(outsider);
    const unknown = { contentKeyEpoch: 1, id: crypto.randomUUID() };

    const purging = await holdLifecycleLock(created.id);
    const creating = await holdLifecycleLock(unknown.id);
    let opening: Promise<Response> | undefined;
    try {
      const refused = await withoutWaiting(open(outsider, created));
      expect(refused.status).toBe(403);
      const missing = await withoutWaiting(open(outsider, unknown));
      expect([missing.status, await missing.json()]).toEqual([
        409,
        { error: "Document not found" },
      ]);
      // A writer of the document does wait for it.
      opening = Promise.resolve(open(owner, created));
      await waitForPostgresLockWait({
        blockerPid: purging.backendPid,
        queryFragment: "pg_advisory_xact_lock",
      });
    } finally {
      await purging.release();
      await creating.release();
    }
    if (!opening) throw new Error("Expected the open");
    expect((await opening).status).toBe(200);
    expect(await stagesOf(outsider.userId)).toEqual([]);
  },
  60_000,
);

// An open counts the caller's stages on other documents and then stores
// its own. Two opens that both counted before either stored would pass the
// cap together; the caller's own lock runs them one at a time.
test.skipIf(!onPostgres)(
  "opens by one user on many documents at once stop at the cap",
  async () => {
    const { created, owner, root } = await documentWithHistory();
    const cap = MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER;
    const documents = [created];
    while (documents.length < cap * 3) {
      documents.push(await createDocument({ owner, root }));
    }
    const responses = await Promise.all(
      documents.map((document) => open(owner, document)),
    );
    const refusals = [];
    for (const response of responses) {
      if (response.status !== 200) refusals.push(await response.json());
    }
    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(cap);
    expect(refusals).toHaveLength(documents.length - cap);
    for (const refusal of refusals) {
      expect(refusal.code).toBe(STAGE.limitReached);
      expect(refusal.openStages).toHaveLength(cap);
    }
    expect(await stagesOf(owner.userId)).toHaveLength(cap);
  },
  120_000,
);

// An open deletes the caller's expired stages, and waits for none of them:
// one another request holds is skipped, still counts toward the cap until
// that request lets it go, and is left out of `openStages` because it is
// already on its way out.
test.skipIf(!onPostgres)(
  "an expired stage elsewhere that is in use is skipped, still counts, and is omitted from openStages",
  async () => {
    const { created, owner, root } = await documentWithHistory();
    const cap = MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER;
    const expired = { baselineId: crypto.randomUUID(), documentId: created.id };
    expect(
      (
        await openStage(owner, created.id, {
          baselineId: expired.baselineId,
          contentKeyEpoch: created.contentKeyEpoch,
        })
      ).status,
    ).toBe(200);
    for (let held = 1; held < cap; held += 1) {
      const document = await createDocument({ owner, root });
      expect((await open(owner, document)).status).toBe(200);
    }
    await setStageExpiry(created.id, expired.baselineId, new Date(0));
    const fifth = await createDocument({ owner, root });

    const busy = await holdPostgresLock(async (tx) => {
      await lockDocumentBaselineStageRow(tx, expired);
    });
    try {
      const refused = await withoutWaiting(open(owner, fifth));
      expect(refused.status).toBe(409);
      const body = await refused.json();
      expect(body.code).toBe(STAGE.limitReached);
      expect(body.openStages).toHaveLength(cap - 1);
      expect(
        body.openStages.some(
          (stage: { baselineId: string }) =>
            stage.baselineId === expired.baselineId,
        ),
      ).toBe(false);
    } finally {
      await busy.release();
    }
    expect((await open(owner, fifth)).status).toBe(200);
    expect((await stagedRows(created.id)).stages).toEqual([]);
    expect(await stagesOf(owner.userId)).toHaveLength(cap);
  },
  120_000,
);

// An expired stage may hold a gigabyte and a million span rows. An open
// deletes the caller's expired stages — on this document and on every
// other — in a transaction of its own, before it asks for this document's
// lifecycle lock, so the delete is never done under that lock, which a
// purge of the document and other users' opens wait for: both stages are
// gone while the open still waits.
test.skipIf(!onPostgres)(
  "an open deletes the caller's expired stages before it asks for a lock",
  async () => {
    const { created, owner, root } = await documentWithHistory();
    const other = await createDocument({ owner, root });
    const expiredElsewhere = crypto.randomUUID();
    const expiredHere = crypto.randomUUID();
    expect(
      (
        await openStage(owner, created.id, {
          baselineId: expiredElsewhere,
          contentKeyEpoch: created.contentKeyEpoch,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await openStage(owner, other.id, {
          baselineId: expiredHere,
          contentKeyEpoch: other.contentKeyEpoch,
        })
      ).status,
    ).toBe(200);
    await setStageExpiry(created.id, expiredElsewhere, new Date(0));
    await setStageExpiry(other.id, expiredHere, new Date(0));

    const purging = await holdLifecycleLock(other.id);
    let opening: Promise<Response> | undefined;
    try {
      opening = Promise.resolve(open(owner, other));
      await waitForPostgresLockWait({
        blockerPid: purging.backendPid,
        queryFragment: "pg_advisory_xact_lock",
      });
      expect((await stagedRows(created.id)).stages).toEqual([]);
      expect((await stagedRows(other.id)).stages).toEqual([]);
    } finally {
      await purging.release();
    }
    if (!opening) throw new Error("Expected the open");
    expect((await opening).status).toBe(200);
  },
  60_000,
);
