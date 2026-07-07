import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { CreateOrganizationRequest } from "@tearleads/validators/request";
import { respondToOrganizationProvisioning } from "../../../test/helpers/organizationProvisioningResponder";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import type { ExecSql, ExecSqlClientLike } from "../../data/sqlite/sqlSchema";
import { deriveContainerSystemSlot } from "../container-contents/systemSlot";
import { createOrganization } from "./createOrganization";
import { deriveOrganizationMetadataContainerSystemSlot } from "./rosterProfileContainer";

function createClient(execSql: ExecSql): ExecSqlClientLike {
  return {
    async exec({ bind, rowMode, sql }) {
      return {
        rows: await execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  };
}

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
      dbClient: createClient(execSql),
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
      { memberPrincipalType: "user", memberPrincipalId: userId, role: "admin" },
    ]);

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
      namespace: "tearleads.explorer",
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
      dbClient: createClient(execSql),
      encapsulationKeyPair,
      provisionedSystemContainers: [trashSpec],
      signingKeyPair,
      userId,
    });

    expect(response).not.toBeNull();
    const request = expectCapturedRequest(captured);

    // The Trash container rides along in the single provisioning request, tagged
    // with the per-user system slot the app derives client-side.
    const trashSlot = await deriveContainerSystemSlot({
      definition: trashSpec.slotDefinition,
      secretKey: signingKeyPair.signingPrivateKey,
    });
    expect(request.initialSystemContainers).toHaveLength(1);
    expect(request.initialSystemContainers?.[0]?.systemSlot).toBe(trashSlot);

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
    encapsulationKeyPair,
    signingKeyPair,
    userId: crypto.randomUUID(),
  });

  expect(response).toBeNull();
});
