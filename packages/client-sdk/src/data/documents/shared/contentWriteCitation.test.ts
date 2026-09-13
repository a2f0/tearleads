import { expect, test } from "bun:test";
import {
  computeDocumentContentKeyTargetHash,
  generateSigningSeedAndKeyPair,
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

test("historical content writes retain a grant added after the leaf parent pin", async () => {
  const scenario = await createScenario();
  const { alice, child1, root1 } = scenario;
  const writer = { userId: "wendy", keyPair: generateSigningSeedAndKeyPair() };
  const root2 = await grantBy({
    cited: [root1.manifestHash],
    previous: root1,
    signer: alice,
    subjectId: writer.userId,
  });
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
    signer: alice.keyPair,
    signerUserId: alice.userId,
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
      dependencyManifestHashes: [
        root2.manifestHash,
        child1.manifestHash,
      ].sort(),
      contentKeyBundle,
      manifestHash: document.manifestHash,
      plan: { documentId, organizationId, documentWriterAuthorization: source },
      targetHash,
    });
    if (!authorization) throw new Error("Expected historical authorization");
    const header = await createWriteHeaderFixture({
      dependencyManifestHashes: [root2.manifestHash, child1.manifestHash],
      accessManifestHash: document.manifestHash,
      objectId: documentId,
      organizationId,
      signing: writer.keyPair,
      targetHash,
      writerUserId: writer.userId,
    });
    const input = {
      header,
      expectedAccessManifestHash: document.manifestHash,
      expectedTargetHash: targetHash,
      writerPublicKey: writer.keyPair.signingPublicKey,
    };
    // The API commits this valid write through the newly granted ancestor.
    const committed = await verifyWriteHeader({
      ...input,
      documentAuthorization: {
        ...authorization,
        authorizingContainerPaths: [[root2, child1]],
      },
    });
    expect(committed.ok).toBe(true);
    // Once the child advances, the SDK must still use that write-time path.
    const imported = await verifyWriteHeader({
      ...input,
      documentAuthorization: authorization,
    });
    expect(imported.ok).toBe(true);
  } finally {
    database.close();
  }
});
