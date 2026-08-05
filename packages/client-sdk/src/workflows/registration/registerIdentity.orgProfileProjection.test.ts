import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { respondToOrganizationProvisioning } from "../../../test/helpers/organizationProvisioningResponder";
import {
  type DocumentClientProjectionSaveInput,
  type DocumentProjectorDefinition,
  readStringDocumentField,
} from "../../data/documents/documentKinds";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql, ExecSqlClientLike } from "../../data/sqlite/sqlSchema";
import {
  getOrganizationProfileDocumentLocalId,
  ORGANIZATION_PROFILE_DOCUMENT_KIND,
} from "../organizations/organizationProfile";
import { type RegistrationApi, registerIdentity } from "./registerIdentity";

function createClient(execSql: ExecSql): ExecSqlClientLike {
  return {
    async exec({ bind, rowMode, sql }) {
      return {
        rows: await execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  };
}

test("registration bootstrap projects the organization profile document", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const { close, execSql } = await createTestExecSql(
    "registration-org-profile-projection",
  );
  const apiClient: RegistrationApi = {
    async registerUser(...args) {
      const request = {
        userId: args[0],
        organizationId: args[1],
        rootContainerId: args[2],
        signingPublicKey: Array.from(args[3]),
        encapsulationPublicKey: Array.from(args[4]),
        initialAdminGroup: args[5],
        initialMemberGroup: args[6],
        initialOrganizationPolicy: args[7],
        initialRootContainer: args[8],
        initialRootMetadataDocument: args[9],
        initialRosterProfileContainer: args[10],
        initialRosterProfileDocument: args[11],
        initialOrganizationMetadataContainer: args[12],
        initialOrganizationProfileDocument: args[13],
        initialSystemContainers: args[14],
      };
      return {
        ...(await respondToOrganizationProvisioning(request)),
        challenge: "a".repeat(64),
      };
    },
  };

  // Mirrors the host's organization-profile projector: the title derives from
  // the profile's name field, and the client projection is written per save.
  const projectionSaves: DocumentClientProjectionSaveInput[] = [];
  const organizationProfileProjector: DocumentProjectorDefinition = {
    kind: ORGANIZATION_PROFILE_DOCUMENT_KIND,
    clientProjection: {
      save: (input) => {
        projectionSaves.push(input);
      },
      tables: [],
    },
    project: ({ structuredFields }) => {
      const name = readStringDocumentField(structuredFields, "name", []) ?? "";
      return {
        fieldValidationIssues: [],
        structuredFields: { name },
        title: name.trim() || "Organization Profile",
      };
    },
    untitledTitle: "Organization Profile",
  };

  try {
    const response = await registerIdentity({
      apiClient,
      containerId: crypto.randomUUID(),
      dbClient: createClient(execSql),
      documentProjectors: [organizationProfileProjector],
      encapsulationKeyPair,
      organizationProfileName: "Acme Corp",
      pinLocalUserIdentity: async () => undefined,
      signingKeyPair,
    });
    if (!response) {
      throw new Error("Expected registration response");
    }

    const localId = getOrganizationProfileDocumentLocalId({
      organizationId: response.organizationId,
    });

    // The bootstrap persist must write the client projection row, not just
    // the document record.
    const organizationProfileSaves = projectionSaves.filter(
      (save) => save.localId === localId,
    );
    expect(organizationProfileSaves).toHaveLength(1);
    expect(organizationProfileSaves[0]?.documentKind).toBe(
      ORGANIZATION_PROFILE_DOCUMENT_KIND,
    );

    // And the persisted record carries the projector-derived title rather
    // than a hardcoded placeholder.
    const record = await sqlDocumentsPersistence.loadDocument(execSql, localId);
    expect(record?.title).toBe("Acme Corp");
  } finally {
    close();
  }
});
