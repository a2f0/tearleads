import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import {
  createDocument,
  encodeVersionVector,
  importUpdates,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  isDocumentSyncRequest,
  isProvisionedDocumentRequest,
  type ProvisionedDocumentRequest,
  type RegistrationRequest,
} from "@tearleads/validators/request";
import { execSqlClientFromExecSql } from "../../../test/helpers/execSqlClient";
import { respondToRegistration } from "../../../test/helpers/organizationProvisioningResponder";
import { readStoredDocumentState } from "../../data/documents/documentKinds";
import { decryptDocumentSyncUpdates } from "../../data/documents/shared/crypto";
import { deriveStableDocumentId } from "../../data/documents/shared/stableDocumentId";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { loadPersistedDocumentContent } from "../documents/historyContent";
import { getOrganizationProfileDocumentLocalId } from "../organizations/organizationProfile";
import { getRosterProfileDocumentLocalId } from "../organizations/rosterProfileContainer";
import {
  buildOrganizationProvisioningArtifacts,
  type RegistrationApi,
  registerIdentity,
} from "./registerIdentity";

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

  // Content is persisted only in the durable history (checkpoint + tail); the
  // record row carries the content frontier the bootstrap derived from it.
  const document = await loadPersistedDocumentContent({
    execSql: input.execSql,
    localId: input.localId,
    persistence: sqlDocumentsPersistence,
  });
  if (!document) {
    throw new Error(`Expected durable profile content ${input.localId}`);
  }
  const expectedVersionVector = input.request.initialSync.localVersionVector;
  if (expectedVersionVector === null) {
    throw new Error("Expected profile version vector");
  }
  expect(stored.snapshotEndVersion).toBe(expectedVersionVector);
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
          authorizationTargets: profile.materialized.plan.targets,
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

test("organization provisioning shares profile idempotency keys with later ensures", async () => {
  const artifacts = await buildOrganizationProvisioningArtifacts({
    encapsulationKeyPair: generateKemSeedAndKeyPair(),
    rootContainerId: crypto.randomUUID(),
    signingKeyPair: generateSigningSeedAndKeyPair(),
    userId: crypto.randomUUID(),
  });
  const localId = getOrganizationProfileDocumentLocalId({
    organizationId: artifacts.organizationId,
  });
  const rosterLocalId = getRosterProfileDocumentLocalId({
    organizationId: artifacts.organizationId,
    userId: artifacts.rootContainer.plan.event.signerUserId,
  });

  expect(
    Reflect.get(
      artifacts.organizationMetadataBootstrap.organizationProfileDocumentRequest
        .event,
      "objectId",
    ),
  ).toBe(await deriveStableDocumentId(localId));
  expect(
    Reflect.get(
      artifacts.rosterProfileBootstrap.profileDocumentRequest.event,
      "objectId",
    ),
  ).toBe(await deriveStableDocumentId(rosterLocalId));
});

test("registerIdentity settles acknowledged profiles", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const { close, execSql } = await createTestExecSql(
    "registration-atomic-profiles-settled",
  );
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
      captured = {
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
      return respondToRegistration(args);
    },
  };

  try {
    const response = await registerIdentity({
      apiClient,
      containerId: crypto.randomUUID(),
      dbClient: execSqlClientFromExecSql(execSql),
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
      localId: getOrganizationProfileDocumentLocalId({
        organizationId: request.organizationId,
      }),
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
  } finally {
    close();
  }
});
