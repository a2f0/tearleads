import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createRotatedAncestorFixture } from "../../../../../test/helpers/ancestorRotationRecovery";
import { createResponseFromRequest } from "../../../../../test/helpers/documentResponseFixtures";
import {
  buildMaterializedDocumentCreatePlan,
  documentWriterProjectionFromCreateResponse,
} from "../../../../workflows/documents/create";
import { wrapBlobContentKey } from "./projection";

test("blob wrapping checks every ancestor of its targets without blocking on an unrelated stale path", async () => {
  const fixture = await createRotatedAncestorFixture();
  const database = await createTestExecSql("blob-target-path-currency");
  try {
    const created = await buildMaterializedDocumentCreatePlan({
      ...fixture.input,
      execSql: database.execSql,
      containerProjection: fixture.root.projection,
    });
    const rootPath = {
      ...fixture.projection,
      containerId: fixture.root.projection.containerId,
      path: fixture.projection.path.slice(0, 1),
      containerKeks: fixture.projection.containerKeks.slice(0, 1),
    };
    const writerProjection = {
      ...documentWriterProjectionFromCreateResponse({
        containerProjection: fixture.root.projection,
        response: await createResponseFromRequest(created.plan.request),
      }),
      authorizingContainerPaths: [rootPath, fixture.projection],
    };
    const targetFor = (path: typeof rootPath) => {
      const kek = path.containerKeks.at(-1);
      const head = path.path.at(-1);
      if (!kek || !head) throw new Error("Expected KEK path");
      return {
        bindingId: crypto.randomUUID(),
        documentId: writerProjection.documentId,
        containerId: path.containerId,
        containerKeyEpoch: kek.containerKeyEpoch,
        containerKeyEpochId: kek.containerKeyEpochId,
        containerManifestHash: head.manifestHash,
      };
    };
    const input = {
      ...fixture.input,
      execSql: database.execSql,
      contentKey: crypto.getRandomValues(new Uint8Array(32)),
      secretKey: fixture.root.secretKey,
      writerProjection,
    };
    const target = targetFor(rootPath);
    expect(
      await wrapBlobContentKey({ ...input, targets: [target] }),
    ).toMatchObject([target]);
    await expect(
      wrapBlobContentKey({
        ...input,
        targets: [targetFor(fixture.projection)],
      }),
    ).rejects.toThrow("ancestor KEK repair for child");
  } finally {
    database.close();
  }
});
