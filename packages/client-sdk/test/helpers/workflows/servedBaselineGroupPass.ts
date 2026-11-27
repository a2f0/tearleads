import { expect } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  importUpdates,
} from "@tearleads/loro";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import type { BaselineGroupRun } from "../../../src/data/documents/shared/sync/baselineGroupMachine";
import { validateDocumentSyncUpdateImports } from "../../../src/data/documents/shared/sync/documentSyncImportVerdicts";
import { isDocumentSyncUpdateIsolationError } from "../../../src/data/documents/shared/sync/documentSyncUpdateIsolation";
import type { DocumentSyncImportVerdicts } from "../../../src/data/documents/shared/sync/documentUpdateVerdict";
import type { ExecSql } from "../../../src/data/sqlite/sqlSchema";
import { syncRemoteDocumentResultFromResponse } from "../../../src/workflows/documents/sync/syncResponseResult";
import { buildMaterializedDocumentSyncPlan } from "../../../src/workflows/documents/syncPlan/syncPlanMaterial";
import {
  createSyncResponse,
  writerKeyResolver,
} from "../data/documentFixtures";
import { SMALL_BASELINE_SEGMENTS } from "../data/rotationBaselineFixtures";
import { createMaterializedSyncFixture } from "./materializedSyncFixture";
import { createServedRotationBaseline } from "./servedRotationBaseline";

type ServedUpdate = DocumentSyncResponse["updates"][number];
export type BaselineFixtureDocument = Awaited<
  ReturnType<typeof createDocument>
>;

/** One page of a pull, as `servedBaselineGroup` judges it. */
interface ServedBaselinePage {
  readonly knownVoidIds?: readonly string[];
  readonly more?: boolean;
  /** A later page of a raw-history pull, which carries no run. */
  readonly rawLaterPage?: boolean;
  readonly reader: BaselineFixtureDocument;
  readonly run?: BaselineGroupRun | null;
  readonly updates: readonly ServedUpdate[];
  /**
   * Changes the judge's verdicts before the pass reads them, as a judge
   * that ran out of budget or met an unsettled update would return them.
   */
  readonly verdicts?: (
    judged: DocumentSyncImportVerdicts,
  ) => DocumentSyncImportVerdicts;
  readonly warm?: boolean;
}

/**
 * A baseline of several segments, and a pass over pages of it. `craft`
 * returns the update blobs to sign as its segments in place of the ones an
 * honest writer cuts.
 */
export async function servedBaselineGroup(
  execSql: ExecSql,
  craft?: (document: BaselineFixtureDocument) => Uint8Array[],
) {
  const fixture = await createMaterializedSyncFixture();
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    fixture;
  const planFor = (request: {
    historyMode?: "raw";
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
    ...(craft ? { segmentPayloads: craft(document) } : {}),
    segmentSizes: SMALL_BASELINE_SEGMENTS,
    writerProjection,
  });
  const segments = baseline.updates;
  if (!craft && segments.length < 5) {
    throw new Error("Expected five segments or more");
  }

  /** One page judged against `reader`, as the store's judge does. */
  const pass = async (input: ServedBaselinePage) => {
    const run = input.run ?? null;
    const materializedPlan = await planFor({
      // What the pass requests: no version while a group is followed whole.
      localVersionVector:
        input.warm || (run && run.digest === null)
          ? encodeVersionVector(input.reader)
          : null,
      ...(run || input.rawLaterPage ? { pullCursor: "page-2" } : {}),
      ...(input.rawLaterPage ? { historyMode: "raw" } : {}),
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
      validateIncomingUpdates: async ({ decryptedUpdates, response: page }) => {
        const judged = await validateDocumentSyncUpdateImports({
          currentDocument: input.reader,
          decryptedUpdates,
          knownVoids: new Map(
            (input.knownVoidIds ?? []).map((id) => [id, "loro_import"]),
          ),
          responseUpdates: page.updates,
        });
        return input.verdicts ? input.verdicts(judged) : judged;
      },
      writerProjection,
    });
  };
  /** The reason a pass fails for its served baseline. */
  const refusal = async (input: ServedBaselinePage) => {
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

type ServedBaselineGroup = Awaited<ReturnType<typeof servedBaselineGroup>>;
type PassResult = Awaited<ReturnType<ServedBaselineGroup["pass"]>>;

/** What the store does with a page's result: import what it accepted. */
export function acceptServedPage(
  reader: BaselineFixtureDocument,
  result: PassResult,
): void {
  importUpdates(
    reader,
    result.decryptedUpdates.map((update) => update.updateData),
  );
}

/** The one writer's operations `[start, end)` of `document`, as a span. */
export function operationSpan(
  document: BaselineFixtureDocument,
  start: number,
  end: number,
) {
  return { id: { counter: start, peer: document.peerIdStr }, len: end - start };
}

/** An update blob that carries `spans` and nothing else. */
export function rangeExport(
  document: BaselineFixtureDocument,
  ...spans: ReturnType<typeof operationSpan>[]
): Uint8Array {
  return document.export({ mode: "updates-in-range", spans });
}

/** How many operations `document`'s own writer has made. */
export function operationCount(document: BaselineFixtureDocument): number {
  return document.oplogVersion().get(document.peerIdStr) ?? 0;
}
