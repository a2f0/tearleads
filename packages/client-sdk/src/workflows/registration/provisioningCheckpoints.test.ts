import { expect, test } from "bun:test";
import {
  type AccessManifest,
  type AccessManifestCheckpoint,
  accessManifestCheckpointFromManifest,
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { CreateOrganizationRequest } from "@tearleads/validators/request";
import type { CreateOrganizationResponse } from "@tearleads/validators/response";
import { execSqlClientFromExecSql } from "../../../test/helpers/execSqlClient";
import { respondToOrganizationProvisioning } from "../../../test/helpers/organizationProvisioningResponder";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import {
  loadAccessManifestCheckpoint,
  loadPrincipalPolicyCheckpoint,
} from "../../data/persistence/keyingCheckpointPersistence";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { createOrganization } from "../organizations/createOrganization";

const SYSTEM_CONTAINER = {
  icon: "trash",
  name: "Trash",
  slotDefinition: {
    namespace: "tearleads.explorer",
    projectorId: "explorer",
    slotId: "trash",
    version: 1,
  },
} as const;

function checkpoint(input: {
  manifest: Record<string, unknown>;
  manifestHash: string;
}): AccessManifestCheckpoint {
  return accessManifestCheckpointFromManifest({
    manifest: input.manifest as unknown as AccessManifest,
    manifestHash: input.manifestHash,
  });
}

type CompleteProvisioningResponse = CreateOrganizationResponse & {
  organizationMetadataContainer: NonNullable<
    CreateOrganizationResponse["organizationMetadataContainer"]
  >;
  organizationProfileDocument: NonNullable<
    CreateOrganizationResponse["organizationProfileDocument"]
  >;
  rosterProfileContainer: NonNullable<
    CreateOrganizationResponse["rosterProfileContainer"]
  >;
  rosterProfileDocument: NonNullable<
    CreateOrganizationResponse["rosterProfileDocument"]
  >;
};

function requireCoreResponse(
  response: CreateOrganizationResponse | null,
): CompleteProvisioningResponse {
  if (
    !response?.rosterProfileContainer ||
    !response.rosterProfileDocument ||
    !response.organizationMetadataContainer ||
    !response.organizationProfileDocument
  ) {
    throw new Error("Expected a complete organization provisioning response");
  }
  return response as CompleteProvisioningResponse;
}

function requireCapturedRequest(
  request: CreateOrganizationRequest | null,
): CreateOrganizationRequest {
  if (!request) {
    throw new Error("Expected the provisioning request to be captured");
  }
  return request;
}

function expectedProvisioningHeads(
  request: CreateOrganizationRequest,
  response: ReturnType<typeof requireCoreResponse>,
): AccessManifestCheckpoint[] {
  const bundles = [
    {
      manifest: request.initialRootContainer.manifest,
      manifestHash: request.initialRootContainer.expectedManifestHash,
    },
    response.rootMetadataDocument.accessManifest,
    response.rosterProfileContainer.container.accessManifest,
    response.rosterProfileContainer.metadataDocument.accessManifest,
    response.rosterProfileDocument.accessManifest,
    response.organizationMetadataContainer.container.accessManifest,
    response.organizationMetadataContainer.metadataDocument.accessManifest,
    response.organizationProfileDocument.accessManifest,
    ...response.systemContainers.flatMap((entry) => [
      entry.container.accessManifest,
      entry.metadataDocument.accessManifest,
    ]),
  ];
  return bundles.map(checkpoint);
}

async function expectStoredAccessHeads(
  execSql: ExecSql,
  expected: readonly AccessManifestCheckpoint[],
): Promise<void> {
  for (const head of expected) {
    expect(
      await loadAccessManifestCheckpoint(
        execSql,
        head.objectKind,
        head.organizationId,
        head.objectId,
      ),
    ).toEqual(head);
  }
  const rows = await execSql(
    "SELECT COUNT(*) AS count FROM access_manifest_checkpoints",
  );
  expect(rows).toEqual([{ count: expected.length }]);
}

async function expectStoredOrganizationPolicy(
  execSql: ExecSql,
  request: CreateOrganizationRequest,
): Promise<void> {
  const stateHash = await computePrincipalStateHash(
    request.initialOrganizationPolicy.state,
  );
  expect(
    await loadPrincipalPolicyBundle(
      execSql,
      "organization",
      request.organizationId,
    ),
  ).toEqual(
    expect.objectContaining({
      currentProjection: request.initialOrganizationPolicy.projection,
      currentState: expect.objectContaining({ stateHash }),
    }),
  );
  expect(
    await loadPrincipalPolicyCheckpoint(
      execSql,
      "organization",
      request.organizationId,
    ),
  ).toEqual({
    principalType: "organization",
    principalId: request.organizationId,
    version: request.initialOrganizationPolicy.state.version,
    stateHash,
  });
}

test("organization provisioning pins every acknowledged access and policy head", async () => {
  const { close, execSql } = await createTestExecSql(
    "registration-provisioning-checkpoints-test",
  );
  let request: CreateOrganizationRequest | null = null;
  try {
    const response = requireCoreResponse(
      await createOrganization({
        apiClient: {
          createOrganization: async (value) => {
            request = value;
            return respondToOrganizationProvisioning(value);
          },
        },
        dbClient: execSqlClientFromExecSql(execSql),
        encapsulationKeyPair: generateKemSeedAndKeyPair(),
        provisionedSystemContainers: [SYSTEM_CONTAINER],
        signingKeyPair: generateSigningSeedAndKeyPair(),
        userId: crypto.randomUUID(),
      }),
    );
    const capturedRequest = requireCapturedRequest(request);
    const heads = expectedProvisioningHeads(capturedRequest, response);
    expect(heads).toHaveLength(10);
    await expectStoredAccessHeads(execSql, heads);
    await expectStoredOrganizationPolicy(execSql, capturedRequest);
  } finally {
    close();
  }
});

test("an incomplete provisioning acknowledgement persists no bootstrap state", async () => {
  const { close, execSql } = await createTestExecSql(
    "registration-provisioning-rejection-test",
  );
  let request: CreateOrganizationRequest | null = null;
  try {
    await expect(
      createOrganization({
        apiClient: {
          createOrganization: async (value) => {
            request = value;
            const response = await respondToOrganizationProvisioning(value);
            return { ...response, rosterProfileContainer: undefined };
          },
        },
        dbClient: execSqlClientFromExecSql(execSql),
        encapsulationKeyPair: generateKemSeedAndKeyPair(),
        logError: () => undefined,
        signingKeyPair: generateSigningSeedAndKeyPair(),
        userId: crypto.randomUUID(),
      }),
    ).rejects.toThrow(
      "Organization provisioning response is missing roster profile container",
    );
    const capturedRequest = requireCapturedRequest(request);
    expect(
      await loadAccessManifestCheckpoint(
        execSql,
        "container",
        capturedRequest.organizationId,
        capturedRequest.rootContainerId,
      ),
    ).toBeNull();
    expect(
      await loadPrincipalPolicyBundle(
        execSql,
        "organization",
        capturedRequest.organizationId,
      ),
    ).toBeNull();
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    expect(
      await sqlContainerContentsPersistence.loadContainers(execSql),
    ).toEqual([]);
  } finally {
    close();
  }
});
