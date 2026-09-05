import { expect, spyOn, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  cacheReferencedPrincipalPolicies,
  createRemoteContainer,
  createRemoteDocument,
  decryptDocumentAttachmentBlob,
  shareRemoteContainer,
  uploadDocumentAttachment,
} from "@tearleads/client-sdk";
import { createTestTrustedUserIdentityResolver } from "@tearleads/client-sdk/testing";
import { createTestExecSql } from "@tearleads/test-utils";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildDocumentLinkRequest } from "../../../test/helpers/documentLinkMutation";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { addOrganizationMember } from "../../../test/helpers/organizationMembership";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("SDK decrypts a historical binding after ancestor head changes and document relinking", async () => {
  const owner = createTestUser();
  const firstReader = createTestUser();
  const secondReader = createTestUser();
  await registerUser(owner);
  await registerUser(firstReader);
  await registerUser(secondReader);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const organizationId = asVerifiedContainerManifest(root.bundle).state
    .organizationId;
  await addOrganizationMember({
    actor: owner,
    member: firstReader,
    organizationId,
  });
  await addOrganizationMember({
    actor: owner,
    member: secondReader,
    organizationId,
  });
  const { close, execSql } = await createTestExecSql(
    "attachment-cited-history",
  );
  const apiClient = new ApiClient("http://attachment-history.test");
  apiClient.setAuthToken(owner.token);
  const originalFetch = globalThis.fetch;
  const fetchHandler = (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const url = input instanceof Request ? input.url : String(input);
    return url.startsWith("http://attachment-history.test/")
      ? Promise.resolve(
          routeApp.request(
            input instanceof URL ? input.toString() : input,
            init,
          ),
        )
      : originalFetch(input, init);
  };
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(fetchHandler, { preconnect: originalFetch.preconnect }),
  );
  const identities = [owner, firstReader, secondReader].map((user) => ({
    userId: user.userId,
    resolve: createTestTrustedUserIdentityResolver({
      encapsulationPublicKey: user.kem.publicKey,
      signingKeyFingerprint: user.fingerprint,
      signingPublicKey: user.signing.signingPublicKey,
      userId: user.userId,
    }),
  }));
  const resolveProjectionUserKey = async (userId: string) =>
    identities
      .find((identity) => identity.userId === userId)
      ?.resolve(userId) ?? null;
  const warmReferencedPrincipalPolicies = async (input: {
    organizationId: string;
    references: Parameters<
      typeof cacheReferencedPrincipalPolicies
    >[0]["references"];
  }) =>
    cacheReferencedPrincipalPolicies({
      ...input,
      execSql,
      getCurrentPrincipalPolicy: apiClient.getCurrentPrincipalPolicy,
      reportSecurityIncident: async () => undefined,
      resolveTrustedUserIdentity: resolveProjectionUserKey,
    });
  const common = {
    apiClient,
    author: {
      organizationId,
      signerDeviceId: "attachment-history-test",
      signerKeyFingerprint: owner.fingerprint,
      signerPrivateKey: owner.signing.signingPrivateKey,
      signerUserId: owner.userId,
    },
    execSql,
    reportSecurityIncident: async () => undefined,
    resolveProjectionUserKey,
    resolveTrustedUserIdentity: resolveProjectionUserKey,
    targetSecretKey: owner.kem.secretKey,
    warmReferencedPrincipalPolicies,
  };
  try {
    const child = await createRemoteContainer({
      ...common,
      parentContainerId: root.kekState.containerId,
      parentSecretKey: owner.kem.secretKey,
    });
    const other = await createRemoteContainer({
      ...common,
      parentContainerId: root.kekState.containerId,
      parentSecretKey: owner.kem.secretKey,
    });
    if (!child || !other)
      throw new Error("Expected encrypted child containers");
    const document = await createRemoteDocument({
      ...common,
      containerId: child.containerId,
    });
    if (!document?.response) throw new Error("Expected encrypted document");
    const bindAncestor = await shareRemoteContainer({
      ...common,
      containerId: root.kekState.containerId,
      recipientUserId: firstReader.userId,
      accessLevel: "read",
    });
    if (!bindAncestor)
      throw new Error(
        `Expected bind-time ancestor rotation: ${JSON.stringify(apiClient.getRequestFailure({ method: "POST", path: `/containers/${root.kekState.containerId}/share` }))}`,
      );
    apiClient.clearWriterProjectionCaches();
    const plaintext = new Uint8Array([3, 1, 4, 1, 5, 9]);
    const uploaded = await uploadDocumentAttachment({
      ...common,
      bytes: plaintext,
      documentId: document.documentId,
      expectedBindingId: null,
      slotId: "preview",
    });
    if (!uploaded?.response.blobKekTargets)
      throw new Error("Expected encrypted attachment");
    const encrypted = await apiClient.getBlobBytes(uploaded.blobId);
    if (!encrypted) throw new Error("Expected stored encrypted blob bytes");
    const encryptedBytes = new Uint8Array(
      await new Response(encrypted.encryptedBytes).arrayBuffer(),
    );
    const currentAncestor = await shareRemoteContainer({
      ...common,
      containerId: root.kekState.containerId,
      recipientUserId: secondReader.userId,
      accessLevel: "read",
    });
    if (!currentAncestor) throw new Error("Expected current ancestor rotation");
    apiClient.clearWriterProjectionCaches();
    const relinked = await apiClient.linkDocument(
      document.documentId,
      await buildDocumentLinkRequest({
        authorizingContainerPath: [
          currentAncestor.response.accessManifest,
          child.response.accessManifest,
        ],
        child: other.response,
        createdDocument: document.response,
        owner,
        root: {
          bundle: currentAncestor.response.accessManifest,
          kekState: kekStateFromContainerResponse(currentAncestor.response),
          principalPolicies: root.principalPolicies,
        },
      }),
    );
    if (!relinked) throw new Error("Expected document relink");
    apiClient.clearWriterProjectionCaches();
    const projection = await apiClient.getDocumentWriterProjection(
      document.documentId,
    );
    if (!projection) throw new Error("Expected served document projection");
    expect(projection.documentManifest.manifestHash).not.toBe(
      uploaded.response.documentManifestHash,
    );
    // Neither document event cites the bind-time head. The served predecessor
    // walk and SDK historical-target index must still make it available.
    for (const bundle of [
      projection.documentManifest,
      ...projection.documentManifestHistory,
    ]) {
      expect(bundle.event.event.dependencyManifestHashes).not.toContain(
        bindAncestor.plan.manifestHash,
      );
    }
    expect(
      projection.documentContainerManifestHistory.map(
        (head) => head.manifestHash,
      ),
    ).toContain(bindAncestor.plan.manifestHash);
    expect(
      await decryptDocumentAttachmentBlob({
        binding: {
          ...uploaded.response,
          blobKekTargets: uploaded.response.blobKekTargets,
          slotId: "preview",
        },
        encryptedBytes,
        execSql,
        expectedDocumentId: document.documentId,
        expectedSlotId: "preview",
        resolveProjectionUserKey,
        targetSecretKey: owner.kem.secretKey,
        writerProjection: projection,
      }),
    ).toEqual(plaintext);
  } finally {
    fetchMock.mockRestore();
    close();
  }
}, 30_000);
