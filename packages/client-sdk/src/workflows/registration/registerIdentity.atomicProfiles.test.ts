import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  importSnapshot,
  importUpdates,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  isDocumentSyncRequest,
  isProvisionedDocumentRequest,
  type ProvisionedDocumentRequest,
  type RegistrationRequest,
} from "@tearleads/validators/request";
import { respondToOrganizationProvisioning } from "../../../test/helpers/organizationProvisioningResponder";
import { readStoredDocumentState } from "../../data/documents/documentKinds";
import { decryptDocumentSyncUpdates } from "../../data/documents/shared/crypto";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql, ExecSqlClientLike } from "../../data/sqlite/sqlSchema";
import { getRosterProfileDocumentLocalId } from "../organizations/rosterProfileContainer";
import {
  buildOrganizationProvisioningArtifacts,
  type RegistrationApi,
  registerIdentity,
} from "./registerIdentity";

function createClient(execSql: ExecSql): ExecSqlClientLike {
  return {
    async exec({ bind, rowMode, sql }) {
      return {
        rows: await execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  };
}

function requireCapturedRequest(
  request: RegistrationRequest | null,
): RegistrationRequest {
  expect(request).not.toBeNull();
  if (!request) {
    throw new Error("Expected registration request");
  }
  return request;
}

async function expectSettledProfile(input: {
  documentId: string;
  documentKind: string;
  expectedFields: Record<string, unknown>;
  execSql: ExecSql;
  localId: string;
  request: ProvisionedDocumentRequest;
}) {
  const stored = await sqlDocumentsPersistence.loadDocument(
    input.execSql,
    input.localId,
  );
  expect(stored).toEqual(
    expect.objectContaining({
      documentId: input.documentId,
      documentKind: input.documentKind,
    }),
  );
  if (!stored) {
    throw new Error(`Expected persisted profile ${input.localId}`);
  }

  const document = await createDocument(`settled-${input.localId}`);
  importSnapshot(document, base64ToBytes(stored.loroSnapshot));
  const expectedVersionVector = input.request.initialSync.localVersionVector;
  if (expectedVersionVector === null) {
    throw new Error("Expected profile version vector");
  }
  expect(encodeVersionVector(document)).toBe(expectedVersionVector);
  expect(readStoredDocumentState(document).structuredFields).toEqual(
    expect.objectContaining(input.expectedFields),
  );
  expect(
    await sqlDocumentsPersistence.listPendingUpdates(
      input.execSql,
      input.localId,
    ),
  ).toHaveLength(0);
}

test("atomic profile initial syncs import cleanly into a fresh peer", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const artifacts = await buildOrganizationProvisioningArtifacts({
    encapsulationKeyPair,
    rootContainerId: crypto.randomUUID(),
    signingKeyPair,
    userId: crypto.randomUUID(),
  });
  const authorFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const profiles = [
    {
      expectedFields: { nickname: "You" },
      materialized: artifacts.rosterProfileBootstrap.profileDocument,
      request: artifacts.rosterProfileBootstrap.profileDocumentRequest,
    },
    {
      expectedFields: { name: "Personal Org" },
      materialized:
        artifacts.organizationMetadataBootstrap.organizationProfileDocument,
      request:
        artifacts.organizationMetadataBootstrap
          .organizationProfileDocumentRequest,
    },
  ];

  for (const [index, profile] of profiles.entries()) {
    const outgoingUpdate = profile.request.initialSync.outgoingUpdates[0];
    if (!outgoingUpdate) {
      throw new Error("Expected an atomic profile update");
    }
    const documentId = profile.materialized.plan.documentId;
    const decrypted = await decryptDocumentSyncUpdates({
      contentKey: profile.materialized.contentKey,
      contentKeyEpoch: profile.request.initialSync.contentKeyEpoch,
      documentId,
      organizationId: artifacts.organizationId,
      updates: [
        {
          ...outgoingUpdate,
          accessEpoch: 1,
          authorFingerprint,
          createdAt: "2026-07-13T00:00:00.000Z",
          documentId,
        },
      ],
    });
    const freshPeerDocument = await createDocument(
      `atomic-profile-fresh-peer-${index}`,
    );

    importUpdates(
      freshPeerDocument,
      decrypted.map((update) => update.updateData),
    );
    expect(readStoredDocumentState(freshPeerDocument).structuredFields).toEqual(
      expect.objectContaining(profile.expectedFields),
    );
  }
});

test("registerIdentity settles acknowledged profiles and retains legacy fallbacks", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const { close, execSql } = await createTestExecSql(
    "registration-atomic-profiles-settled",
  );
  let acknowledgeProfileUpdates = true;
  let captured: RegistrationRequest | null = null;
  const apiClient: RegistrationApi = {
    async registerUser(...args) {
      const [
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
        initialSystemContainers,
      ] = args;
      if (
        !initialRosterProfileContainer ||
        !initialRosterProfileDocument ||
        !initialOrganizationMetadataContainer ||
        !initialOrganizationProfileDocument
      ) {
        throw new Error("Expected provisioned profile requests");
      }
      const request: RegistrationRequest = {
        encapsulationPublicKey: Array.from(encapsulationPublicKey),
        initialAdminGroup,
        initialMemberGroup,
        initialOrganizationMetadataContainer,
        initialOrganizationPolicy,
        initialOrganizationProfileDocument,
        initialRootContainer,
        initialRootMetadataDocument,
        initialRosterProfileContainer,
        initialRosterProfileDocument,
        initialSystemContainers,
        organizationId,
        rootContainerId,
        signingPublicKey: Array.from(signingPublicKey),
        userId,
      };
      captured = request;
      const response = {
        ...(await respondToOrganizationProvisioning(request)),
        challenge: "a".repeat(64),
      };
      if (acknowledgeProfileUpdates) {
        return response;
      }
      const { committedProfileUpdateIds: _ignored, ...legacyResponse } =
        response;
      return legacyResponse;
    },
  };

  try {
    const response = await registerIdentity({
      apiClient,
      containerId: crypto.randomUUID(),
      dbClient: createClient(execSql),
      encapsulationKeyPair,
      pinLocalUserIdentity: async () => undefined,
      signingKeyPair,
    });
    const request = requireCapturedRequest(captured);
    const rosterRequest = request.initialRosterProfileDocument;
    const organizationRequest = request.initialOrganizationProfileDocument;
    if (
      !response ||
      !isProvisionedDocumentRequest(rosterRequest) ||
      !isProvisionedDocumentRequest(organizationRequest)
    ) {
      throw new Error("Expected provisioned profile response");
    }
    const profiles = [rosterRequest, organizationRequest];
    for (const profile of profiles) {
      expect(isDocumentSyncRequest(profile.initialSync)).toBe(true);
      expect(profile.initialSync.outgoingUpdates).toHaveLength(1);
      expect(profile.initialSync.expectedLinkSetManifestHash).toBe(
        profile.expectedManifestHash,
      );
      expect(
        Reflect.get(
          profile.initialSync.outgoingUpdates[0]?.writeHeader ?? {},
          "objectId",
        ),
      ).toBe(Reflect.get(profile.event, "objectId"));
    }
    if (
      !response.rosterProfileDocumentId ||
      !response.organizationProfileDocumentId
    ) {
      throw new Error("Expected profile document ids");
    }

    await expectSettledProfile({
      documentId: response.organizationProfileDocumentId,
      documentKind: "organization_profile",
      expectedFields: { name: "Personal Org" },
      execSql,
      localId: `org-profile:${request.organizationId}`,
      request: organizationRequest,
    });
    await expectSettledProfile({
      documentId: response.rosterProfileDocumentId,
      documentKind: "contact",
      expectedFields: { nickname: "You" },
      execSql,
      localId: getRosterProfileDocumentLocalId({
        organizationId: request.organizationId,
        userId: request.userId,
      }),
      request: rosterRequest,
    });

    acknowledgeProfileUpdates = false;
    captured = null;
    await registerIdentity({
      apiClient,
      containerId: crypto.randomUUID(),
      dbClient: createClient(execSql),
      encapsulationKeyPair,
      pinLocalUserIdentity: async () => undefined,
      signingKeyPair,
    });
    const legacyRequest = requireCapturedRequest(captured);
    expect(
      await sqlDocumentsPersistence.listPendingUpdates(
        execSql,
        `org-profile:${legacyRequest.organizationId}`,
      ),
    ).toHaveLength(1);
    expect(
      await sqlDocumentsPersistence.listPendingUpdates(
        execSql,
        getRosterProfileDocumentLocalId({
          organizationId: legacyRequest.organizationId,
          userId: legacyRequest.userId,
        }),
      ),
    ).toHaveLength(1);
  } finally {
    close();
  }
});
