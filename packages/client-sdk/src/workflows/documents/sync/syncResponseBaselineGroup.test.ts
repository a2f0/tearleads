import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  getTextValue,
  importUpdates,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import {
  createSyncResponse,
  writerKeyResolver,
} from "../../../../test/helpers/data/documentFixtures";
import { SMALL_BASELINE_SEGMENTS } from "../../../../test/helpers/data/rotationBaselineFixtures";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import { createServedRotationBaseline } from "../../../../test/helpers/workflows/servedRotationBaseline";
import type { BaselineGroupRun } from "../../../data/documents/shared/sync/baselineGroupMachine";
import { validateDocumentSyncUpdateImports } from "../../../data/documents/shared/sync/documentSyncImportVerdicts";
import { isDocumentSyncUpdateIsolationError } from "../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { buildMaterializedDocumentSyncPlan } from "../syncPlan/syncPlanMaterial";
import { syncRemoteDocumentResultFromResponse } from "./syncResponseResult";

// A served rotation baseline that breaks a group rule is the server's fault,
// not any update's: the pass fails, nothing from the page is imported, and
// no void is recorded that would outlast the server's correction. A segment
// its own writer broke is a void, as any update is, and so are the segments
// that build on it.

type ServedUpdate = DocumentSyncResponse["updates"][number];
type Doc = Awaited<ReturnType<typeof createDocument>>;

let execSql: ExecSql;
let close: () => void;

beforeEach(async () => {
  ({ close, execSql } = await createTestExecSql(
    "sync-response-baseline-group",
  ));
});

afterEach(() => close());

/** A baseline of several segments, and a pass over pages of it. */
async function servedGroup() {
  const fixture = await createMaterializedSyncFixture();
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    fixture;
  const planFor = (request: {
    localVersionVector: string | null;
    pullCursor?: string;
  }) =>
    buildMaterializedDocumentSyncPlan({
      author,
      execSql,
      pendingUpdates: [],
      resolveProjectionUserKey,
      targetSecretKey: secretKey,
      writerProjection,
      ...request,
    });
  const coldPlan = await planFor({ localVersionVector: null });
  const document = await createDocument("served-baseline-group");
  for (let line = 0; line < 30; line += 1) {
    const text = document.getText("text");
    text.insert(text.length, `line ${line} of the rotated history\n`);
    document.commit();
  }
  const baseline = await createServedRotationBaseline({
    author,
    contentKey: coldPlan.contentKey,
    document,
    plan: coldPlan.plan,
    segmentSizes: SMALL_BASELINE_SEGMENTS,
    writerProjection,
  });
  const segments = baseline.updates;
  if (segments.length < 5) throw new Error("Expected five segments or more");

  /** One page judged against `reader`, as the store's judge does. */
  const pass = async (input: {
    knownVoidIds?: readonly string[];
    more?: boolean;
    reader: Doc;
    run?: BaselineGroupRun | null;
    updates: readonly ServedUpdate[];
    warm?: boolean;
  }) => {
    const run = input.run ?? null;
    const materializedPlan = await planFor({
      // What the pass requests: no version while a group is followed whole.
      localVersionVector:
        input.warm || (run && run.digest === null)
          ? encodeVersionVector(input.reader)
          : null,
      ...(run ? { pullCursor: "page-2" } : {}),
    });
    const response = await createSyncResponse(materializedPlan.plan, {
      updates: [...input.updates],
    });
    return syncRemoteDocumentResultFromResponse({
      baselineGroupRun: run,
      execSql,
      materializedPlan,
      recoveryPendingUpdatesById: new Map(),
      rekeyPendingUpdate: async () => crypto.randomUUID(),
      resolveProjectionUserKey,
      resolveWriterPublicKey: writerKeyResolver({
        author,
        signingPublicKey: fixture.signingPublicKey,
      }),
      response:
        input.more && response.pullPage
          ? {
              ...response,
              pullPage: {
                ...response.pullPage,
                hasMore: true,
                nextCursor: "page-next",
              },
            }
          : response,
      stillCurrent: () => true,
      targetSecretKey: secretKey,
      validateIncomingUpdates: ({ decryptedUpdates, response: page }) =>
        validateDocumentSyncUpdateImports({
          currentDocument: input.reader,
          decryptedUpdates,
          knownVoids: new Map(
            (input.knownVoidIds ?? []).map((id) => [id, "loro_import"]),
          ),
          responseUpdates: page.updates,
        }),
      writerProjection,
    });
  };
  /** The reason a pass fails for its served baseline. */
  const refusal = async (input: Parameters<typeof pass>[0]) => {
    const error = await pass(input).then(
      (result) => result,
      (thrown: unknown) => thrown,
    );
    if (!isDocumentSyncUpdateIsolationError(error)) {
      throw new Error("Expected the pass to fail on its served baseline");
    }
    expect(error.stage).toBe("baseline_group");
    expect(error.attribution).toBe("batch");
    return String(error.cause);
  };
  return { document, pass, refusal, segments };
}

type PassResult = Awaited<
  ReturnType<Awaited<ReturnType<typeof servedGroup>>["pass"]>
>;

/** What the store does with a page's result. */
function accept(reader: Doc, result: PassResult) {
  importUpdates(
    reader,
    result.decryptedUpdates.map((update) => update.updateData),
  );
}

test("a cold pass takes a whole baseline and fails on one served in part", async () => {
  const { document, pass, refusal, segments } = await servedGroup();
  const reader = await createDocument("cold-reader");
  const whole = await pass({ reader, updates: segments });
  expect(whole.voidedUpdates).toEqual([]);
  expect(whole.baselineGroupRun).toBeNull();
  accept(reader, whole);
  expect(getTextValue(reader)).toBe(getTextValue(document));

  const [first, second, ...rest] = segments;
  if (!first || !second) throw new Error("Expected segments");
  const cold = () => createDocument("cold-reader-refused");
  expect(
    await refusal({ reader: await cold(), updates: segments.slice(0, -1) }),
  ).toContain("the pull ended inside a rotation baseline");
  expect(
    await refusal({ reader: await cold(), updates: [first, ...rest] }),
  ).toContain("were not served in index order");
  // The group without its first segments: once four voids at `loro_import`
  // that outlasted the server's correction.
  expect(
    await refusal({ reader: await cold(), updates: segments.slice(1) }),
  ).toContain("served from past its first segment");
  expect(
    await refusal({ reader: await cold(), updates: segments.slice(-1) }),
  ).toContain("served from past its first segment");
});

test("a segment served without the segments it builds on fails the pass", async () => {
  const { pass, refusal, segments } = await servedGroup();
  const [first] = segments;
  if (!first) throw new Error("Expected segments");
  // A reader that holds the first segment is served the rest by an honest
  // server and takes it.
  const warm = await createDocument("warm-reader");
  const firstPage = await pass({ more: true, reader: warm, updates: [first] });
  accept(warm, firstPage);
  const rest = await pass({
    reader: warm,
    updates: segments.slice(1),
    warm: true,
  });
  expect(rest.voidedUpdates).toEqual([]);
  expect(rest.decryptedUpdates).toHaveLength(segments.length - 1);

  // With the second segment withheld, the third builds on operations the
  // reader was never served: once voids of every served segment.
  const again = await createDocument("warm-reader-refused");
  accept(again, await pass({ more: true, reader: again, updates: [first] }));
  expect(
    await refusal({ reader: again, updates: segments.slice(2), warm: true }),
  ).toContain("served without the segments it builds on");
});

test("segments that build on a void one are void, on this page or a later one", async () => {
  const { pass, refusal, segments } = await servedGroup();
  const [first, second, ...rest] = segments;
  if (!first || !second) throw new Error("Expected segments");
  // The writer's second segment is one no reader takes.
  const knownVoidIds = [second.id];
  const reader = await createDocument("reader-of-a-void-segment");
  const onePage = await pass({ knownVoidIds, reader, updates: segments });
  expect(onePage.decryptedUpdates.map(({ id }) => id)).toEqual([first.id]);
  expect(onePage.voidedUpdates.map(({ updateId }) => updateId)).toEqual(
    [second, ...rest].map(({ id }) => id),
  );

  // Across a page boundary the run remembers the void.
  const paged = await createDocument("paged-reader-of-a-void-segment");
  const firstPage = await pass({
    knownVoidIds,
    more: true,
    reader: paged,
    updates: [first, second],
  });
  expect(firstPage.baselineGroupRun).toMatchObject({
    nextIndex: 2,
    unapplied: true,
  });
  accept(paged, firstPage);
  const secondPage = await pass({
    reader: paged,
    run: firstPage.baselineGroupRun,
    updates: rest,
  });
  expect(secondPage.decryptedUpdates).toEqual([]);
  expect(secondPage.voidedUpdates.map(({ updateId }) => updateId)).toEqual(
    rest.map(({ id }) => id),
  );
  // Without that memory the same page reads as segments the server left
  // out, which is what it would be had no segment been void.
  const run = firstPage.baselineGroupRun;
  if (!run) throw new Error("Expected a run");
  expect(
    await refusal({
      reader: paged,
      run: { ...run, unapplied: false },
      updates: rest,
    }),
  ).toContain("served without the segments it builds on");
});
