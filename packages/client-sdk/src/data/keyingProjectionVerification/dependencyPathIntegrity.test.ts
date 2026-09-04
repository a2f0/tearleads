import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import type {
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  createAuthor,
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  SIGNED_AT,
} from "../../../test/helpers/containerFixtures";
import { createResponse } from "../../../test/helpers/documentFixtures";
import { createLinkSetResponseFromRequest } from "../../../test/helpers/documentResponseFixtures";
import { createChildContainerProjection } from "../../../test/helpers/projectionHierarchy";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { shareRemoteContainer } from "../../workflows/containers/child/share";
import { buildMaterializedDocumentCreatePlan } from "../../workflows/documents/create";
import { buildMaterializedDocumentLinkSetMutationPlan } from "../../workflows/documents/linkSet";
import { verifyDocumentWriterProjection } from "../keyingProjectionVerification";

// Dependency container paths authorize document link events, and a compromised
// API controls their order. Access along a path is the union of every element's
// grants, so a served path must be a genuine root-to-leaf ancestor chain, or an
// unrelated container an attacker administers could be prefixed to the
// document's container and make the attacker a "writer through" it. The chain
// check itself lives in verifyContainerManifestPath (#2167); these tests pin
// it, and the precedence rules around it, for document dependency paths.

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
      message: expect.stringContaining("does not precede"),
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

// An honest API never lists the head in its own history, so a repeat is
// refused as a malformed projection instead of letting the head reach its
// verification through the history cache.
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

// The authorizing path for a leaf is checkpoint-enforced; a dependency path
// served for the same leaf is not, and only its container-id edges are
// checked, so a server can pair the leaf with an older manifest of the right
// parent. The authorizing path must take precedence whatever order the server
// lists the two in. The listing order already put authorizing paths last, so
// this pins the precedence rather than a reachable overwrite: a writer granted
// only at the parent's current head would otherwise lose (or, in the mirror
// case, gain) access through the document.
test("a stale dependency path never replaces the authorizing path for its leaf", async () => {
  const { close, execSql } = await createTestExecSql(
    "dependency-path-no-overwrite",
  );
  try {
    const parent = await createParentProjection();
    const organizationId = parent.projection.organizationId;
    const malloryKem = generateKemSeedAndKeyPair();
    const mallory = await createAuthor({ organizationId, userId: "mallory" });
    const identities = new Map([
      [
        parent.userId,
        createTestTrustedUserIdentity({
          encapsulationPublicKey: parent.encapsulationPublicKey,
          signingKeyFingerprint: parent.author.signerKeyFingerprint,
          signingPublicKey: parent.signingPublicKey,
          userId: parent.userId,
        }),
      ],
      [
        "mallory",
        createTestTrustedUserIdentity({
          encapsulationPublicKey: malloryKem.publicKey,
          signingKeyFingerprint: mallory.author.signerKeyFingerprint,
          signingPublicKey: mallory.signingPublicKey,
          userId: "mallory",
        }),
      ],
    ]);
    const resolveIdentity = async (userId: string) =>
      identities.get(userId) ?? null;
    // The child is created under the root's first head.
    const child = await createChildContainerProjection({
      containerId: "dependency-no-overwrite-child",
      parent,
      parentProjection: parent.projection,
    });
    // The root then advances by granting Mallory write. A grant keeps the
    // root's KEK epoch, so the child's key edge stays valid under both heads.
    const shared = await shareRemoteContainer({
      accessLevel: "write",
      apiClient: {
        reciteContainer: async () => null,
        getContainerWriterProjection: async () => parent.projection,
        shareContainer: async (_containerId, request) =>
          createMutationResponseFromRequest(request),
      },
      author: parent.author,
      containerId: parent.projection.containerId,
      execSql,
      recipientUserId: "mallory",
      resolveProjectionUserKey: resolveIdentity,
      resolveTrustedUserIdentity: resolveIdentity,
      signedAt: SIGNED_AT,
      targetSecretKey: parent.secretKey,
    });
    const childKek = child.projection.containerKeks.at(-1);
    const [rootFirstHead] = parent.projection.path;
    if (!shared || !childKek || !rootFirstHead) {
      throw new Error("Expected the shared root");
    }
    const childCurrent: ContainerWriterProjectionResponse = {
      ...child.projection,
      containerKeks: [
        {
          ...shared.response.containerKek,
          // The response fixture re-encodes the previous head; serve the same
          // bundle the stale path carries so the two are not equivocal.
          containerManifestHistory: [rootFirstHead],
        },
        childKek,
      ],
      path: [shared.response.accessManifest, child.bundle],
    };
    const childStale = child.projection;
    // The owner creates the document in the child.
    const created = await buildMaterializedDocumentCreatePlan({
      author: parent.author,
      containerProjection: childCurrent,
      documentId: "document-no-overwrite",
      targetSecretKey: parent.secretKey,
      trustedLocalProjection: true,
    });
    const createResponseBody = createResponse(created.plan);
    const initialProjection: DocumentWriterProjectionResponse = {
      authorizingContainerPaths: [childCurrent],
      contentKeyBundle: createResponseBody.contentKeyBundle,
      documentId: createResponseBody.id,
      documentKekTargets: createResponseBody.documentKekTargets,
      documentManifest: createResponseBody.accessManifest,
      documentManifestHistory: [],
      documentManifestContainerPaths: [[...childCurrent.path]],
      documentContainerManifestHistory: [],
    };
    // Mallory, a writer through the child only via the root's current head,
    // links her own root. A link needs write through an already linked
    // container, and the child is the only one.
    const malloryRoot = await createContainerWriterProjectionFixture({
      containerId: "no-overwrite-mallory-root",
      encapsulationPublicKey: malloryKem.publicKey,
      organizationId,
      signerKeyFingerprint: mallory.author.signerKeyFingerprint,
      signerPrivateKey: mallory.author.signerPrivateKey,
      userId: "mallory",
    });
    const malloryLink = await buildMaterializedDocumentLinkSetMutationPlan({
      author: mallory.author,
      operation: "link",
      targetContainerProjection: malloryRoot,
      targetSecretKey: malloryKem.secretKey,
      trustedLocalProjection: true,
      writerProjection: initialProjection,
    });
    const malloryResponse = await createLinkSetResponseFromRequest(
      initialProjection.documentId,
      malloryLink.plan.request,
    );
    const served = (
      childPath: ContainerWriterProjectionResponse,
    ): DocumentWriterProjectionResponse => ({
      ...initialProjection,
      authorizingContainerPaths: [childPath, malloryRoot],
      contentKeyBundle: malloryResponse.contentKeyBundle,
      documentKekTargets: malloryResponse.documentKekTargets,
      documentManifest: malloryResponse.accessManifest,
      documentManifestHistory: [initialProjection.documentManifest],
      // The dependency path for the child pairs it with the root's first
      // head, where Mallory has no access.
      documentManifestContainerPaths: [
        [...childStale.path],
        [...malloryRoot.path],
      ],
    });

    // The control, on a device that has never seen the root advance (the
    // share above already checkpointed it here): were the stale path the
    // authorizing one, Mallory is no writer through the child.
    const control = await createTestExecSql(
      "dependency-path-no-overwrite-control",
    );
    try {
      await expect(
        verifyDocumentWriterProjection({
          execSql: control.execSql,
          projection: served(childStale),
          resolveUserKey: resolveIdentity,
        }),
      ).rejects.toMatchObject({ code: "unauthorized" });
    } finally {
      control.close();
    }
    // With the current head as the authorizing path, her link verifies: the
    // stale dependency path did not take precedence over it.
    await expect(
      verifyDocumentWriterProjection({
        execSql,
        projection: served(childCurrent),
        resolveUserKey: resolveIdentity,
      }),
    ).resolves.toMatchObject({
      manifestHash: malloryResponse.accessManifest.manifestHash,
    });
  } finally {
    close();
  }
});
