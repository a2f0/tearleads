import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@symcrypt/crypto";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  type CreateOrganizationRequest,
  isCreateOrganizationRequest,
  isDocumentSyncRequest,
  isProvisionedDocumentRequest,
  isProvisionedSystemContainerRequest,
} from "@symcrypt/validators/request";
import { execSqlClientFromExecSql } from "../../../test/helpers/execSqlClient";
import { respondToOrganizationProvisioning } from "../../../test/helpers/organizationProvisioningResponder";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import {
  createExecSql,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";
import { listPendingWrites } from "../container-contents/pendingWrites";
import { deriveContainerSystemSlot } from "../container-contents/systemSlot";
import { createOrganization } from "./createOrganization";
import {
  deriveOrganizationMetadataContainerSystemSlot,
  getRosterProfileDocumentLocalId,
} from "./rosterProfileContainer";

function expectCapturedRequest(
  request: CreateOrganizationRequest | null,
): CreateOrganizationRequest {
  expect(request).not.toBeNull();
  if (!request) {
    throw new Error("Expected the create-organization request to be captured");
  }
  return request;
}

test("createOrganization provisions a new org for the existing user and persists it", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const userId = crypto.randomUUID();
  const { close, execSql } = await createTestExecSql(
    "organizations-create-organization-test",
  );
  const logs: string[] = [];
  let captured: CreateOrganizationRequest | null = null;

  try {
    const response = await createOrganization({
      apiClient: {
        createOrganization: async (request) => {
          captured = request;
          return respondToOrganizationProvisioning(request);
        },
      },
      dbClient: execSqlClientFromExecSql(execSql),
      encapsulationKeyPair,
      log: (message) => logs.push(message),
      signingKeyPair,
      userId,
    });

    expect(response).not.toBeNull();
    const request = expectCapturedRequest(captured);

    // The founding admin is the existing user, and no auth challenge is issued.
    expect(request.userId).toBe(userId);
    expect(response?.userId).toBe(userId);
    expect(Reflect.has(response ?? {}, "challenge")).toBe(false);

    // A fresh organization + root container are minted.
    expect(request.organizationId).not.toBe(userId);
    expect(request.rootContainerId).not.toBe(request.organizationId);
    expect(request.initialAdminGroup.name).toBe("Admins");
    expect(request.initialMemberGroup.name).toBe("Members");
    expect(request.initialOrganizationPolicy.projection).toEqual([
      { userId: userId, role: "admin" },
    ]);

    // The three core container-metadata bodies are committed atomically with
    // their document shells, so the successful response leaves no deferred
    // bootstrap writes for the sync engine to replay.
    expect(
      isProvisionedDocumentRequest(request.initialRootMetadataDocument),
    ).toBe(true);
    if (!isProvisionedDocumentRequest(request.initialRootMetadataDocument)) {
      throw new Error("Expected provisioned root metadata document request");
    }
    expect(
      request.initialRootMetadataDocument.initialSync.outgoingUpdates,
    ).toHaveLength(1);
    expect(
      request.initialRootMetadataDocument.initialSync
        .expectedLinkSetManifestHash,
    ).toBe(request.initialRootMetadataDocument.expectedManifestHash);
    const rootMetadataUpdateId =
      request.initialRootMetadataDocument.initialSync.outgoingUpdates[0]?.id;
    if (!rootMetadataUpdateId) {
      throw new Error("Expected initial root metadata update id");
    }
    const committedCoreMetadataUpdateIds = [rootMetadataUpdateId];

    const provisionedCoreContainers = [
      request.initialRosterProfileContainer,
      request.initialOrganizationMetadataContainer,
    ];
    for (const provisionedContainer of provisionedCoreContainers) {
      if (!isProvisionedSystemContainerRequest(provisionedContainer)) {
        throw new Error("Expected provisioned core metadata container");
      }
      const initialMetadataSync = provisionedContainer.initialMetadataSync;
      expect(isDocumentSyncRequest(initialMetadataSync)).toBe(true);
      expect(initialMetadataSync.outgoingUpdates).toHaveLength(1);
      expect(initialMetadataSync.expectedLinkSetManifestHash).toBe(
        provisionedContainer?.metadataDocument.expectedManifestHash,
      );
      const updateId = initialMetadataSync.outgoingUpdates[0]?.id;
      if (!updateId) {
        throw new Error("Expected initial container metadata update id");
      }
      committedCoreMetadataUpdateIds.push(updateId);
    }
    expect(response?.committedCoreMetadataUpdateIds).toEqual(
      committedCoreMetadataUpdateIds,
    );

    const provisionedProfiles = [
      request.initialRosterProfileDocument,
      request.initialOrganizationProfileDocument,
    ];
    expect(provisionedProfiles.every(Boolean)).toBe(true);
    for (const provisionedProfile of provisionedProfiles) {
      if (!isProvisionedDocumentRequest(provisionedProfile)) {
        throw new Error("Expected provisioned profile document request");
      }
      expect(isDocumentSyncRequest(provisionedProfile.initialSync)).toBe(true);
      expect(provisionedProfile.initialSync.outgoingUpdates).toHaveLength(1);
      expect(provisionedProfile.initialSync.expectedLinkSetManifestHash).toBe(
        provisionedProfile.expectedManifestHash,
      );
      expect(
        Reflect.get(
          provisionedProfile.initialSync.outgoingUpdates[0]?.writeHeader ?? {},
          "objectId",
        ),
      ).toBe(Reflect.get(provisionedProfile.event, "objectId"));
    }

    // Group policies persisted locally.
    const adminPolicy = await loadPrincipalPolicyBundle(
      execSql,
      "group",
      request.initialAdminGroup.groupId,
    );
    expect(adminPolicy?.currentProjection).toEqual(
      request.initialAdminGroup.initialGroupPolicy.projection,
    );

    // Root + roster + organization-metadata containers persisted, all stamped
    // with the new org id.
    const containers =
      await sqlContainerContentsPersistence.loadContainers(execSql);
    expect(containers).toHaveLength(3);
    const rootContainerState = containers.find(
      ({ container }) => container.id === request.rootContainerId,
    );
    expect(rootContainerState?.container).toEqual(
      expect.objectContaining({
        id: request.rootContainerId,
        organizationId: request.organizationId,
        parentId: null,
        name: "/",
      }),
    );

    // The Members-granted metadata container is persisted as a child of root and
    // is discoverable by the deterministic system slot the org-name reader keys
    // its cross-org fallback on.
    const metadataSystemSlot =
      await deriveOrganizationMetadataContainerSystemSlot({
        organizationId: request.organizationId,
      });
    const metadataContainerState = containers.find(
      ({ container }) => container.systemSlot === metadataSystemSlot,
    );
    expect(metadataContainerState?.container).toEqual(
      expect.objectContaining({
        organizationId: request.organizationId,
        parentId: request.rootContainerId,
      }),
    );
    for (const { container } of containers) {
      expect(
        await sqlContainerContentsPersistence.listPendingUpdates(
          execSql,
          container.id,
        ),
      ).toHaveLength(0);
    }
    expect(await listPendingWrites(execSql)).toEqual([]);

    // Organization profile document persisted under the org-scoped local id.
    const organizationProfileDocument =
      await sqlDocumentsPersistence.loadDocument(
        execSql,
        `org-profile:${request.organizationId}`,
      );
    expect(organizationProfileDocument).toEqual(
      expect.objectContaining({
        documentId: response?.organizationProfileDocumentId,
        documentKind: "organization_profile",
      }),
    );
    expect(
      await sqlDocumentsPersistence.listPendingUpdates(
        execSql,
        `org-profile:${request.organizationId}`,
      ),
    ).toHaveLength(0);
    expect(
      await sqlDocumentsPersistence.listPendingUpdates(
        execSql,
        getRosterProfileDocumentLocalId({
          organizationId: request.organizationId,
          userId,
        }),
      ),
    ).toHaveLength(0);

    expect(logs).toEqual([
      "Creating organization...",
      `Organization created (${request.organizationId})`,
      "Local organization bootstrap persisted",
    ]);
  } finally {
    close();
  }
});

test("createOrganization provisions configured system containers (Trash) atomically", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const userId = crypto.randomUUID();
  const { close, execSql } = await createTestExecSql(
    "organizations-create-organization-system-containers-test",
  );
  // The app declares the Explorer Trash bin; the SDK stays agnostic to what it
  // is and derives the per-user slot from the founder's signing key.
  const trashSpec = {
    icon: "trash",
    name: "Trash",
    slotDefinition: {
      namespace: "symcrypt.explorer",
      projectorId: "explorer",
      slotId: "trash",
      version: 1,
    },
  } as const;
  let captured: CreateOrganizationRequest | null = null;

  try {
    const response = await createOrganization({
      apiClient: {
        createOrganization: async (request) => {
          captured = request;
          return respondToOrganizationProvisioning(request);
        },
      },
      dbClient: execSqlClientFromExecSql(execSql),
      encapsulationKeyPair,
      provisionedSystemContainers: [trashSpec],
      signingKeyPair,
      userId,
    });

    expect(response).not.toBeNull();
    const request = expectCapturedRequest(captured);
    expect(isCreateOrganizationRequest(request)).toBe(true);

    // The Trash container rides along in the single provisioning request, tagged
    // with the per-user system slot the app derives client-side.
    const trashSlot = await deriveContainerSystemSlot({
      definition: trashSpec.slotDefinition,
      secretKey: signingKeyPair.signingPrivateKey,
    });
    expect(request.initialSystemContainers).toHaveLength(1);
    const provisionedTrash = request.initialSystemContainers?.[0];
    expect(provisionedTrash?.systemSlot).toBe(trashSlot);
    expect(isDocumentSyncRequest(provisionedTrash?.initialMetadataSync)).toBe(
      true,
    );
    expect(provisionedTrash?.initialMetadataSync.outgoingUpdates).toHaveLength(
      1,
    );
    expect(
      provisionedTrash?.initialMetadataSync.expectedLinkSetManifestHash,
    ).toBe(provisionedTrash?.metadataDocument.expectedManifestHash);
    expect(
      Reflect.get(
        provisionedTrash?.initialMetadataSync.outgoingUpdates[0]?.writeHeader ??
          {},
        "objectId",
      ),
    ).toBe(
      Reflect.get(provisionedTrash?.metadataDocument.event ?? {}, "objectId"),
    );

    // It is persisted locally as a fourth container: an Admins-scoped child of
    // root carrying the Trash name and its system slot, so the lazy
    // ensureSystemContainer bootstrap finds it instead of minting a duplicate.
    const containers =
      await sqlContainerContentsPersistence.loadContainers(execSql);
    expect(containers).toHaveLength(4);
    const trashContainerState = containers.find(
      ({ container }) => container.systemSlot === trashSlot,
    );
    expect(trashContainerState?.container).toEqual(
      expect.objectContaining({
        organizationId: request.organizationId,
        parentId: request.rootContainerId,
        name: "Trash",
      }),
    );
    for (const { container } of containers) {
      expect(
        await sqlContainerContentsPersistence.listPendingUpdates(
          execSql,
          container.id,
        ),
      ).toHaveLength(0);
    }
    expect(await listPendingWrites(execSql)).toEqual([]);
  } finally {
    close();
  }
});

test("createOrganization returns null when the server rejects the request", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();

  const response = await createOrganization({
    apiClient: {
      createOrganization: async () => null,
    },
    dbClient: {
      exec: async () => {
        throw new Error("Unexpected database access for a rejected request");
      },
    },
    encapsulationKeyPair,
    signingKeyPair,
    userId: crypto.randomUUID(),
  });

  expect(response).toBeNull();
});

test("createOrganization submits nothing once the identity is stale", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const { close, execSql } = await createTestExecSql(
    "organizations-create-organization-stale-identity-test",
  );
  let createCalls = 0;

  try {
    // The identity was replaced while the provisioning artifacts were being
    // built; the request signed with the old keys must never reach the API.
    const response = await createOrganization({
      apiClient: {
        createOrganization: async (request) => {
          createCalls += 1;
          return respondToOrganizationProvisioning(request);
        },
      },
      dbClient: execSqlClientFromExecSql(execSql),
      encapsulationKeyPair,
      isIdentityCurrent: () => false,
      signingKeyPair,
      userId: crypto.randomUUID(),
    });

    expect(response).toBeNull();
    expect(createCalls).toBe(0);
  } finally {
    close();
  }
});

test("createOrganization persists nothing when the identity goes stale in-flight", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const { close, execSql } = await createTestExecSql(
    "organizations-create-organization-inflight-stale-test",
  );
  let captured: CreateOrganizationRequest | null = null;
  let identityProbes = 0;
  let releaseHold = () => {};

  try {
    const client = execSqlClientFromExecSql(execSql);
    // Genuinely hold the mutation queue the bootstrap persist serializes on:
    // the pre-create and pre-persist checks (probes 1 and 2) pass while the
    // queue is busy, the identity is replaced while the persist waits, and
    // only the in-mutex currency check sees it stale.
    const workflowExecSql = createExecSql(client);
    const held = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    let holdEntered!: () => void;
    const holdStarted = new Promise<void>((resolve) => {
      holdEntered = resolve;
    });
    const holding = runSerializedSqlMutation(workflowExecSql, async () => {
      holdEntered();
      await held;
    });
    await holdStarted;

    let identityCurrent = true;
    let persistQueued!: () => void;
    const persistEntersQueue = new Promise<void>((resolve) => {
      persistQueued = resolve;
    });
    const creation = createOrganization({
      apiClient: {
        createOrganization: async (request) => {
          captured = request;
          return respondToOrganizationProvisioning(request);
        },
      },
      dbClient: client,
      encapsulationKeyPair,
      isIdentityCurrent: () => {
        identityProbes += 1;
        return identityCurrent;
      },
      onPersistQueued: persistQueued,
      signingKeyPair,
      userId: crypto.randomUUID(),
    });

    // The signal fires synchronously with the persist joining the mutation
    // queue, so past this await both pre-persist probes have passed and the
    // persist is deterministically waiting behind the held mutation — the
    // window the in-mutex guard exists for.
    await persistEntersQueue;
    expect(identityProbes).toBe(2);
    identityCurrent = false;
    releaseHold();
    await holding;
    const response = await creation;
    expect(identityProbes).toBe(3);

    // The remote organization exists, but no stale bootstrap row may reach
    // the local database the replacement identity now owns.
    expect(response).not.toBeNull();
    const request = expectCapturedRequest(captured);
    await expect(
      sqlContainerContentsPersistence.containerExists(
        execSql,
        request.rootContainerId,
      ),
    ).resolves.toBe(false);
    await expect(
      loadPrincipalPolicyBundle(
        execSql,
        "organization",
        request.organizationId,
      ),
    ).resolves.toBeNull();
  } finally {
    releaseHold();
    close();
  }
});
