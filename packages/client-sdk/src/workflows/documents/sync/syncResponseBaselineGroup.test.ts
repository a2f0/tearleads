import { expect, test } from "bun:test";
import { createDocument } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createSyncResponse,
  writerKeyResolver,
} from "../../../../test/helpers/data/documentFixtures";
import { SMALL_BASELINE_SEGMENTS } from "../../../../test/helpers/data/rotationBaselineFixtures";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import { createServedRotationBaseline } from "../../../../test/helpers/workflows/servedRotationBaseline";
import { isDocumentSyncUpdateIsolationError } from "../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import { emptyDocumentSyncImportVerdicts } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import { buildMaterializedDocumentSyncPlan } from "../syncPlan/syncPlanMaterial";
import { syncRemoteDocumentResultFromResponse } from "./syncResponseResult";

// A served rotation baseline that breaks a group rule is the server's fault,
// not any update's: the pass fails, and nothing from the page reaches the
// import judge.
test("a pass fails on a rotation baseline that is not served whole, before any import", async () => {
  const { close, execSql } = await createTestExecSql(
    "sync-response-baseline-group",
  );
  try {
    const {
      author,
      resolveProjectionUserKey,
      secretKey,
      signingPublicKey,
      writerProjection,
    } = await createMaterializedSyncFixture();
    const materializedPlan = await buildMaterializedDocumentSyncPlan({
      author,
      execSql,
      localVersionVector: null,
      pendingUpdates: [],
      resolveProjectionUserKey,
      targetSecretKey: secretKey,
      writerProjection,
    });
    const document = await createDocument("served-baseline-group");
    for (let line = 0; line < 30; line += 1) {
      const text = document.getText("text");
      text.insert(text.length, `line ${line} of the rotated history\n`);
      document.commit();
    }
    const baseline = await createServedRotationBaseline({
      author,
      contentKey: materializedPlan.contentKey,
      document,
      plan: materializedPlan.plan,
      segmentSizes: SMALL_BASELINE_SEGMENTS,
      writerProjection,
    });
    const segments = baseline.updates;
    expect(segments.length).toBeGreaterThan(2);

    let judgedPages = 0;
    const passOver = async (updates: typeof segments) =>
      syncRemoteDocumentResultFromResponse({
        baselineGroupRun: null,
        execSql,
        materializedPlan,
        recoveryPendingUpdatesById: new Map(),
        rekeyPendingUpdate: async () => crypto.randomUUID(),
        resolveProjectionUserKey,
        resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
        response: await createSyncResponse(materializedPlan.plan, { updates }),
        stillCurrent: () => true,
        targetSecretKey: secretKey,
        validateIncomingUpdates: () => {
          judgedPages += 1;
          return emptyDocumentSyncImportVerdicts();
        },
        writerProjection,
      });
    const refusal = async (updates: typeof segments) => {
      const error = await passOver(updates).then(
        () => null,
        (thrown: unknown) => thrown,
      );
      if (!isDocumentSyncUpdateIsolationError(error)) {
        throw new Error("Expected the pass to fail on its served baseline");
      }
      return String(error.cause);
    };

    // The whole group, in order, is judged like any page.
    const whole = await passOver(segments);
    expect(whole?.decryptedUpdates.map(({ id }) => id)).toEqual(
      segments.map(({ id }) => id),
    );
    expect(whole?.baselineGroupRun).toBeNull();
    expect(judgedPages).toBe(1);

    const [first, second, ...rest] = segments;
    if (!first || !second) throw new Error("Expected segments");
    expect(await refusal(segments.slice(0, -1))).toContain(
      "the pull ended inside a rotation baseline, before its final segment",
    );
    expect(await refusal([second, first, ...rest])).toContain(
      "not a whole rotation baseline",
    );
    expect(await refusal([first, ...rest])).toContain(
      "a rotation baseline's segments were not served in index order",
    );
    expect(judgedPages).toBe(1);
  } finally {
    close();
  }
});
