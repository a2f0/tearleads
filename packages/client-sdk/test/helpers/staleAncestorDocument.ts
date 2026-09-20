import { createTestExecSql } from "@tearleads/test-utils";
import {
  buildMaterializedDocumentCreatePlan,
  documentWriterProjectionFromCreateResponse,
} from "../../src/workflows/documents/create";
import { createRotatedAncestorFixture } from "./ancestorRotationRecovery";
import { createResponseFromRequest } from "./documentResponseFixtures";

export async function documentWithStaleAncestors() {
  const fixture = await createRotatedAncestorFixture();
  const database = await createTestExecSql("stale-ancestor-document");
  try {
    const input = { ...fixture.input, execSql: database.execSql };
    const created = await buildMaterializedDocumentCreatePlan({
      ...input,
      containerProjection: fixture.grandchild.projection,
    });
    const original = documentWriterProjectionFromCreateResponse({
      containerProjection: fixture.grandchild.projection,
      response: await createResponseFromRequest(created.plan.request),
    });
    return {
      fixture,
      input,
      database,
      projection: {
        ...original,
        authorizingContainerPaths: [fixture.projection],
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
