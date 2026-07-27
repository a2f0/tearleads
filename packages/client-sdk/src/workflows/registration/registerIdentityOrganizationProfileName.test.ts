import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
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
import { readStoredDocumentState } from "../../data/documents/documentKinds";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql, ExecSqlClientLike } from "../../data/sqlite/sqlSchema";
import { loadPersistedDocumentContent } from "../documents/historyContent";
import { readOrganizationProfileName } from "../organizations/organizationProfile";
import { getRosterProfileDocumentLocalId } from "../organizations/rosterProfileContainer";
import { registerIdentity } from "./registerIdentity";

function createDbClient(execSql: ExecSql): ExecSqlClientLike {
  return {
    async exec({ bind, rowMode, sql }) {
      return {
        rows: await execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  };
}

// Registration API stub that echoes a well-formed response so registerIdentity
// proceeds to persist the organization profile document locally, where the test
// can read back the seeded org name.
const registrationApi = {
  registerUser: async (
    userId: string,
    organizationId: string,
    rootContainerId: string,
    _signingPublicKey: Uint8Array,
    _encapsulationPublicKey: Uint8Array,
    _initialAdminGroup: CreateOrganizationGroupRequest,
    _initialMemberGroup: CreateOrganizationGroupRequest,
    _initialOrganizationPolicy: RegistrationRequest["initialOrganizationPolicy"],
    initialRootContainer: RegistrationRequest["initialRootContainer"],
    initialRootMetadataDocument: ProvisionedDocumentRequest,
    initialRosterProfileContainer?:
      | ProvisionedSystemContainerRequest
      | undefined,
    initialRosterProfileDocument?: ProvisionedDocumentRequest | undefined,
    initialOrganizationMetadataContainer?:
      | ProvisionedSystemContainerRequest
      | undefined,
    initialOrganizationProfileDocument?: ProvisionedDocumentRequest | undefined,
  ): Promise<RegistrationResponse> => {
    if (
      !initialRosterProfileContainer ||
      !initialRosterProfileDocument ||
      !initialOrganizationMetadataContainer ||
      !initialOrganizationProfileDocument
    ) {
      throw new Error("Expected roster/organization profile requests");
    }
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

async function registerAndReadOrganizationName(
  label: string,
  organizationProfileName?: string,
): Promise<string | null> {
  const { close, execSql } = await createTestExecSql(label);
  try {
    const response = await registerIdentity({
      apiClient: registrationApi,
      containerId: crypto.randomUUID(),
      dbClient: createDbClient(execSql),
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
      ...(organizationProfileName ? { organizationProfileName } : {}),
      pinLocalUserIdentity: async () => undefined,
      signingKeyPair: generateSigningSeedAndKeyPair(),
    });
    if (!response) {
      throw new Error("Expected a registration response");
    }
    // Content is persisted only in the durable history (checkpoint + tail).
    const doc = await loadPersistedDocumentContent({
      execSql,
      localId: `org-profile:${response.organizationId}`,
      persistence: sqlDocumentsPersistence,
    });
    if (!doc) {
      throw new Error("Expected persisted organization profile document");
    }
    return readOrganizationProfileName(
      readStoredDocumentState(doc).structuredFields,
    );
  } finally {
    close();
  }
}

test("registerIdentity defaults the personal org name when none is given", async () => {
  expect(
    await registerAndReadOrganizationName("registration-org-name-default"),
  ).toBe("Personal Org");
});

test("registerIdentity names the personal org from organizationProfileName", async () => {
  expect(
    await registerAndReadOrganizationName(
      "registration-org-name-override",
      "Peer 2's Org",
    ),
  ).toBe("Peer 2's Org");
});

async function registerAndReadRosterNickname(
  label: string,
  rosterProfileNickname?: string,
): Promise<string | null> {
  const { close, execSql } = await createTestExecSql(label);
  try {
    const response = await registerIdentity({
      apiClient: registrationApi,
      containerId: crypto.randomUUID(),
      dbClient: createDbClient(execSql),
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
      ...(rosterProfileNickname ? { rosterProfileNickname } : {}),
      pinLocalUserIdentity: async () => undefined,
      signingKeyPair: generateSigningSeedAndKeyPair(),
    });
    if (!response) {
      throw new Error("Expected a registration response");
    }
    // Content is persisted only in the durable history (checkpoint + tail).
    const doc = await loadPersistedDocumentContent({
      execSql,
      localId: getRosterProfileDocumentLocalId({
        organizationId: response.organizationId,
        userId: response.userId,
      }),
      persistence: sqlDocumentsPersistence,
    });
    if (!doc) {
      throw new Error("Expected persisted roster profile document");
    }
    const { nickname } = readStoredDocumentState(doc).structuredFields;
    return typeof nickname === "string" ? nickname : null;
  } finally {
    close();
  }
}

test('registerIdentity defaults the self roster nickname to "You"', async () => {
  expect(
    await registerAndReadRosterNickname("registration-roster-nickname-default"),
  ).toBe("You");
});

test("registerIdentity names the self roster entry from rosterProfileNickname", async () => {
  expect(
    await registerAndReadRosterNickname(
      "registration-roster-nickname-override",
      "Peer 1 (You)",
    ),
  ).toBe("Peer 1 (You)");
});
