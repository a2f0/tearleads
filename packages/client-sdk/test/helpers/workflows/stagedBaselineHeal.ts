// A stale-bundle heal against an API that stages rotation baselines: the
// fixture's stale projection, a fake stage server, and a sync route that
// commits a staged group or serves the refusal a test scripts.
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  type HistorySegmentSizes,
} from "@tearleads/loro";
import {
  createMockApiClient,
  createMockRequestFailure,
} from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentSyncApi } from "../../../src/data/documents/shared/sync/documentSyncTypes";
import type { DocumentSyncSubmitFailure } from "../../../src/data/documents/shared/sync/syncSubmitFailure";
import type { ExecSql } from "../../../src/data/sqlite/sqlSchema";
import { buildDocumentSyncPlan } from "../../../src/workflows/documents/syncPlan/syncPlanIdentity";
import {
  createSyncResponse,
  writerKeyResolver,
} from "../data/documentFixtures";
import { SMALL_BASELINE_SEGMENTS } from "../data/rotationBaselineFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "./documentSync";
import { createLoroPendingUpdate } from "./documentSyncFixtures";
import {
  FakeBaselineStageServer,
  type StageCommitRefusal,
} from "./fakeBaselineStageServer";
import { createMaterializedSyncFixture } from "./materializedSyncFixture";

type HistoryDocument = Awaited<ReturnType<typeof createDocument>>;

/**
 * The default timeout of a test file whose tests stage baselines. Each
 * stages more than 64 segments, encrypted and signed with real keys, once
 * or twice: seconds of work on a busy machine, against a default of five.
 * A file sets it at its top (`setDefaultTimeout`), which holds for that
 * file's tests alone.
 */
export const STAGED_BASELINE_TEST_TIMEOUT_MS = 30_000;

/**
 * One writer's history of `commits` short paragraphs: at the small test
 * sizes a segment holds about two, so 120 commits is a baseline of more
 * segments than one request carries.
 */
export async function createLongHistoryDocument(
  name: string,
  commits = 120,
): Promise<HistoryDocument> {
  const document = await createDocument(name);
  appendHistory(document, commits);
  return document;
}

/** More paragraphs on the end of `document`'s history. */
export function appendHistory(document: HistoryDocument, commits: number) {
  const text = document.getText("text");
  for (let commit = 0; commit < commits; commit += 1) {
    text.insert(
      text.length,
      `paragraph ${text.length} ${"lorem ".repeat(16)}\n`,
    );
    document.commit();
  }
}

/** What a scripted sync route answers a request with instead of committing. */
type ScriptedRefusal = (
  request: DocumentSyncRequest,
  /** The request's place among those the route has seen, from one. */
  ordinal: number,
) => StageCommitRefusal | null;

export async function createStagedHealHarness() {
  const fixture = await createMaterializedSyncFixture();
  // The server marks the bundle stale; the container path itself is current,
  // so the pass verifies and records it as any sync does.
  const staleProjection = {
    ...fixture.writerProjection,
    contentKeyBundleStale: true as const,
  };
  const { documentId } = staleProjection;
  const server = new FakeBaselineStageServer();
  const requests: DocumentSyncRequest[] = [];
  const terminalFailures: DocumentSyncSubmitFailure[] = [];
  const abandonedReasons: string[] = [];
  const traceLines: string[] = [];
  const script: { refuse: ScriptedRefusal | null } = { refuse: null };

  const apiClient: DocumentSyncApi = Object.assign(
    createMockApiClient({
      getDocumentWriterProjection: async () => staleProjection,
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to answer the heal");
      },
      syncDocumentResult: async (_documentId, request) => {
        requests.push(request);
        const [final] = request.outgoingUpdates;
        const refused =
          script.refuse?.(request, requests.length) ??
          (request.baselineStageId && final
            ? server.commit({
                baselineStageId: request.baselineStageId,
                contentKeyEpoch: request.contentKeyEpoch,
                documentId,
                final,
              })
            : null);
        if (refused) return createMockRequestFailure(refused);
        const plan = await buildDocumentSyncPlan({
          author: fixture.author,
          contentKeyBundle: staleProjection.contentKeyBundle,
          documentId,
          documentKekTargets: staleProjection.documentKekTargets,
          documentManifest: staleProjection.documentManifest,
          localVersionVector: null,
        });
        // The writer holds every operation it sent, so nothing is served.
        return {
          data: await createSyncResponse({ ...plan, request }, { updates: [] }),
          ok: true,
        };
      },
    }),
    server.api,
  );

  /** One sync pass of a device whose document is `document`. */
  async function heal(
    document: HistoryDocument,
    execSql: ExecSql,
    options: {
      /** Sent with the request as given: any size makes any request. */
      readonly minLsn?: string | undefined;
      readonly segmentSizes?: HistorySegmentSizes | undefined;
      readonly stillCurrent?: (() => boolean) | undefined;
    } = { segmentSizes: SMALL_BASELINE_SEGMENTS },
  ) {
    return syncRemoteDocument({
      apiClient,
      author: fixture.author,
      buildRotationSnapshot: async () => exportFullHistorySnapshot(document),
      documentId,
      execSql,
      localVersionVector: encodeVersionVector(document),
      minLsn: options.minLsn,
      onSyncAbandoned: (reason) => abandonedReasons.push(reason),
      onSyncTrace: (line) => traceLines.push(line),
      onTerminalSubmitFailure: (failure) => {
        terminalFailures.push(failure);
      },
      pendingUpdates: [await createLoroPendingUpdate("queued edit")],
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      resolveWriterPublicKey: writerKeyResolver(fixture),
      rotationBaselineSegmentSizes: options.segmentSizes,
      stillCurrent: options.stillCurrent,
      targetSecretKey: fixture.secretKey,
      writerProjection: staleProjection,
    });
  }

  return {
    abandonedReasons,
    documentId,
    fixture,
    heal,
    requests,
    script,
    server,
    staleProjection,
    terminalFailures,
    traceLines,
  };
}
