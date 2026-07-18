import { expect, test } from "bun:test";
import { createContainerContentsStore as createExplorerStore } from "@tearleads/client-sdk";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createContainerParentLaneBatchMock,
  createMockApiClient,
} from "@tearleads/test-utils";
import {
  createExplorerMetadataContainerProjection,
  listContainersResponse,
  listedContainer,
  loadContainers,
} from "../../../test/helpers/explorer-provider/explorerProviderFixtures";
import {
  createExplorerContainerApiHarness,
  createSqlRuntime,
  runtimeWithPatch,
} from "../../../test/helpers/explorer-provider/explorerProviderHarness";
import { waitForCondition } from "../../../test/helpers/waitForCondition";

test("explorer store creates a child under a writable shared root through the parent KEK", async () => {
  let runtime = await createSqlRuntime();
  const requestedPrincipalPolicies: string[] = [];
  const localKeyPair = generateKemSeedAndKeyPair();
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const harness = createExplorerContainerApiHarness([
    await createExplorerMetadataContainerProjection({
      containerId: "shared-root-container",
      encapsulationPublicKey: localKeyPair.publicKey,
      organizationId: "org-2",
      signerKeyFingerprint: signingFingerprint,
      signerPrivateKey: signingKeyPair.signingPrivateKey,
      userId: "user-1",
    }),
  ]);

  runtime = runtimeWithPatch(runtime, {
    apiClient: createMockApiClient({
      ...runtime.apiClient,
      ...harness.apiClient,
      getUserIdentity: async (requestedUserId: string) => ({
        encapsulationKeyFingerprint: await toFingerprint(
          localKeyPair.publicKey,
        ),
        encapsulationPublicKey: bytesToBase64(localKeyPair.publicKey),
        signingKeyFingerprint: signingFingerprint,
        signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
        userId: requestedUserId,
      }),
      getCurrentPrincipalPolicy: async (principalType, principalId) => {
        requestedPrincipalPolicies.push(`${principalType}:${principalId}`);
        return null;
      },
      listContainerParentLanes: createContainerParentLaneBatchMock(async () =>
        listContainersResponse([
          listedContainer({
            id: "shared-root-container",
            metadataAccessEpoch: 1,
            metadataAccessStateHash: "shared-root-access-state-hash-1",
            metadataDocumentId: "shared-root-metadata-document",
            metadataReferencedPrincipals: [
              {
                keyEpoch: 1,
                keyFingerprint: "key-fingerprint-1",
                principalId: "group-1",
                principalType: "group",
                stateHash: "state-hash-1",
                version: 1,
              },
            ],
            organizationId: "org-2",
            parentId: null,
          }),
        ]),
      ),
    }),
    encapsulationKeyPair: localKeyPair,
    isAuthenticated: true,
    online: true,
    organizationId: "org-2",
    signingFingerprint,
    signingKeyPair,
    userId: "user-1",
  });

  try {
    const store = createExplorerStore(runtime);
    store.updateRuntime(runtime);

    await waitForCondition(
      () =>
        store
          .getSnapshot()
          .nodes.some((node) => node.id === "shared-root-container"),
      "Explorer store did not hydrate the shared root container.",
    );

    const childNode = await store.createChild("shared-root-container", "Docs");
    if (!childNode) {
      throw new Error("Expected createChild to return a new container node.");
    }

    await waitForCondition(
      () => harness.containerCreateCalls.length === 1,
      "Explorer store did not sync the shared-root child create.",
    );

    expect(harness.containerCreateCalls).toEqual([
      {
        containerId: childNode.id,
        metadataDocumentId: childNode.id,
        parentId: "shared-root-container",
        wrapRecipientKinds: ["container"],
      },
    ]);
    expect(harness.documentCreateCalls).toEqual([
      {
        containerId: childNode.id,
        documentId: childNode.id,
      },
    ]);
    expect(requestedPrincipalPolicies).toContain("group:group-1");
  } finally {
    runtime.close();
  }
});

test("explorer store moves authenticated child containers locally before background sync", async () => {
  let runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const rootProjection = await createExplorerMetadataContainerProjection({
    containerId: "root-container",
    encapsulationPublicKey: localKeyPair.publicKey,
    organizationId: "org-1",
    signerKeyFingerprint: signingFingerprint,
    signerPrivateKey: signingKeyPair.signingPrivateKey,
    userId: "user-1",
  });
  const parentAProjection = await createExplorerMetadataContainerProjection({
    containerId: "parent-a",
    encapsulationPublicKey: localKeyPair.publicKey,
    organizationId: "org-1",
    parentProjection: rootProjection,
    signerKeyFingerprint: signingFingerprint,
    signerPrivateKey: signingKeyPair.signingPrivateKey,
    userId: "user-1",
  });
  const parentBProjection = await createExplorerMetadataContainerProjection({
    containerId: "parent-b",
    encapsulationPublicKey: localKeyPair.publicKey,
    organizationId: "org-1",
    parentProjection: rootProjection,
    signerKeyFingerprint: signingFingerprint,
    signerPrivateKey: signingKeyPair.signingPrivateKey,
    userId: "user-1",
  });
  const childProjection = await createExplorerMetadataContainerProjection({
    containerId: "child-container",
    encapsulationPublicKey: localKeyPair.publicKey,
    organizationId: "org-1",
    parentProjection: parentAProjection,
    signerKeyFingerprint: signingFingerprint,
    signerPrivateKey: signingKeyPair.signingPrivateKey,
    userId: "user-1",
  });
  const harness = createExplorerContainerApiHarness([
    rootProjection,
    parentAProjection,
    parentBProjection,
    childProjection,
  ]);
  let remoteContainers = [
    listedContainer({
      id: "root-container",
      metadataAccessEpoch: 1,
      metadataAccessStateHash: "root-access-state-hash-1",
      metadataDocumentId: "root-metadata-document",
      organizationId: "org-1",
      parentId: null,
    }),
    listedContainer({
      id: "parent-a",
      metadataAccessEpoch: 1,
      metadataAccessStateHash: "parent-a-access-state-hash-1",
      metadataDocumentId: "parent-a-metadata-document",
      organizationId: "org-1",
      parentId: "root-container",
    }),
    listedContainer({
      id: "parent-b",
      metadataAccessEpoch: 1,
      metadataAccessStateHash: "parent-b-access-state-hash-1",
      metadataDocumentId: "parent-b-metadata-document",
      organizationId: "org-1",
      parentId: "root-container",
    }),
    listedContainer({
      id: "child-container",
      metadataAccessEpoch: 1,
      metadataAccessStateHash: "child-access-state-hash-1",
      metadataDocumentId: "child-metadata-document",
      organizationId: "org-1",
      parentId: "parent-a",
    }),
  ];

  runtime = runtimeWithPatch(runtime, {
    apiClient: createMockApiClient({
      ...runtime.apiClient,
      ...harness.apiClient,
      listContainerParentLanes: createContainerParentLaneBatchMock(async () =>
        listContainersResponse(remoteContainers),
      ),
      moveContainer: async (containerId, request) => {
        const response = await harness.apiClient.moveContainer(
          containerId,
          request,
        );
        if (response) {
          remoteContainers = remoteContainers.map((container) =>
            container.id === containerId
              ? {
                  ...container,
                  metadataAccessEpoch: response.manifestHead.epoch,
                  metadataAccessStateHash: response.manifestHead.manifestHash,
                  metadataDocumentId: String(
                    Reflect.get(
                      response.accessManifest.state,
                      "metadataDocumentId",
                    ),
                  ),
                  parentId: response.parentId,
                }
              : container,
          );
        }
        return response;
      },
    }),
    encapsulationKeyPair: localKeyPair,
    isAuthenticated: true,
    online: true,
    organizationId: "org-1",
    signingFingerprint,
    signingKeyPair,
    userId: "user-1",
  });

  try {
    const store = createExplorerStore(runtime);
    store.updateRuntime(runtime);

    await waitForCondition(
      () =>
        store.getSnapshot().nodes.some((node) => node.id === "child-container"),
      "Explorer store did not hydrate remote containers before move.",
    );

    const movedNode = await store.moveContainer("child-container", "parent-b");
    if (!movedNode) {
      throw new Error("Expected moveContainer to return the moved node.");
    }

    await waitForCondition(
      () =>
        harness.containerMoveCalls.length === 1 &&
        store
          .getSnapshot()
          .nodes.some(
            (node) =>
              node.id === "child-container" && node.parentId === "parent-b",
          ),
      "Explorer store did not sync the moved container parent.",
    );

    expect(harness.containerMoveCalls).toEqual([
      {
        containerId: "child-container",
        parentId: "parent-b",
        wrapRecipientKinds: ["container"],
      },
    ]);
    expect(movedNode.parentId).toBe("parent-b");

    const persistedContainers = await loadContainers(runtime.infra.execSql);
    expect(
      persistedContainers.find(
        (container) => container.id === "child-container",
      )?.parentId,
    ).toBe("parent-b");
  } finally {
    runtime.close();
  }
});
