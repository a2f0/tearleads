import { expect, test } from "bun:test";
import {
  createMockApiClient,
  createMockRequestFailure,
  createTestExecSql,
} from "@tearleads/test-utils";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { createRotatedAncestorFixture } from "../../../test/helpers/ancestorRotationRecovery";
import { createMutationResponseFromRequest } from "../../../test/helpers/containerFixtures";
import { writerKeyResolver } from "../../../test/helpers/documentFixtures";
import {
  createPendingUpdateRecord,
  createResponseFromRequest,
} from "../../../test/helpers/documentResponseFixtures";
import { createFullHistoryRotationSnapshot } from "../../../test/helpers/staleBundleSyncFixture";
import {
  buildMaterializedDocumentCreatePlan,
  documentWriterProjectionFromCreateResponse,
} from "./create";
import { syncRemoteDocument } from "./sync";
import {
  prepareAutomaticContainerRekeys,
  requireStandaloneAncestorRepairs,
} from "./syncContainerRekeyPreparation";

type Fixture = Awaited<ReturnType<typeof createRotatedAncestorFixture>>;

async function createStaleDocumentProjection(fixture: Fixture) {
  const staging = await createTestExecSql("inline-refused-document");
  try {
    const created = await buildMaterializedDocumentCreatePlan({
      ...fixture.input,
      execSql: staging.execSql,
      containerProjection: fixture.grandchild.projection,
    });
    const original = documentWriterProjectionFromCreateResponse({
      containerProjection: fixture.grandchild.projection,
      response: await createResponseFromRequest(created.plan.request),
    });
    return { ...original, authorizingContainerPaths: [fixture.projection] };
  } finally {
    staging.close();
  }
}

function standaloneRekeyRecorder(fixture: Fixture, committed: string[]) {
  const previousKeks = new Map(
    fixture.projection.containerKeks.map((kek) => [kek.containerId, kek]),
  );
  return async (
    containerId: string,
    request: Parameters<typeof createMutationResponseFromRequest>[0],
  ) => {
    committed.push(containerId);
    return createMutationResponseFromRequest(
      request,
      previousKeks.get(containerId),
    );
  };
}

// #2340 finding 1. A document write's flat rekey list cannot say which
// descendants each repair must carry, so an inline batch the server refuses for
// stranding a level above a directly granted container is redone standalone,
// where each rekey carries its own.

test("a pass told to repair standalone commits every repair before writing", async () => {
  const fixture = await createRotatedAncestorFixture();
  const projection = await createStaleDocumentProjection(fixture);
  const database = await createTestExecSql("inline-refused-standalone");
  try {
    const committed: string[] = [];
    const sync = {
      ...fixture.input,
      apiClient: createMockApiClient({
        rekeyContainer: standaloneRekeyRecorder(fixture, committed),
      }),
      buildRotationSnapshot: createFullHistoryRotationSnapshot,
      documentId: projection.documentId,
      execSql: database.execSql,
      localVersionVector: null,
      resolveWriterPublicKey: writerKeyResolver(fixture.root),
      validateIncomingUpdates: () => undefined,
    };
    // Two stale levels fit inline, so an ordinary pass commits nothing itself.
    const inline = await prepareAutomaticContainerRekeys(sync, projection);
    expect(inline.plans).toHaveLength(2);
    expect(committed).toEqual([]);

    requireStandaloneAncestorRepairs(sync);
    // The mock serves no refreshed projection, so the pass stops after the
    // standalone round; what matters is that both repairs were committed.
    await expect(
      prepareAutomaticContainerRekeys(sync, projection),
    ).rejects.toThrow(/abandoned: unrefreshable/);
    expect(committed).toEqual(["child", "grandchild"]);
  } finally {
    database.close();
  }
}, 120_000);

test("a refused inline batch retries the pass with standalone repairs", async () => {
  const fixture = await createRotatedAncestorFixture();
  const projection = await createStaleDocumentProjection(fixture);
  const database = await createTestExecSql("inline-refused-retry");
  try {
    const committed: string[] = [];
    const submittedInlineRekeys: number[] = [];
    const terminal: Array<string | undefined> = [];
    const pass = syncRemoteDocument({
      ...fixture.input,
      apiClient: createMockApiClient({
        // A retry drops the cached projection and refetches it.
        getDocumentWriterProjection: async () => projection,
        rekeyContainer: standaloneRekeyRecorder(fixture, committed),
        syncDocumentResult: async (_documentId, request) => {
          submittedInlineRekeys.push(request.containerRekeys?.length ?? 0);
          return createMockRequestFailure({
            code: DOCUMENT_SYNC_ERROR_CODES.descendantRekeysRequired,
            message: "Container rotation must carry its descendant rekeys",
            status: 409,
          });
        },
      }),
      buildRotationSnapshot: createFullHistoryRotationSnapshot,
      documentId: projection.documentId,
      execSql: database.execSql,
      localVersionVector: null,
      onTerminalSubmitFailure: (failure) => {
        terminal.push(failure.code);
      },
      pendingUpdates: [createPendingUpdateRecord()],
      resolveWriterPublicKey: writerKeyResolver(fixture.root),
      validateIncomingUpdates: () => undefined,
      writerProjection: projection,
    });
    // This mock keeps serving the pre-repair projection, which after the
    // standalone repairs have pinned is a replayed chain and is refused as one.
    await expect(pass).rejects.toMatchObject({ code: "rollback" });
    // One inline attempt, refused; it is not a terminal failure, and the retry
    // commits the same repairs standalone instead of resubmitting them inline.
    expect(submittedInlineRekeys).toEqual([2]);
    expect(terminal).toEqual([]);
    expect(committed).toEqual(["child", "grandchild"]);
  } finally {
    database.close();
  }
}, 120_000);
