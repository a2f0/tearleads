import { expect, test } from "bun:test";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../test/helpers/containerFixtures";
import { createResponse } from "../../../test/helpers/documentFixtures";
import { createLinkSetResponseFromRequest } from "../../../test/helpers/documentResponseFixtures";
import { buildMaterializedDocumentCreatePlan } from "../../workflows/documents/create";
import { buildMaterializedDocumentLinkSetMutationPlan } from "../../workflows/documents/linkSet";
import { verifyDocumentWriterProjection } from "../keyingProjectionVerification";

// Dependency container paths authorize document link events, and a compromised
// API controls their order. Access along a path is the union of every element's
// grants, so a served path must be a genuine root-to-leaf ancestor chain, or an
// unrelated container an attacker administers could be prefixed to the
// document's container and make the attacker a "writer through" it.

async function createScenario() {
  const parent = await createParentProjection();
  const other = await createContainerWriterProjectionFixture({
    containerId: "other-root-container",
    encapsulationPublicKey: parent.encapsulationPublicKey,
    organizationId: parent.projection.organizationId,
    signerKeyFingerprint: parent.author.signerKeyFingerprint,
    signerPrivateKey: parent.author.signerPrivateKey,
    userId: parent.userId,
  });
  const created = await buildMaterializedDocumentCreatePlan({
    author: parent.author,
    containerProjection: parent.projection,
    documentId: "document-dependency-path-integrity",
    targetSecretKey: parent.secretKey,
    trustedLocalProjection: true,
  });
  const createResponseBody = createResponse(created.plan);
  const initialProjection: DocumentWriterProjectionResponse = {
    authorizingContainerPaths: [parent.projection],
    contentKeyBundle: createResponseBody.contentKeyBundle,
    documentId: createResponseBody.id,
    documentKekTargets: createResponseBody.documentKekTargets,
    documentManifest: createResponseBody.accessManifest,
    documentManifestHistory: [],
    documentManifestContainerPaths: [[...parent.projection.path]],
    documentContainerManifestHistory: [],
  };
  return {
    initialProjection,
    other,
    parent,
    resolveUserKey: createParentProjectionUserKeyResolver(parent),
  };
}

async function linkedHeadProjection(
  scenario: Awaited<ReturnType<typeof createScenario>>,
): Promise<DocumentWriterProjectionResponse> {
  const { initialProjection, other, parent } = scenario;
  const linked = await buildMaterializedDocumentLinkSetMutationPlan({
    author: parent.author,
    operation: "link",
    targetContainerProjection: other,
    targetSecretKey: parent.secretKey,
    trustedLocalProjection: true,
    writerProjection: initialProjection,
  });
  const linkResponse = await createLinkSetResponseFromRequest(
    initialProjection.documentId,
    linked.plan.request,
  );
  return {
    ...initialProjection,
    authorizingContainerPaths: [other],
    contentKeyBundle: linkResponse.contentKeyBundle,
    documentKekTargets: linkResponse.documentKekTargets,
    documentManifest: linkResponse.accessManifest,
    documentManifestHistory: [initialProjection.documentManifest],
    documentManifestContainerPaths: [
      [...parent.projection.path],
      [...other.path],
    ],
  };
}

test("a dependency path must be a root-to-leaf ancestor chain", async () => {
  const scenario = await createScenario();
  const [parentRoot] = scenario.parent.projection.path;
  const [otherRoot] = scenario.other.path;
  if (!parentRoot || !otherRoot) {
    throw new Error("Expected root manifests for both containers");
  }
  // The server prefixes the document's container with an unrelated root whose
  // grants would otherwise count toward access on the leaf.
  const projection: DocumentWriterProjectionResponse = {
    ...scenario.initialProjection,
    documentManifestContainerPaths: [[otherRoot, parentRoot]],
  };
  const { close, execSql } = await createTestExecSql(
    "dependency-path-not-ancestor-chain",
  );
  try {
    await expect(
      verifyDocumentWriterProjection({
        execSql,
        projection,
        resolveUserKey: scenario.resolveUserKey,
      }),
    ).rejects.toMatchObject({
      code: "object_mismatch",
      message: expect.stringContaining("parent container"),
    });
  } finally {
    close();
  }
});

test("a new head citing genuine dependency paths still verifies", async () => {
  const scenario = await createScenario();
  const { close, execSql } = await createTestExecSql(
    "dependency-path-genuine-link",
  );
  try {
    await verifyDocumentWriterProjection({
      execSql,
      projection: scenario.initialProjection,
      resolveUserKey: scenario.resolveUserKey,
    });
    const linkedHead = await linkedHeadProjection(scenario);
    await expect(
      verifyDocumentWriterProjection({
        execSql,
        projection: linkedHead,
        resolveUserKey: scenario.resolveUserKey,
      }),
    ).resolves.toMatchObject({
      manifestHash: linkedHead.documentManifest.manifestHash,
    });
  } finally {
    close();
  }
});

// History is verified without checkpoint enforcement and cached by hash, so a
// head smuggled into the history would reach the head verification through the
// cache with its checks skipped.
test("the current head cannot be repeated in the manifest history", async () => {
  const scenario = await createScenario();
  const linkedHead = await linkedHeadProjection(scenario);
  const { close, execSql } = await createTestExecSql(
    "dependency-path-head-in-history",
  );
  try {
    await expect(
      verifyDocumentWriterProjection({
        execSql,
        projection: {
          ...linkedHead,
          documentManifestHistory: [
            linkedHead.documentManifest,
            ...linkedHead.documentManifestHistory,
          ],
        },
        resolveUserKey: scenario.resolveUserKey,
      }),
    ).rejects.toMatchObject({ code: "duplicate_entry" });
  } finally {
    close();
  }
});
