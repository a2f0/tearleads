import { expect, test } from "bun:test";
import {
  computeDocumentContentKeyTargetHash,
  verifyWriteHeader,
} from "@tearleads/crypto";
import {
  createDocumentLinkSetManifestFixture,
  createVerifiedDocumentAccessEvent,
  createWriteHeaderFixture,
} from "@tearleads/crypto/test-fixtures";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createScenario,
  grantBy,
  manifestBundle,
} from "../../../../test/helpers/ancestorCitationScenario";
import { verifyDocumentWriterProjectionAuthorization } from "../../keyingProjectionVerification";
import { loadAccessManifestCheckpoint } from "../../persistence/keyingCheckpointPersistence";
import { documentWriteAuthorizationForHeader } from "./syncResponseAuthorization";

test("a new-to-device document head and its historical write retain cited ancestor authority", async () => {
  const scenario = await createScenario();
  const { alice, mallory, child1, root1, root2 } = scenario;
  if (!child1.state.containerKeyEpochId)
    throw new Error("Expected child key epoch");
  const child2 = await grantBy({
    cited: [root2.manifestHash, child1.manifestHash],
    previous: child1,
    signer: alice,
    subjectId: "another-reader",
  });
  const documentId = "historical-write-document";
  const organizationId = root1.state.organizationId;
  const event = await createVerifiedDocumentAccessEvent({
    body: {
      eventType: "document.link",
      containerId: child1.state.containerId,
      containerManifestHash: child1.manifestHash,
    },
    dependencyManifestHashes: [root1.manifestHash, child1.manifestHash],
    objectId: documentId,
    organizationId,
    previousManifestHash: null,
    signer: mallory.keyPair,
    signerUserId: mallory.userId,
  });
  const document = await createDocumentLinkSetManifestFixture({
    documentId,
    event,
    linkedContainerIds: [child1.state.containerId],
    organizationId,
  });
  const targets = [
    {
      containerId: child1.state.containerId,
      containerKeyEpoch: 1,
      containerKeyEpochId: child1.state.containerKeyEpochId,
      containerManifestHash: child1.manifestHash,
    },
  ];
  const targetHash = await computeDocumentContentKeyTargetHash(targets);
  const contentKeyBundle = {
    documentId,
    contentKeyEpoch: 1,
    linkSetManifestHash: document.manifestHash,
    targetHash,
    targets: targets.map((target) => ({
      ...target,
      wrappedKey: "unused-by-authorization",
      wrappingMetadata: {},
    })),
  };
  const projection: DocumentWriterProjectionResponse = {
    documentId,
    documentManifest: {
      event: {
        body: event.body,
        event: { ...event.event },
        eventHash: event.eventHash,
      },
      manifest: { ...document.manifest },
      manifestHash: document.manifestHash,
      state: { ...document.state },
    },
    documentManifestHistory: [],
    // Only the newer path is grouped. The old target and its parent are real
    // signed predecessors verified recursively, not synthetic branded heads.
    documentManifestContainerPaths: [[root2, child2].map(manifestBundle)],
    documentContainerManifestHistory: [root1, child1].map(manifestBundle),
    authorizingContainerPaths: [],
    contentKeyBundle,
    documentKekTargets: {
      documentId,
      documentKeyTargetHash: targetHash,
      linkSetManifestHash: document.manifestHash,
      linkedContainerKeyEpochIds: targets.map(
        (target) => target.containerKeyEpochId,
      ),
      linkedContainerManifestHashes: [child1.manifestHash],
      targets,
    },
  };
  const database = await createTestExecSql("historical-write-authorization");
  try {
    const source = await verifyDocumentWriterProjectionAuthorization({
      execSql: database.execSql,
      projection,
      resolveUserKey: scenario.resolveUserKey,
    });
    // The current document head is accepted and pinned at its historical
    // citations despite the served root's later revocation. Distinguishing a
    // delayed honest head from a server-assisted later forgery is #1555 scope.
    expect(
      (
        await loadAccessManifestCheckpoint(
          database.execSql,
          "document",
          organizationId,
          documentId,
        )
      )?.manifestHash,
    ).toBe(document.manifestHash);
    const authorization = await documentWriteAuthorizationForHeader({
      allowMissingAuthorization: false,
      authorizationTargets: targets,
      contentKeyBundle,
      manifestHash: document.manifestHash,
      plan: { documentId, organizationId, documentWriterAuthorization: source },
      targetHash,
    });
    if (!authorization) throw new Error("Expected historical authorization");
    expect(
      authorization.authorizingContainerPaths[0]?.map(
        (head) => head.manifestHash,
      ),
    ).toEqual([root1.manifestHash, child1.manifestHash]);
    expect(child1.state.directGrants).toEqual([]);
    const header = await createWriteHeaderFixture({
      accessManifestHash: document.manifestHash,
      objectId: documentId,
      organizationId,
      signing: mallory.keyPair,
      targetHash,
      writerUserId: mallory.userId,
    });
    const input = {
      header,
      expectedAccessManifestHash: document.manifestHash,
      expectedTargetHash: targetHash,
      writerPublicKey: mallory.keyPair.signingPublicKey,
    };
    expect(
      (
        await verifyWriteHeader({
          ...input,
          documentAuthorization: authorization,
        })
      ).ok,
    ).toBe(true);
    // Neither a singleton child nor the newer revoked ancestor authorizes it.
    for (const path of [[child1], [root2, child1]]) {
      const refused = await verifyWriteHeader({
        ...input,
        documentAuthorization: {
          ...authorization,
          authorizingContainerPaths: [path],
        },
      });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe("unauthorized");
    }
  } finally {
    database.close();
  }
});
