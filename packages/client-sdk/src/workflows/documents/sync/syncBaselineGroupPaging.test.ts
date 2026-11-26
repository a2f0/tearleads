import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createSyncResponse,
  writerKeyResolver,
} from "../../../../test/helpers/data/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../../test/helpers/workflows/documentSync";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import type { BaselineGroupRun } from "../../../data/documents/shared/sync/baselineGroupMachine";
import { isDocumentSyncUpdateIsolationError } from "../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import { buildMaterializedDocumentSyncPlan } from "../syncPlan/syncPlanMaterial";

const WARM_VERSION = "AQEAAQ==";
const BASELINE_ID = "11111111-1111-4111-8111-111111111111";

/**
 * One read-only pass of a store that holds `WARM_VERSION`, continuing a pull
 * that ended its last page inside a rotation baseline. The server answers
 * with an empty final page.
 */
async function continuePull(input: {
  historyMode?: "raw";
  run: BaselineGroupRun;
}) {
  const { close, execSql } = await createTestExecSql(
    `sync-baseline-group-paging-${crypto.randomUUID()}`,
  );
  try {
    const fixture = await createMaterializedSyncFixture();
    const materialized = await buildMaterializedDocumentSyncPlan({
      author: fixture.author,
      execSql,
      historyMode: input.historyMode,
      localVersionVector: null,
      pendingUpdates: [],
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      targetSecretKey: fixture.secretKey,
      writerProjection: fixture.writerProjection,
    });
    const requests: { cursor?: string; version: string | null }[] = [];
    let invalidations = 0;
    const outcome = await syncRemoteDocument({
      apiClient: createMockApiClient({
        getDocumentWriterProjection: async () => fixture.writerProjection,
        syncDocumentResult: async (documentId, request) => {
          requests.push({
            ...(request.pullCursor === undefined
              ? {}
              : { cursor: request.pullCursor }),
            version: request.localVersionVector,
          });
          return {
            data: await createSyncResponse(
              { ...materialized.plan, documentId, request },
              {
                acceptedOutgoingUpdateIds: [],
                commitLsn: "0/16B6C50",
                pullPage: {
                  hasMore: false,
                  nextCursor: null,
                  throughUpdateCount: 0,
                  throughUpdateId: null,
                },
                updates: [],
              },
            ),
            ok: true,
          };
        },
      }),
      author: fixture.author,
      documentId: fixture.writerProjection.documentId,
      execSql,
      historyMode: input.historyMode,
      localVersionVector: input.historyMode === "raw" ? null : WARM_VERSION,
      onPullContinuationInvalidated: () => {
        invalidations += 1;
      },
      pendingUpdates: [],
      persistedState: {
        contentKeyBundle: JSON.stringify(
          fixture.writerProjection.contentKeyBundle,
        ),
        documentId: fixture.writerProjection.documentId,
        documentKekTargets: JSON.stringify(
          fixture.writerProjection.documentKekTargets,
        ),
        documentManifestBundle: JSON.stringify(
          fixture.writerProjection.documentManifest,
        ),
      },
      pullContinuation: {
        baselineGroupRun: input.run,
        commitLsn: "0/16B6C50",
        commitLsnMode: "tracked",
        cursor: "page-2",
      },
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      resolveWriterPublicKey: writerKeyResolver(fixture),
      targetSecretKey: fixture.secretKey,
      writerProjection: fixture.writerProjection,
    }).then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    return { invalidations, outcome, requests };
  } finally {
    close();
  }
}

const WHOLE: BaselineGroupRun = {
  baselineId: BASELINE_ID,
  digest: "a".repeat(64),
  nextIndex: 2,
  unapplied: false,
};

// The server leaves out of a page every update whose operations the page's
// version holds. A reader that began a group on a cold page may hold its
// later segments' operations by the next one, so that page is requested
// with no version, whatever the store holds: the group's remaining segments
// are served and can be checked.
test("a page that continues a baseline followed whole is requested with no version", async () => {
  const whole = await continuePull({ run: WHOLE });
  expect(whole.requests).toEqual([{ cursor: "page-2", version: null }]);
  // A group followed in part is held to less, and its page keeps the
  // reader's version.
  const inPart = await continuePull({ run: { ...WHOLE, digest: null } });
  expect(inPart.requests).toEqual([
    { cursor: "page-2", version: WARM_VERSION },
  ]);
  expect("result" in inPart.outcome).toBe(true);
});

// The pull ended before the group's final segment. That fails the pass in
// ordinary sync as it does in raw mode: it used to read as a page that
// could not be settled, and the pull began again with no cursor, no failure
// recorded, and no memory of the group.
for (const historyMode of [undefined, "raw"] as const) {
  test(`an empty final page inside a baseline followed whole fails the pass (${historyMode ?? "ordinary"} sync)`, async () => {
    const { invalidations, outcome, requests } = await continuePull({
      ...(historyMode ? { historyMode } : {}),
      run: WHOLE,
    });
    if (!("error" in outcome)) throw new Error("Expected the pass to fail");
    if (!isDocumentSyncUpdateIsolationError(outcome.error)) throw outcome.error;
    expect(outcome.error.stage).toBe("baseline_group");
    expect(String(outcome.error.cause)).toContain(
      "the pull ended inside a rotation baseline, before its final segment",
    );
    expect(requests).toEqual([{ cursor: "page-2", version: null }]);
    expect(invalidations).toBe(0);
  });
}
