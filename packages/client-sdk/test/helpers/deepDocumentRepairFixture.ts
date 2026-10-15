import {
  createTestExecSql,
  registerContainerManifestBundles,
} from "@tearleads/test-utils";
import {
  buildMaterializedDocumentCreatePlan,
  documentWriterProjectionFromCreateResponse,
} from "../../src/workflows/documents/create";
import { createDeepRotatedAncestorFixture } from "./ancestorRotationRecovery";
import { createParentProjectionUserKeyResolver } from "./containerFixtures";
import { createResponseFromRequest } from "./documentResponseFixtures";

/** Sign the common graph once; each case still verifies it on a cold database. */
export async function prepareDeepDocumentRepairFixture(depth: number) {
  const fixture = await createDeepRotatedAncestorFixture(depth);
  const staging = await createTestExecSql("deep-prefix-document-template");
  try {
    const created = await buildMaterializedDocumentCreatePlan({
      ...fixture.input,
      execSql: staging.execSql,
      containerProjection: fixture.leaf,
    });
    const template = {
      root: fixture.root,
      leaf: fixture.leaf,
      projection: {
        ...documentWriterProjectionFromCreateResponse({
          containerProjection: fixture.leaf,
          response: await createResponseFromRequest(created.plan.request),
        }),
        authorizingContainerPaths: [fixture.projection],
      },
    };
    return () => {
      // Include key bytes in the clone and rebuild the resolver around it. No
      // mutable projection, private key, checkpoint, or SQL handle is shared.
      const { root, leaf, projection } = structuredClone(template);
      // The preload clears this registry after each case. Re-register both
      // the original chain and its rotated head for response citation lookup.
      registerContainerManifestBundles([
        ...leaf.path,
        ...projection.authorizingContainerPaths.flatMap((path) => path.path),
      ]);
      return {
        root,
        projection,
        input: {
          author: root.author,
          persistVerificationCheckpoints: false,
          resolveProjectionUserKey: createParentProjectionUserKeyResolver(root),
          targetSecretKey: root.secretKey,
        },
      };
    };
  } finally {
    staging.close();
  }
}
