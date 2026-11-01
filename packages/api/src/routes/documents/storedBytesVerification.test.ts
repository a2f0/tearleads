import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import {
  createRemoteContainer,
  createRemoteDocument,
  decryptDocumentAttachmentBlob,
  rekeyRemoteContainer,
  syncRemoteDocument,
  unwrapContainerKekPath,
  uploadDocumentAttachment,
} from "@tearleads/client-sdk";
import {
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  wrapContentKey,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestUser } from "@tearleads/test-utils";
import { createAncestorSdkContext } from "../../../test/helpers/ancestorSdkRepair";
import { writerResolver } from "../../../test/helpers/coldSdkRematerialization";
import { withDocumentMutationArtifacts } from "../../../test/helpers/documentAcknowledgementFixture";
import { buildDocumentLinkRequest } from "../../../test/helpers/documentLinkMutation";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { recoverRegisteredRootKek } from "../../../test/helpers/registeredRootKek";
import { withStoredContainerMutation } from "../../../test/helpers/storedContainerMutation";
import { routeApp } from "../../routeApp";

const SLOT_ID = "stored-bytes";

/**
 * Hash acknowledgements let the writing client keep its own signed plan, so
 * only another device ever reads the stored bytes back. This commits a
 * container create and rekey, a document create, a link set, and an
 * attachment bind through the real routes, then has a cold device read every
 * projection the server now serves and verify it with the real SDK: a signed
 * field stored non-verbatim fails here instead of on other devices.
 */
test("a cold device verifies every hash-acknowledged write from its stored bytes", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await recoverRegisteredRootKek({
    owner,
    root: await bootstrapRoot(owner),
  });
  const organizationId = asVerifiedContainerManifest(root.bundle).state
    .organizationId;
  const device = await createAncestorSdkContext(owner, organizationId);
  const cold = await createAncestorSdkContext(owner, organizationId);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => routeApp.fetch(request),
  });
  const client = new ApiClient(server.url.origin);
  client.setAuthToken(owner.token);
  const common = {
    ...device.common,
    apiClient: client,
    reportSecurityIncident: async () => undefined,
    resolveTrustedUserIdentity: device.resolveTrustedUserIdentity,
  };
  try {
    // Container mutations: a child create, then its rekey.
    const child = await createRemoteContainer({
      ...common,
      parentContainerId: root.kekState.containerId,
      parentSecretKey: owner.kem.secretKey,
    });
    if (!child) throw new Error("Expected encrypted child");
    const rekeyed = await rekeyRemoteContainer({
      ...common,
      containerId: child.containerId,
    });
    if (!rekeyed) throw new Error("Expected child rekey");

    // Document create in the root.
    const created = await createRemoteDocument({
      ...common,
      containerId: root.kekState.containerId,
    });
    if (!created?.response || !created.plan) {
      throw new Error("Expected a fresh encrypted document");
    }

    // Link set: add the rekeyed child.
    client.clearWriterProjectionCaches();
    const childProjection = await client.getContainerWriterProjection(
      child.containerId,
    );
    if (!childProjection) throw new Error("Expected child projection");
    const childKeys = await unwrapContainerKekPath({
      ...common,
      projection: childProjection,
      secretKey: owner.kem.secretKey,
    });
    const request = await buildDocumentLinkRequest({
      child: await withStoredContainerMutation(rekeyed.response),
      createdDocument: withDocumentMutationArtifacts(
        created.plan.request,
        created.response,
      ),
      owner,
      root,
    });
    const signedTargets = await Promise.all(
      request.contentKeyBundle.targets.map(async (target) => {
        if (target.containerId !== child.containerId) return target;
        const childKey = childKeys.get(target.containerKeyEpochId);
        if (!childKey) throw new Error("Expected the rekeyed child KEK");
        const wrapped = await wrapContentKey(created.contentKey, childKey, {
          kind: "Document",
          objectId: created.documentId,
          contentKeyEpoch: request.contentKeyBundle.contentKeyEpoch,
          containerId: target.containerId,
          containerKeyEpochId: target.containerKeyEpochId,
        });
        return {
          ...target,
          wrappedKey: bytesToBase64(wrapped.ciphertext),
          wrappingMetadata: {
            suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
            iv: bytesToBase64(wrapped.iv),
          },
        };
      }),
    );
    const linked = await client.linkDocument(created.documentId, {
      ...request,
      contentKeyBundle: { ...request.contentKeyBundle, targets: signedTargets },
    });
    if (!linked) throw new Error("Expected document link");

    // Attachment bind.
    client.clearWriterProjectionCaches();
    const plaintext = new Uint8Array([2, 7, 1, 8, 2, 8]);
    const uploaded = await uploadDocumentAttachment({
      ...common,
      bytes: plaintext,
      contentKey: crypto.getRandomValues(new Uint8Array(32)),
      documentId: created.documentId,
      expectedBindingId: null,
      slotId: SLOT_ID,
    });
    if (!uploaded) throw new Error("Expected encrypted attachment");

    // A cold device with a fresh client reads everything back.
    const fresh = new ApiClient(server.url.origin);
    fresh.setAuthToken(owner.token);
    const coldCommon = {
      ...cold.common,
      apiClient: fresh,
      reportSecurityIncident: async () => undefined,
      resolveTrustedUserIdentity: cold.resolveTrustedUserIdentity,
    };

    const servedChild = await fresh.getContainerWriterProjection(
      child.containerId,
    );
    if (!servedChild) throw new Error("Expected served child projection");
    const servedChildKeys = await unwrapContainerKekPath({
      ...coldCommon,
      projection: servedChild,
      secretKey: owner.kem.secretKey,
    });
    expect([...servedChildKeys.keys()]).toEqual([...childKeys.keys()]);

    const servedDocument = await fresh.getDocumentWriterProjection(
      created.documentId,
    );
    if (!servedDocument) throw new Error("Expected served document projection");
    // The link set's head, with the create's head as its history.
    expect(servedDocument.documentManifestHistory).toHaveLength(1);
    expect(servedDocument.authorizingContainerPaths).toHaveLength(2);
    const read = await syncRemoteDocument({
      ...coldCommon,
      documentId: created.documentId,
      writerProjection: servedDocument,
      localVersionVector: null,
      pendingUpdates: [],
      resolveWriterPublicKey: writerResolver(owner),
      validateIncomingUpdates: () => undefined,
    });
    if (!read) throw new Error("Expected a verified document read");
    expect(read.contentKey).toEqual(created.contentKey);

    const bindings = await fresh.listDocumentAttachments(created.documentId);
    const binding = bindings?.find((entry) => entry.slotId === SLOT_ID);
    if (!binding) throw new Error("Expected the served attachment binding");
    expect(binding.blobId).toBe(uploaded.blobId);
    const encrypted = await fresh.getBlobBytes(uploaded.blobId);
    if (!encrypted) throw new Error("Expected stored encrypted blob bytes");
    expect(
      await decryptDocumentAttachmentBlob({
        ...coldCommon,
        binding,
        encryptedBytes: new Uint8Array(
          await new Response(encrypted.encryptedBytes).arrayBuffer(),
        ),
        expectedDocumentId: created.documentId,
        expectedSlotId: SLOT_ID,
        targetSecretKey: owner.kem.secretKey,
        writerProjection: servedDocument,
      }),
    ).toEqual(plaintext);
  } finally {
    server.stop(true);
    cold.close();
    device.close();
  }
}, 120_000);
