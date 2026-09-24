import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  buildMaterializedDocumentCreatePlan,
  documentWriterProjectionFromCreateResponse,
} from "../../src/workflows/documents/create";
import { createDeepRotatedAncestorFixture } from "./ancestorRotationRecovery";
import { writerKeyResolver } from "./documentFixtures";
import { createResponseFromRequest } from "./documentResponseFixtures";
import { createFullHistoryRotationSnapshot } from "./staleBundleSyncFixture";

export async function withStaleDocument(
  depth: number,
  run: (input: Awaited<ReturnType<typeof setup>>) => Promise<void>,
) {
  const fixture = await setup(depth);
  try {
    await run(fixture);
  } finally {
    fixture.database.close();
  }
}
async function setup(depth: number) {
  const fixture = await createDeepRotatedAncestorFixture(depth);
  const database = await createTestExecSql(`repair-boundary-${depth}`);
  const created = await buildMaterializedDocumentCreatePlan({
    ...fixture.input,
    execSql: database.execSql,
    containerProjection: fixture.leaf,
  });
  const projection = {
    ...documentWriterProjectionFromCreateResponse({
      containerProjection: fixture.leaf,
      response: await createResponseFromRequest(created.plan.request),
    }),
    authorizingContainerPaths: [fixture.projection],
  };
  return {
    fixture,
    database,
    projection,
    sync: {
      ...fixture.input,
      execSql: database.execSql,
      apiClient: createMockApiClient(),
      buildRotationSnapshot: createFullHistoryRotationSnapshot,
      documentId: projection.documentId,
      localVersionVector: null,
      resolveWriterPublicKey: writerKeyResolver(fixture.root),
      validateIncomingUpdates: () => undefined,
    },
  };
}
