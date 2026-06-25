import { expect, test } from "bun:test";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { createDocument, importUpdates } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  ContainerCreateWithMetadataDocumentRequest,
  CreateOrganizationGroupRequest,
  DocumentCreateRequest,
  RegistrationRequest,
} from "@tearleads/validators/request";
import type { RegistrationResponse } from "@tearleads/validators/response";
import { createMutationResponseFromRequest } from "../../../test/helpers/containerFixtures";
import { createResponseFromRequest } from "../../../test/helpers/documentFixtures";
import { readStoredDocumentState } from "../../data/documents/documentKinds";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import type { ExecSql, ExecSqlClientLike } from "../../data/sqlite/sqlSchema";
import { getRosterProfileDocumentLocalId } from "../organizations/rosterProfileContainer";
import {
  buildInitialOrganizationPolicyRequest,
  registerIdentity,
} from "./registerIdentity";

const account = {
  disabledAt: null,
  purgeAfter: null,
  purgeStartedAt: null,
  purgedAt: null,
  remoteDataEpoch: 1,
  status: "trialing" as const,
  trialEndsAt: "2026-06-08T00:00:00.000Z",
};

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
  initialRosterProfileContainer: ContainerCreateWithMetadataDocumentRequest;
  initialRosterProfileDocument: DocumentCreateRequest;
  initialOrganizationProfileDocument: DocumentCreateRequest;
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
      initialRosterProfileContainer?:
        | ContainerCreateWithMetadataDocumentRequest
        | undefined,
      initialRosterProfileDocument?: DocumentCreateRequest | undefined,
      initialOrganizationProfileDocument?: DocumentCreateRequest | undefined,
    ): Promise<RegistrationResponse> => {
      if (!initialRosterProfileContainer) {
        throw new Error("Expected initial roster profile container request");
      }
      if (!initialRosterProfileDocument) {
        throw new Error("Expected initial roster profile document request");
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
      const organizationProfileDocument = await createResponseFromRequest(
        initialOrganizationProfileDocument,
      );

      return {
        account,
        userId,
        organizationId,
        rootContainerId,
        rootMetadataDocumentId: rootMetadataDocument.id,
        rootMetadataAccessEpoch: 1,
        rootMetadataAccessStateHash:
          rootMetadataDocument.accessManifest.manifestHash,
        rootMetadataDocument,
        rosterProfileContainer: {
          container: rosterProfileContainerResponse,
          metadataDocument: rosterProfileMetadataDocument,
        },
        rosterProfileContainerId: rosterProfileContainerResponse.containerId,
        rosterProfileDocument,
        rosterProfileDocumentId: rosterProfileDocument.id,
        organizationProfileDocument,
        organizationProfileDocumentId: organizationProfileDocument.id,
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
        request.initialRosterProfileContainer.container.event,
        "objectId",
      ),
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
    expect(containers).toHaveLength(2);
    const rootContainerState = containers.find(
      ({ container }) => container.id === containerId,
    );
    const rosterProfileContainerState = containers.find(
      ({ container }) => container.id !== containerId,
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
    const organizationProfileDocument =
      await sqlDocumentsPersistence.loadDocument(
        execSql,
        `org-profile:${request.organizationId}`,
      );
    expect(organizationProfileDocument).toEqual(
      expect.objectContaining({
        containerId: rosterProfileContainerState?.container.id,
        documentId: response?.organizationProfileDocumentId,
        documentKind: "organization_profile",
      }),
    );
    expect(organizationProfileDocument?.loroSnapshot.length).toBeGreaterThan(0);
    expect(
      await sqlDocumentsPersistence.listPendingUpdates(
        execSql,
        `org-profile:${request.organizationId}`,
      ),
    ).toHaveLength(1);
    const rosterProfileLocalId = getRosterProfileDocumentLocalId({
      organizationId: request.organizationId,
      userId: request.userId,
    });
    const rosterProfileDocument = await sqlDocumentsPersistence.loadDocument(
      execSql,
      rosterProfileLocalId,
    );
    expect(rosterProfileDocument).toEqual(
      expect.objectContaining({
        containerId: rosterProfileContainerState?.container.id,
        documentId: response?.rosterProfileDocumentId,
        documentKind: "contact",
      }),
    );
    if (!rosterProfileDocument) {
      throw new Error("Expected persisted roster profile document.");
    }
    expect(rosterProfileDocument?.loroSnapshot.length).toBeGreaterThan(0);
    const rosterProfileDoc = await createDocument(
      "registration-roster-profile-test",
    );
    importUpdates(rosterProfileDoc, [
      base64ToBytes(rosterProfileDocument.loroSnapshot),
    ]);
    expect(readStoredDocumentState(rosterProfileDoc)).toMatchObject({
      structuredFields: {
        nickname: "You",
      },
    });
    expect(
      await sqlDocumentsPersistence.listPendingUpdates(
        execSql,
        rosterProfileLocalId,
      ),
    ).toHaveLength(1);

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
      _initialRosterProfileContainer?:
        | ContainerCreateWithMetadataDocumentRequest
        | undefined,
      _initialRosterProfileDocument?: DocumentCreateRequest | undefined,
      _initialOrganizationProfileDocument?: DocumentCreateRequest | undefined,
    ): Promise<RegistrationResponse> => {
      registrationSubmitted = true;
      const rootMetadataDocument = await createResponseFromRequest(
        initialRootMetadataDocument,
      );

      return {
        account,
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
