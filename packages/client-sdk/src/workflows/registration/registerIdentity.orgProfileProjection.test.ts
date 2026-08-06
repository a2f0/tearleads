import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { createDocument, importSnapshot } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { respondToOrganizationProvisioning } from "../../../test/helpers/organizationProvisioningResponder";
import { getScopedPeerSeed } from "../../data/crdtPeerSeed";
import {
  createDocumentProjectorRegistry,
  type DocumentClientProjectionSaveInput,
  type DocumentProjectorDefinition,
  readStringDocumentField,
  resolveDocumentProjectorRegistry,
} from "../../data/documents/documentKinds";
import {
  DOCUMENTS_APP_KIND,
  sqlDocumentsPersistence,
} from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql, ExecSqlClientLike } from "../../data/sqlite/sqlSchema";
import { persistDocumentState } from "../documents";
import {
  getOrganizationProfileDocumentLocalId,
  ORGANIZATION_PROFILE_DOCUMENT_KIND,
  withOrganizationProfileFallbackTitle,
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

test("no-projector hosts keep the stable org profile title", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const { close, execSql } = await createTestExecSql(
    "registration-org-profile-fallback-title",
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

  try {
    const response = await registerIdentity({
      apiClient,
      containerId: crypto.randomUUID(),
      dbClient: createClient(execSql),
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

  try {
    const response = await registerIdentity({
      apiClient,
      containerId: crypto.randomUUID(),
      dbClient: createClient(execSql),
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
      documentProjectors: resolveDocumentProjectorRegistry(
        withOrganizationProfileFallbackTitle([]),
      ),
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

test("prototype-backed registries keep their methods through the wrap", () => {
  const base = createDocumentProjectorRegistry([]);
  // A class-implemented registry: every method lives on the prototype, so a
  // spread-based wrap would silently drop them all.
  class PrototypeRegistry {
    getDefinition(kind: string) {
      return base.getDefinition(kind);
    }
    getClientProjectionTables() {
      return base.getClientProjectionTables();
    }
    getStoredDocumentTypeLabel(kind: string) {
      return base.getStoredDocumentTypeLabel(kind);
    }
    getUntitledDocumentTitle(kind: string) {
      return base.getUntitledDocumentTitle(kind);
    }
    initializeStoredDocumentKind(
      ...args: Parameters<typeof base.initializeStoredDocumentKind>
    ) {
      return base.initializeStoredDocumentKind(...args);
    }
    projectStoredDocumentState(
      ...args: Parameters<typeof base.projectStoredDocumentState>
    ) {
      return base.projectStoredDocumentState(...args);
    }
    deleteStoredDocumentClientProjection(
      ...args: Parameters<typeof base.deleteStoredDocumentClientProjection>
    ) {
      return base.deleteStoredDocumentClientProjection(...args);
    }
    saveStoredDocumentClientProjection(
      ...args: Parameters<typeof base.saveStoredDocumentClientProjection>
    ) {
      return base.saveStoredDocumentClientProjection(...args);
    }
  }

  const wrapped = resolveDocumentProjectorRegistry(
    withOrganizationProfileFallbackTitle(new PrototypeRegistry()),
  );
  expect(wrapped.getClientProjectionTables()).toEqual([]);
  expect(
    wrapped.getUntitledDocumentTitle(ORGANIZATION_PROFILE_DOCUMENT_KIND),
  ).toBe("Organization Profile");
  expect(
    wrapped.projectStoredDocumentState({
      documentKind: ORGANIZATION_PROFILE_DOCUMENT_KIND,
      structuredFields: { name: "Acme Corp" },
      text: "",
    }).title,
  ).toBe("Organization Profile");
  expect(wrapped.getUntitledDocumentTitle("note")).toBe("Untitled note");
});
