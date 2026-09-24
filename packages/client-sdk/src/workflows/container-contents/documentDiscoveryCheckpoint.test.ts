import { expect, test } from "bun:test";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import { createWorkflowInputFixture } from "../../../test/helpers/internalRuntimeFixtures";
import { createQueuedDocumentMoveRemote } from "../../../test/helpers/queuedDocumentMoveRemote";
import { sqlDocumentContainerProjectionPersistence as links } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import { loadLocalDocumentAccessEpoch } from "../../data/persistence/documents/containerDocumentTombstoneHoldsPersistence";
import { createDocumentDiscoveryEvidenceStore } from "../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import {
  applyContainerDocumentTombstones,
  sqlDocumentsPersistence as documents,
} from "../../data/persistence/documents/documentsPersistence";
import { buildMaterializedDocumentLinkSetMutationPlan } from "../documents/linkSet";
import { createDiscoveredDocumentVerifier } from "./documentDiscoveryEvidence";
import {
  createContainerDocumentTombstoneVerifier,
  createDocumentHeadLinkSetLoader,
} from "./documentTombstoneEvidence";
import { createContainerContentsWorkflowRuntime } from "./runtime";

async function createLinkedFixture() {
  const fixture = await createMaterializedSyncFixture();
  const extra = await createContainerWriterProjectionFixture({
    containerId: "checkpoint-extra",
    encapsulationPublicKey: fixture.publicKey,
    organizationId: fixture.author.organizationId,
    signerKeyFingerprint: fixture.author.signerKeyFingerprint,
    signerPrivateKey: fixture.author.signerPrivateKey,
    userId: fixture.author.signerUserId,
  });
  const remote = createQueuedDocumentMoveRemote({
    containerProjections: [fixture.projection, extra],
    remoteRequests: [],
    submittedOperations: [],
    unlinkAvailable: true,
    writerProjection: fixture.writerProjection,
  });
  const link = await buildMaterializedDocumentLinkSetMutationPlan({
    author: fixture.author,
    operation: "link",
    targetContainerProjection: extra,
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: remote.writerProjection,
    prepareBlobRewraps: async () => [],
  });
  await remote.submitLink(
    remote.writerProjection.documentId,
    link.plan.request,
  );
  return { fixture, remote };
}

test("a cached discovery head cannot resurrect a placement removed by a newer signed tombstone", async () => {
  const { fixture, remote } = await createLinkedFixture();
  const { execSql, close } = await createTestExecSql(
    "discovery-checkpoint-rollback",
  );
  try {
    const oldProjection = remote.writerProjection;
    const documentId = oldProjection.documentId;
    const containerId = fixture.projection.containerId;
    const at = "2026-09-23T00:00:00.000Z";
    const runtime = createContainerContentsWorkflowRuntime(
      createWorkflowInputFixture({
        execSql,
        resolveTrustedUserIdentity: fixture.resolveProjectionUserKey,
        apiClient: {
          evictDocumentWriterProjection: () => {},
          getCurrentPrincipalPolicy: async () => null,
          getDocumentWriterProjectionResult: async () => ({
            ok: true,
            data: remote.writerProjection,
          }),
        } as never,
      }),
    );
    const load = createDocumentHeadLinkSetLoader(runtime);
    const store = createDocumentDiscoveryEvidenceStore(execSql);
    const loadEpoch = (id: string) => loadLocalDocumentAccessEpoch(execSql, id);
    const verify = createDiscoveredDocumentVerifier(load, loadEpoch, store);
    const oldHead = await load(documentId);
    if (!oldHead || oldHead === "not-found")
      throw new Error("Expected signed initial head");
    const candidate = {
      documentId,
      containerId,
      listedContainerIds: [containerId],
      accessEpoch: oldHead.accessEpoch,
      accessStateHash: oldProjection.documentManifest.manifestHash,
      linkedContainerIds: oldHead.linkedContainerIds,
      createdAt: at,
    };
    const first = await verify([candidate], [containerId], await store.begin());
    expect(first.inputs).toHaveLength(1);
    const input = first.inputs[0];
    if (!input) throw new Error("Expected first discovery input");
    await documents.ensureSchema(execSql);
    const local = await documents.upsertDiscoveredDocument(execSql, input);
    await links.replaceDocumentLinks(
      execSql,
      documentId,
      input.linkedContainerIds,
    );
    await first.commit();
    expect(
      await store.loadHead(documentId, candidate.accessStateHash),
    ).not.toBeNull();

    const unlink = await buildMaterializedDocumentLinkSetMutationPlan({
      author: fixture.author,
      operation: "unlink",
      targetContainerProjection: fixture.projection,
      targetSecretKey: fixture.secretKey,
      trustedLocalProjection: true,
      writerProjection: remote.writerProjection,
      prepareBlobRewraps: async () => [],
    });
    await remote.submitUnlink(documentId, unlink.plan.request);
    const [verdict] = await createContainerDocumentTombstoneVerifier(
      load,
      loadEpoch,
    )([{ containerId, documentId, updatedAt: at }]);
    expect(verdict?.kind).toBe("verified");
    if (verdict?.kind !== "verified")
      throw new Error("Expected signed unlink evidence");
    await applyContainerDocumentTombstones(execSql, [verdict.tombstone]);
    // The local document row intentionally still has the old access epoch.
    expect((await documents.loadDocument(execSql, local.id))?.accessEpoch).toBe(
      candidate.accessEpoch,
    );
    remote.writerProjection = oldProjection;
    const replay = await verify(
      [candidate],
      [containerId],
      await store.begin(),
    );
    expect(replay.inputs).toEqual([]);
    expect(await replay.commit()).toBe(false);
  } finally {
    close();
  }
});
