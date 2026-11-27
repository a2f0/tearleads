// The sweep of expired stages and the request that commits a stage both
// take the stage's row lock first, so of the two exactly one proceeds from
// any state of the stage. Either order, a committed segment keeps its
// payload and a swept stage commits nothing. Only a database with several
// connections can show the wait.
import { expect, test } from "bun:test";
import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { documentContentWriteHeaders } from "@tearleads/api-shared/schema";
import type { WriteHeader } from "@tearleads/crypto";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { DOCUMENT_BASELINE_STAGE_ERROR_CODES } from "@tearleads/validators/response";
import { sql } from "drizzle-orm";
import {
  expectNothingWritten,
  peerRanges,
  signerFor,
} from "../../../test/helpers/baselineGroupRefusals";
import {
  documentWithHistory,
  GROUP_INVALID,
  pullAsNewReader,
  storedUpdates,
} from "../../../test/helpers/baselineGroupRouteKit";
import {
  stageAllButFinal,
  stagedRows,
} from "../../../test/helpers/baselineStageKit";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import {
  holdPostgresLock,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";
import { deleteDocumentBaselineStage } from "../../documents/documentBaselineStageStore";
import { cleanupExpiredDocumentBaselineStages } from "../../workflows/documents/baselineStages";

const concurrencyTimeoutMs = 60_000;
const postgresOnly = test.skipIf(getDefaultApiDatabaseKind() !== "postgres");

async function stagedCommit() {
  const history = await documentWithHistory();
  const { created, frontier, owner, root } = history;
  const group = await signerFor(history, {
    accessManifestHash: created.manifestHash,
    contentKeyEpoch: created.contentKeyEpoch,
    dependencyManifestHashes: [root.bundle.manifestHash],
    targetHash: created.targetHash,
  })({ ranges: peerRanges(frontier) });
  const staged = await stageAllButFinal(owner, created.id, group, {
    contentKeyEpoch: created.contentKeyEpoch,
  });
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  const commitRequest: DocumentSyncRequest = {
    ...request,
    baselineStageId: staged.baselineStageId,
    outgoingUpdates: [staged.final],
  };
  return {
    ...staged,
    commit: () => postDocumentSync(owner, created.id, commitRequest),
    group,
    history,
  };
}

class Rollback extends Error {}

/** Holds what `acquire` wrote, uncommitted, and rolls it back on release. */
async function holdUncommitted(
  acquire: (tx: DatabaseTransaction) => Promise<void>,
) {
  const acquired = Promise.withResolvers<number>();
  const release = Promise.withResolvers<void>();
  const completion = db
    .transaction(async (tx) => {
      const result = await tx.execute(sql`select pg_backend_pid() as pid`);
      await acquire(tx);
      acquired.resolve(Number(Reflect.get(result.rows[0] ?? {}, "pid")));
      await release.promise;
      throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) acquired.reject(error);
    });
  return {
    backendPid: await acquired.promise,
    release: async () => {
      release.resolve();
      await completion;
    },
  };
}

// The sweep judges "expired" by its own clock. A stage the commit read as
// open can be expired to a sweep that runs a moment later.
const afterEveryExpiry = () => new Date(Date.now() + 48 * 60 * 60 * 1000);

postgresOnly(
  "a sweep that reaches a stage while a request commits it deletes nothing",
  async () => {
    const { commit, final, group, history, staged } = await stagedCommit();
    const { created, owner } = history;
    // Stall the commit after it has locked the stage: it stores the final
    // segment's write header next, and waits for another transaction's
    // uncommitted row under the same update id.
    const stall = await holdUncommitted(async (tx) => {
      await tx.insert(documentContentWriteHeaders).values({
        authorizationTargets: [],
        contentKeyEpoch: 1,
        contentRecordId: crypto.randomUUID(),
        documentId: crypto.randomUUID(),
        header: {} as WriteHeader,
        headerHash: crypto.randomUUID(),
        nonceDomainHash: crypto.randomUUID(),
        organizationId: crypto.randomUUID(),
        updateId: final.id,
      });
    });
    let committing: Promise<Response> | undefined;
    let sweeping:
      | ReturnType<typeof cleanupExpiredDocumentBaselineStages>
      | undefined;
    try {
      committing = commit();
      await waitForPostgresLockWait({
        blockerPid: stall.backendPid,
        queryFragment: "document_content_write_headers",
      });
      sweeping = cleanupExpiredDocumentBaselineStages(db, {
        now: afterEveryExpiry(),
      });
      // The sweep waits for the stage row behind the commit.
      await waitForPostgresLockWait({
        blockerPid: stall.backendPid,
        minimumWaiters: 1,
        queryFragment: 'delete from "document_baseline_stages"',
      });
    } finally {
      await stall.release();
    }

    expect((await committing).status).toBe(200);
    const swept = await sweeping;
    expect(swept.failures).toEqual([]);
    // Every segment is committed and every staged row is still its payload.
    expect(
      (await storedUpdates(created.id))
        .slice(history.committed.length)
        .map((row) => row.id),
    ).toEqual(group.map((segment) => segment.id));
    expect(await stagedRows(created.id)).toMatchObject({
      segments: staged.map((segment) => ({ updateId: segment.id })),
      spans: [],
      stages: [],
    });
    const served = (
      await pullAsNewReader(owner, created.id, created, 64)
    ).flatMap((page) => page.updates);
    expect(served.map((update) => update.encryptedData)).toEqual(
      group.map((segment) => segment.encryptedData),
    );
  },
  concurrencyTimeoutMs,
);

postgresOnly(
  "a request that reaches a stage while the sweep deletes it commits nothing",
  async () => {
    const { baselineStageId, commit, history } = await stagedCommit();
    const { created } = history;
    // The sweep's transaction for one stage: the stage row, then what it
    // staged. Held open before it commits.
    const sweep = await holdPostgresLock((tx) =>
      deleteDocumentBaselineStage(tx, {
        baselineId: baselineStageId,
        documentId: created.id,
      }),
    );
    let committing: Promise<Response> | undefined;
    try {
      committing = commit();
      await waitForPostgresLockWait({
        blockerPid: sweep.backendPid,
        queryFragment: "document_baseline_stages",
      });
    } finally {
      await sweep.release();
    }

    const response = await committing;
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      baselineStageCode: DOCUMENT_BASELINE_STAGE_ERROR_CODES.notFound,
      code: GROUP_INVALID,
    });
    await expectNothingWritten(history);
    expect(await stagedRows(created.id)).toEqual({
      segments: [],
      spans: [],
      stages: [],
    });
  },
  concurrencyTimeoutMs,
);
