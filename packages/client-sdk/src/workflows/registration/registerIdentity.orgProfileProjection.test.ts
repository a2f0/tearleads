import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { createDocument, importSnapshot } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { execSqlClientFromExecSql } from "../../../test/helpers/execSqlClient";
import { respondToRegistration } from "../../../test/helpers/organizationProvisioningResponder";
import { getScopedPeerSeed } from "../../data/crdtPeerSeed";
import {
  createDocumentProjectorRegistry,
  type DocumentClientProjectionSaveInput,
  type DocumentProjectorDefinition,
  readStringDocumentField,
} from "../../data/documents/documentKinds";
import {
  DOCUMENTS_APP_KIND,
  sqlDocumentsPersistence,
} from "../../data/persistence/documents/documentsPersistence";
import { persistDocumentState } from "../documents";
import {
  getOrganizationProfileDocumentLocalId,
  ORGANIZATION_PROFILE_DOCUMENT_KIND,
} from "../organizations/organizationProfile";
import { type RegistrationApi, registerIdentity } from "./registerIdentity";

test("registration bootstrap projects the organization profile document", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const { close, execSql } = await createTestExecSql(
    "registration-org-profile-projection",
  );
  const apiClient: RegistrationApi = {
    async registerUser(...args) {
      return respondToRegistration(args);
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
      dbClient: execSqlClientFromExecSql(execSql),
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

test("no-projector hosts keep the stable org profile title", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const { close, execSql } = await createTestExecSql(
    "registration-org-profile-fallback-title",
  );
  const apiClient: RegistrationApi = {
    async registerUser(...args) {
      return respondToRegistration(args);
    },
  };

  try {
    const response = await registerIdentity({
      apiClient,
      containerId: crypto.randomUUID(),
      dbClient: execSqlClientFromExecSql(execSql),
      // No org-profile projector registered: the host relies on the SDK's
      // stable fallback rather than the registry's generic untitled form.
      documentProjectors: [],
      encapsulationKeyPair,
      organizationProfileName: "Acme Corp",
      pinLocalUserIdentity: async () => undefined,
      signingKeyPair,
    });
    if (!response) {
      throw new Error("Expected registration response");
    }

    const record = await sqlDocumentsPersistence.loadDocument(
      execSql,
      getOrganizationProfileDocumentLocalId({
        organizationId: response.organizationId,
      }),
    );
    expect(record?.title).toBe("Organization Profile");
  } finally {
    close();
  }
});

test("a later save cannot overwrite the fallback title", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const { close, execSql } = await createTestExecSql(
    "registration-org-profile-title-resave",
  );
  const apiClient: RegistrationApi = {
    async registerUser(...args) {
      return respondToRegistration(args);
    },
  };

  try {
    const response = await registerIdentity({
      apiClient,
      containerId: crypto.randomUUID(),
      dbClient: execSqlClientFromExecSql(execSql),
      documentProjectors: [],
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
    const record = await sqlDocumentsPersistence.loadDocument(execSql, localId);
    if (!record) {
      throw new Error("Expected persisted org profile record");
    }

    // Re-persist the document exactly as an ongoing client save would: with
    // the registry the client resolves once at construction. The fallback
    // must survive re-projection, not just the bootstrap write.
    const restore = await sqlDocumentsPersistence.loadHistoryRestoreState(
      execSql,
      localId,
    );
    if (!restore) {
      throw new Error("Expected history restore state");
    }
    const doc = await createDocument(
      await getScopedPeerSeed(DOCUMENTS_APP_KIND),
    );
    importSnapshot(doc, base64ToBytes(restore.snapshot));
    await persistDocumentState({
      currentDoc: doc,
      currentRecord: record,
      documentProjectors: [],
      execSql,
      localId,
      patch: {},
      persistence: sqlDocumentsPersistence,
    });

    const resaved = await sqlDocumentsPersistence.loadDocument(
      execSql,
      localId,
    );
    expect(resaved?.title).toBe("Organization Profile");
  } finally {
    close();
  }
});

test("the default registry titles the org profile kind", () => {
  const registry = createDocumentProjectorRegistry([]);
  expect(
    registry.getUntitledDocumentTitle(ORGANIZATION_PROFILE_DOCUMENT_KIND),
  ).toBe("Organization Profile");
  expect(
    registry.projectStoredDocumentState({
      documentKind: ORGANIZATION_PROFILE_DOCUMENT_KIND,
      structuredFields: { name: "Acme Corp" },
      text: "",
    }).title,
  ).toBe("Organization Profile");
  expect(registry.getUntitledDocumentTitle("note")).toBe("Untitled note");
});
