import { expect, test } from "bun:test";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  CreateOrganizationGroupRequest,
  DocumentCreateRequest,
  RegistrationRequest,
} from "@tearleads/validators/request";
import type { RegistrationResponse } from "@tearleads/validators/response";
import { createTestExecSql } from "../../../test/helpers/createTestExecSql";
import { createResponseFromRequest } from "../../../test/helpers/documentFixtures";
import { sqlContactsPersistence } from "../../data/persistence/contacts/contactsPersistence";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
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
  initialRootMetadataDocument: DocumentCreateRequest;
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
  const userId = crypto.randomUUID();

  const policy = await buildInitialOrganizationPolicyRequest({
    encapsulationPublicKey: encapsulationKeyPair.publicKey,
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
  expect(policy.projection).toEqual([
    {
      memberPrincipalType: "user",
      memberPrincipalId: userId,
      role: "admin",
    },
  ]);
  expect(policy.memberEnvelopes).toHaveLength(1);
  expect(policy.memberEnvelopes[0]).toEqual(
    expect.objectContaining({
      memberPrincipalType: "user",
      memberPrincipalId: userId,
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
      initialRootMetadataDocument: DocumentCreateRequest,
    ): Promise<RegistrationResponse> => {
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
      };
      const rootMetadataDocument = await createResponseFromRequest(
        initialRootMetadataDocument,
      );

      return {
        userId,
        organizationId,
        rootContainerId,
        rootMetadataDocumentId: rootMetadataDocument.id,
        rootMetadataAccessEpoch: 1,
        rootMetadataAccessStateHash:
          rootMetadataDocument.accessManifest.manifestHash,
        rootMetadataDocument,
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
        memberPrincipalType: "user",
        memberPrincipalId: request.userId,
        role: "admin",
      },
    ]);

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
    expect(containers).toHaveLength(1);
    expect(containers[0]?.container).toEqual(
      expect.objectContaining({
        id: containerId,
        organizationId: request.organizationId,
        parentId: null,
        metadataDocumentId: response?.rootMetadataDocumentId,
        name: "/",
      }),
    );
    expect(containers[0]?.record).toEqual(
      expect.objectContaining({
        documentId: response?.rootMetadataDocumentId,
        accessEpoch: response?.rootMetadataAccessEpoch,
        accessStateHash: response?.rootMetadataAccessStateHash,
      }),
    );

    const contacts = await sqlContactsPersistence.loadContacts(
      execSql,
      "default",
    );
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.entry).toEqual({
      id: request.userId,
      firstName: "",
      lastName: "",
      userId: request.userId,
      encapsulationPublicKey: bytesToBase64(encapsulationKeyPair.publicKey),
      isSelf: true,
    });
    expect(logs).toEqual([
      "Registering identity...",
      `Key registered (${request.userId})`,
      "Local identity and root container persisted",
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
      _initialAdminGroup: CreateOrganizationGroupRequest,
      _initialMemberGroup: CreateOrganizationGroupRequest,
      _initialOrganizationPolicy: RegistrationRequest["initialOrganizationPolicy"],
      _initialRootContainer: RegistrationRequest["initialRootContainer"],
      initialRootMetadataDocument: DocumentCreateRequest,
    ): Promise<RegistrationResponse> => {
      registrationSubmitted = true;
      const rootMetadataDocument = await createResponseFromRequest(
        initialRootMetadataDocument,
      );

      return {
        userId,
        organizationId,
        rootContainerId,
        rootMetadataDocumentId: rootMetadataDocument.id,
        rootMetadataAccessEpoch: 1,
        rootMetadataAccessStateHash:
          rootMetadataDocument.accessManifest.manifestHash,
        rootMetadataDocument,
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
