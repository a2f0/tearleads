import { expect, test } from "bun:test";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  CreateOrganizationGroupRequest,
  ProvisionedDocumentRequest,
  ProvisionedSystemContainerRequest,
  RegistrationRequest,
} from "@tearleads/validators/request";
import type { RegistrationResponse } from "@tearleads/validators/response";
import { createMutationResponseFromRequest } from "../../../test/helpers/containerFixtures";
import { createResponseFromRequest } from "../../../test/helpers/documentFixtures";
import { respondToOrganizationProvisioning } from "../../../test/helpers/organizationProvisioningResponder";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import { parseOrganizationAuthorityDescriptor } from "../../data/principals/organizationAuthorityDescriptor";
import type { ExecSql, ExecSqlClientLike } from "../../data/sqlite/sqlSchema";
import {
  buildInitialOrganizationPolicyRequest,
  registerIdentity,
} from "./registerIdentity";

interface CapturedRegistrationRequest {
  userId: string;
  organizationId: string;
  rootContainerId: string;
  signingPublicKey: Uint8Array;
  encapsulationPublicKey: Uint8Array;
  initialAdminGroup: CreateOrganizationGroupRequest;
  initialMemberGroup: CreateOrganizationGroupRequest;
  initialOrganizationPolicy: RegistrationRequest["initialOrganizationPolicy"];
  initialRootContainer: RegistrationRequest["initialRootContainer"];
  initialRootMetadataDocument: ProvisionedDocumentRequest;
  initialRosterProfileContainer: ProvisionedSystemContainerRequest;
  initialRosterProfileDocument: ProvisionedDocumentRequest;
  initialOrganizationMetadataContainer: ProvisionedSystemContainerRequest;
  initialOrganizationProfileDocument: ProvisionedDocumentRequest;
}

function createClient(execSql: ExecSql): ExecSqlClientLike {
  return {
    async exec({ bind, rowMode, sql }) {
      return {
        rows: await execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  };
}

function expectCapturedRegistration(
  captured: CapturedRegistrationRequest | null,
): CapturedRegistrationRequest {
  expect(captured).not.toBeNull();
  if (!captured) {
    throw new Error("Expected registration request to be captured");
  }

  return captured;
}

test("buildInitialOrganizationPolicyRequest creates the initial admin organization policy", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const organizationId = crypto.randomUUID();
  const adminGroupId = crypto.randomUUID();
  const memberGroupId = crypto.randomUUID();
  const userId = crypto.randomUUID();

  const policy = await buildInitialOrganizationPolicyRequest({
    adminGroupId,
    encapsulationPublicKey: encapsulationKeyPair.publicKey,
    memberGroupId,
    organizationId,
    signingKeyPair,
    userId,
  });

  expect(policy.state.principalType).toBe("organization");
  expect(policy.state.principalId).toBe(organizationId);
  expect(policy.state.version).toBe(1);
  expect(policy.state.prevStateHash).toBeNull();
  expect(policy.state.keyEpoch).toBe(1);
  expect(policy.state.signerUserId).toBe(userId);
  expect(policy.state.signerUserKeyFingerprint).toBe(
    await toFingerprint(signingKeyPair.signingPublicKey),
  );
  expect(policy.encryptedPayload.cipherSuite).toBe("aes-256-gcm");
  expect(
    parseOrganizationAuthorityDescriptor(policy.encryptedPayload.ciphertext),
  ).toEqual({ version: 1, organizationId, adminGroupId, memberGroupId });
  expect(policy.projection).toEqual([
    {
      userId: userId,
      role: "admin",
    },
  ]);
  expect(policy.memberEnvelopes).toHaveLength(1);
  expect(policy.memberEnvelopes[0]).toEqual(
    expect.objectContaining({
      userId: userId,
      memberKeyFingerprint: await toFingerprint(encapsulationKeyPair.publicKey),
    }),
  );
});

test("registerIdentity submits the registration request and persists the local bootstrap", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const containerId = crypto.randomUUID();
  const { close, execSql } = await createTestExecSql(
    "registration-register-identity-test",
  );
  const logs: string[] = [];
  const errors: unknown[] = [];
  let captured: CapturedRegistrationRequest | null = null;
  const apiClient = {
    registerUser: async (
      userId: string,
      organizationId: string,
      rootContainerId: string,
      signingPublicKey: Uint8Array,
      encapsulationPublicKey: Uint8Array,
      initialAdminGroup: CreateOrganizationGroupRequest,
      initialMemberGroup: CreateOrganizationGroupRequest,
      initialOrganizationPolicy: RegistrationRequest["initialOrganizationPolicy"],
      initialRootContainer: RegistrationRequest["initialRootContainer"],
      initialRootMetadataDocument: ProvisionedDocumentRequest,
      initialRosterProfileContainer?:
        | ProvisionedSystemContainerRequest
        | undefined,
      initialRosterProfileDocument?: ProvisionedDocumentRequest | undefined,
      initialOrganizationMetadataContainer?:
        | ProvisionedSystemContainerRequest
        | undefined,
      initialOrganizationProfileDocument?:
        | ProvisionedDocumentRequest
        | undefined,
    ): Promise<RegistrationResponse> => {
      if (!initialRosterProfileContainer) {
        throw new Error("Expected initial roster profile container request");
      }
      if (!initialRosterProfileDocument) {
        throw new Error("Expected initial roster profile document request");
      }
      if (!initialOrganizationMetadataContainer) {
        throw new Error(
          "Expected initial organization metadata container request",
        );
      }
      if (!initialOrganizationProfileDocument) {
        throw new Error(
          "Expected initial organization profile document request",
        );
      }
      captured = {
        userId,
        organizationId,
        rootContainerId,
        signingPublicKey,
        encapsulationPublicKey,
        initialAdminGroup,
        initialMemberGroup,
        initialOrganizationPolicy,
        initialRootContainer,
        initialRootMetadataDocument,
        initialRosterProfileContainer,
        initialRosterProfileDocument,
        initialOrganizationMetadataContainer,
        initialOrganizationProfileDocument,
      };
      const rootMetadataDocument = await createResponseFromRequest(
        initialRootMetadataDocument,
      );
      const rosterProfileMetadataDocument = await createResponseFromRequest(
        initialRosterProfileContainer.metadataDocument,
      );
      const rosterProfileContainerResponse =
        await createMutationResponseFromRequest(
          initialRosterProfileContainer.container,
        );
      rosterProfileContainerResponse.systemSlot =
        initialRosterProfileContainer.systemSlot ?? null;
      const rosterProfileDocument = await createResponseFromRequest(
        initialRosterProfileDocument,
      );
      const organizationMetadataMetadataDocument =
        await createResponseFromRequest(
          initialOrganizationMetadataContainer.metadataDocument,
        );
      const organizationMetadataContainerResponse =
        await createMutationResponseFromRequest(
          initialOrganizationMetadataContainer.container,
        );
      organizationMetadataContainerResponse.systemSlot =
        initialOrganizationMetadataContainer.systemSlot ?? null;
      const organizationProfileDocument = await createResponseFromRequest(
        initialOrganizationProfileDocument,
      );

      return {
        userId,
        organizationId,
        rootContainerId,
        rootMetadataDocumentId: rootMetadataDocument.id,
        rootMetadataAccessEpoch: 1,
        rootMetadataAccessStateHash: initialRootContainer.expectedManifestHash,
        rootMetadataDocument,
        rosterProfileContainer: {
          container: rosterProfileContainerResponse,
          metadataDocument: rosterProfileMetadataDocument,
        },
        rosterProfileContainerId: rosterProfileContainerResponse.containerId,
        rosterProfileDocument,
        rosterProfileDocumentId: rosterProfileDocument.id,
        organizationMetadataContainer: {
          container: organizationMetadataContainerResponse,
          metadataDocument: organizationMetadataMetadataDocument,
        },
        organizationMetadataContainerId:
          organizationMetadataContainerResponse.containerId,
        organizationProfileDocument,
        organizationProfileDocumentId: organizationProfileDocument.id,
        committedCoreMetadataUpdateIds: [
          initialRootMetadataDocument.initialSync,
          initialRosterProfileContainer.initialMetadataSync,
          initialOrganizationMetadataContainer.initialMetadataSync,
        ].flatMap((sync) => sync.outgoingUpdates.map((update) => update.id)),
        committedProfileUpdateIds: [
          initialRosterProfileDocument,
          initialOrganizationProfileDocument,
        ].flatMap((document) =>
          document.initialSync.outgoingUpdates.map((update) => update.id),
        ),
        systemContainers: [],
        challenge: "a".repeat(64),
      };
    },
  };

  try {
    const response = await registerIdentity({
      apiClient,
      containerId,
      dbClient: createClient(execSql),
      encapsulationKeyPair,
      log: (message) => logs.push(message),
      logError: (message, cause) => errors.push({ message, cause }),
      pinLocalUserIdentity: async () => undefined,
      signingKeyPair,
    });
    const request = expectCapturedRegistration(captured);

    expect(response).not.toBeNull();
    expect(response?.rootContainerId).toBe(containerId);
    expect(response?.challenge).toBe("a".repeat(64));
    expect(request.rootContainerId).toBe(containerId);
    expect(request.signingPublicKey).toBe(signingKeyPair.signingPublicKey);
    expect(request.encapsulationPublicKey).toBe(encapsulationKeyPair.publicKey);
    expect(request.initialAdminGroup.name).toBe("Admins");
    expect(request.initialMemberGroup.name).toBe("Members");
    expect(request.initialOrganizationPolicy.state.principalType).toBe(
      "organization",
    );
    expect(request.initialOrganizationPolicy.state.principalId).toBe(
      request.organizationId,
    );
    expect(request.initialOrganizationPolicy.projection).toEqual([
      {
        userId: request.userId,
        role: "admin",
      },
    ]);
    expect(
      Reflect.get(request.initialRosterProfileDocument.event, "objectId"),
    ).not.toBe(
      Reflect.get(request.initialRootMetadataDocument.event, "objectId"),
    );
    expect(request.initialRosterProfileContainer.systemSlot).toMatch(
      /^sys_v1_[A-Za-z0-9_-]{43}$/,
    );
    expect(
      Reflect.get(
        request.initialRosterProfileDocument.body as Record<string, unknown>,
        "containerId",
      ),
    ).toBe(
      Reflect.get(
        request.initialRosterProfileContainer.container.event,
        "objectId",
      ),
    );
    expect(
      Reflect.get(
        request.initialOrganizationProfileDocument.body as Record<
          string,
          unknown
        >,
        "containerId",
      ),
    ).toBe(
      Reflect.get(
        request.initialOrganizationMetadataContainer.container.event,
        "objectId",
      ),
    );
    expect(request.initialOrganizationMetadataContainer.systemSlot).toMatch(
      /^sys_v1_[A-Za-z0-9_-]{43}$/,
    );
    // The org metadata container is distinct from the roster profile container,
    // so the founder's private roster PII is not co-located with the org name.
    expect(request.initialOrganizationMetadataContainer.systemSlot).not.toBe(
      request.initialRosterProfileContainer.systemSlot,
    );
    expect(
      Reflect.get(request.initialOrganizationProfileDocument.event, "objectId"),
    ).not.toBe(
      Reflect.get(request.initialRosterProfileDocument.event, "objectId"),
    );
    const adminPolicy = await loadPrincipalPolicyBundle(
      execSql,
      "group",
      request.initialAdminGroup.groupId,
    );
    const memberPolicy = await loadPrincipalPolicyBundle(
      execSql,
      "group",
      request.initialMemberGroup.groupId,
    );
    expect(adminPolicy?.currentState.stateHash).toBe(
      await computePrincipalStateHash(
        request.initialAdminGroup.initialGroupPolicy.state,
      ),
    );
    expect(adminPolicy?.currentProjection).toEqual(
      request.initialAdminGroup.initialGroupPolicy.projection,
    );
    expect(memberPolicy?.currentState.stateHash).toBe(
      await computePrincipalStateHash(
        request.initialMemberGroup.initialGroupPolicy.state,
      ),
    );
    expect(memberPolicy?.currentProjection).toEqual(
      request.initialMemberGroup.initialGroupPolicy.projection,
    );

    const containers =
      await sqlContainerContentsPersistence.loadContainers(execSql);
    expect(containers).toHaveLength(3);
    const rootContainerState = containers.find(
      ({ container }) => container.id === containerId,
    );
    const rosterProfileContainerState = containers.find(
      ({ container }) => container.name === "Roster Profiles",
    );
    const organizationMetadataContainerState = containers.find(
      ({ container }) => container.name === "Organization Metadata",
    );
    expect(rootContainerState?.container).toEqual(
      expect.objectContaining({
        id: containerId,
        organizationId: request.organizationId,
        parentId: null,
        metadataDocumentId: response?.rootMetadataDocumentId,
        name: "/",
      }),
    );
    expect(rootContainerState?.record).toEqual(
      expect.objectContaining({
        documentId: response?.rootMetadataDocumentId,
        accessEpoch: response?.rootMetadataAccessEpoch,
        accessStateHash: response?.rootMetadataAccessStateHash,
      }),
    );
    expect(rosterProfileContainerState?.container).toEqual(
      expect.objectContaining({
        metadataDocumentId:
          response?.rosterProfileContainer?.metadataDocument.id,
        name: "Roster Profiles",
        organizationId: request.organizationId,
        parentId: containerId,
        systemSlot: request.initialRosterProfileContainer.systemSlot,
      }),
    );
    expect(organizationMetadataContainerState?.container).toEqual(
      expect.objectContaining({
        metadataDocumentId:
          response?.organizationMetadataContainer?.metadataDocument.id,
        name: "Organization Metadata",
        organizationId: request.organizationId,
        parentId: containerId,
        systemSlot: request.initialOrganizationMetadataContainer.systemSlot,
      }),
    );
    expect(logs).toEqual([
      "Registering identity...",
      `Key registered (${request.userId})`,
      "Local organization bootstrap persisted",
    ]);
    expect(errors).toEqual([]);
  } finally {
    close();
  }
});

test("registerIdentity propagates local bootstrap persistence failures", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const containerId = crypto.randomUUID();
  const persistenceError = new Error("local db unavailable");
  const errors: Array<{ message: string | Error; cause: unknown }> = [];
  let registrationSubmitted = false;
  const apiClient = {
    registerUser: async (
      userId: string,
      organizationId: string,
      rootContainerId: string,
      _signingPublicKey: Uint8Array,
      _encapsulationPublicKey: Uint8Array,
      initialAdminGroup: CreateOrganizationGroupRequest,
      initialMemberGroup: CreateOrganizationGroupRequest,
      initialOrganizationPolicy: RegistrationRequest["initialOrganizationPolicy"],
      initialRootContainer: RegistrationRequest["initialRootContainer"],
      initialRootMetadataDocument: ProvisionedDocumentRequest,
      initialRosterProfileContainer?:
        | ProvisionedSystemContainerRequest
        | undefined,
      initialRosterProfileDocument?: ProvisionedDocumentRequest | undefined,
      initialOrganizationMetadataContainer?:
        | ProvisionedSystemContainerRequest
        | undefined,
      initialOrganizationProfileDocument?:
        | ProvisionedDocumentRequest
        | undefined,
    ): Promise<RegistrationResponse> => {
      registrationSubmitted = true;
      const response = await respondToOrganizationProvisioning({
        initialAdminGroup,
        initialMemberGroup,
        initialOrganizationMetadataContainer,
        initialOrganizationPolicy,
        initialOrganizationProfileDocument,
        initialRootContainer,
        initialRootMetadataDocument,
        initialRosterProfileContainer,
        initialRosterProfileDocument,
        organizationId,
        rootContainerId,
        userId,
      });
      return {
        ...response,
        challenge: "a".repeat(64),
      };
    },
  };

  await expect(
    registerIdentity({
      apiClient,
      containerId,
      dbClient: {
        async exec() {
          throw persistenceError;
        },
      },
      encapsulationKeyPair,
      logError: (message, cause) => errors.push({ message, cause }),
      pinLocalUserIdentity: async () => undefined,
      signingKeyPair,
    }),
  ).rejects.toThrow("local db unavailable");

  expect(registrationSubmitted).toBe(true);
  expect(errors).toEqual([
    {
      message: "Failed to persist registration data",
      cause: persistenceError,
    },
  ]);
});
