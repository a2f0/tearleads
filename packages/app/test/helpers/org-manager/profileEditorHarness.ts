import { expect, spyOn } from "bun:test";
import {
  type ContainerNode,
  defaultDocumentsPersistence,
  deriveStableDocumentId,
  getOrganizationProfileDocumentLocalId,
  getRosterProfileDocumentLocalId,
  ORGANIZATION_PROFILE_DOCUMENT_KIND,
  type OrganizationDirectoryUser,
  Tearleads,
} from "@tearleads/client-sdk";
import { createTestExecSql } from "@tearleads/test-utils";
import { useSyncExternalStore } from "react";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../../src/document-types/projectors";
import * as SdkProvider from "../../../src/providers/sdk/TearleadsProvider";
import * as OrgManagerProvider from "../../../src/stores/org-manager/OrgManagerProvider";

export const PROFILE_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
export const PROFILE_USER_ID = "00000000-0000-4000-8000-000000000002";
export const PROFILE_CONTAINER_ID = "00000000-0000-4000-8000-000000000003";
export const UNKNOWN_PROFILE_ROW = {
  type: "future-profile-field",
  label: "Preserve this row",
  opaque: "retained-value",
};

export function profileEditorUser(
  documentId: string,
): OrganizationDirectoryUser {
  return {
    createdAt: "2026-11-01T00:00:00.000Z",
    disabledAt: null,
    disabledByUserId: null,
    encapsulationKeyFingerprint: "encapsulation-fingerprint",
    encapsulationPublicKey: "encapsulation-public-key",
    isPersonalOrganizationOwner: false,
    isSelf: false,
    joinedAt: "2026-11-01T00:00:00.000Z",
    leaveRequest: null,
    profileDocumentId: documentId,
    signingKeyFingerprint: "signing-fingerprint",
    signingPublicKey: "signing-public-key",
    status: "active",
    updatedAt: "2026-11-01T00:00:00.000Z",
    userId: PROFILE_USER_ID,
  };
}

type ProfileEditorDurableState = {
  document: Awaited<
    ReturnType<typeof defaultDocumentsPersistence.loadDocument>
  >;
  history: Awaited<
    ReturnType<typeof defaultDocumentsPersistence.loadHistoryRestoreState>
  >;
  pending: Awaited<
    ReturnType<typeof defaultDocumentsPersistence.listPendingUpdates>
  >;
};

export async function createProfileEditorHarness(
  kind: "roster" | "organization",
  access: "read" | "write" = "write",
) {
  const database = await createTestExecSql(`mounted-${kind}-profile`);
  const config = {
    database: { execSql: database.execSql, id: "profile-editor-db" },
    documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  };
  const preferredLocalId =
    kind === "roster"
      ? getRosterProfileDocumentLocalId({
          organizationId: PROFILE_ORGANIZATION_ID,
          userId: PROFILE_USER_ID,
        })
      : getOrganizationProfileDocumentLocalId({
          organizationId: PROFILE_ORGANIZATION_ID,
        });
  const documentId = await deriveStableDocumentId(preferredLocalId);
  const documentKind =
    kind === "roster" ? "contact" : ORGANIZATION_PROFILE_DOCUMENT_KIND;
  const fields: Record<string, string> =
    kind === "roster"
      ? {
          firstName: "Ada",
          lastName: "Lovelace",
          nickname: "Existing nickname",
          userId: PROFILE_USER_ID,
        }
      : { name: "Existing organization", unknownProfileField: "preserve me" };
  const firstSdk = new Tearleads(config);
  firstSdk.network.setOnline(false);
  let sdk = firstSdk;
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    const discovered =
      await defaultDocumentsPersistence.upsertDiscoveredDocument(
        database.execSql,
        {
          accessEpoch: 1,
          containerId: PROFILE_CONTAINER_ID,
          createdAt: "2026-11-01T00:00:00.000Z",
          documentId,
          effectiveAccessLevel: "write",
          linkedContainerIds: [PROFILE_CONTAINER_ID],
        },
      );
    expect(discovered.id).toBe(documentId);
    // Real discovery persistence followed by real local materialization. This
    // does not claim authenticated network discovery or a database-file reopen.
    const backing = firstSdk.documents.open({
      containerId: PROFILE_CONTAINER_ID,
      documentId,
      initialDocumentKind: documentKind,
      localId: discovered.id,
    });
    expect(await backing.ensureInitialized()).toBe(true);
    await backing.setStructuredFields(documentKind, fields, {
      deferRemoteSync: true,
    });
    const rowId = await backing.addRow(UNKNOWN_PROFILE_ROW);
    expect(backing.getSnapshot().structuredFields).toMatchObject(fields);
    expect(backing.getSnapshot().rows).toMatchObject([
      { id: rowId, fields: UNKNOWN_PROFILE_ROW },
    ]);
    if (access === "read") {
      const record = await defaultDocumentsPersistence.loadDocument(
        database.execSql,
        documentId,
      );
      if (!record) throw new Error("Expected materialized profile");
      await defaultDocumentsPersistence.saveDocument(database.execSql, {
        ...record,
        effectiveAccessLevel: "read",
      });
    }
    firstSdk.dispose();
    sdk = new Tearleads(config);
    sdk.network.setOnline(false);
    expect(await sdk.documents.findLocalIdByDocumentId(documentId)).toBe(
      documentId,
    );
    return {
      database,
      documentId,
      documentKind,
      fields,
      preferredLocalId,
      rowId,
      get sdk() {
        return sdk;
      },
      async assertOnlyOriginalRecord() {
        expect(
          await defaultDocumentsPersistence.loadDocument(
            database.execSql,
            preferredLocalId,
          ),
        ).toBeNull();
        const records = await database.execSql(
          "SELECT local_id AS id, document_id FROM documents WHERE app_kind = 'documents'",
        );
        expect(records).toEqual([{ id: documentId, document_id: documentId }]);
      },
      async durableState(): Promise<ProfileEditorDurableState> {
        return {
          document: await defaultDocumentsPersistence.loadDocument(
            database.execSql,
            documentId,
          ),
          history: await defaultDocumentsPersistence.loadHistoryRestoreState(
            database.execSql,
            documentId,
          ),
          pending: await defaultDocumentsPersistence.listPendingUpdates(
            database.execSql,
            documentId,
          ),
        };
      },
      async reopen() {
        // A new SDK/domain over the same open SQLite database, not a DB reopen.
        sdk.dispose();
        sdk = new Tearleads(config);
        sdk.network.setOnline(false);
        const store = sdk.documents.open({
          containerId: PROFILE_CONTAINER_ID,
          documentId,
          initialDocumentKind: documentKind,
          localId: documentId,
        });
        expect(await store.ensureInitialized()).toBe(true);
        return store.getSnapshot();
      },
      close() {
        sdk.dispose();
        database.close();
      },
    };
  } catch (error) {
    sdk.dispose();
    database.close();
    throw error;
  }
}

export function installProfileEditorHost(
  sdk: Tearleads,
  overrides: Partial<
    ReturnType<typeof OrgManagerProvider.useOrgManagerActions>
  > = {},
) {
  // Substitute host/provider seams only. DocumentsProvider, document stores,
  // runtime subscriptions, Loro mutations and SQLite remain production code.
  const container: ContainerNode = {
    id: PROFILE_CONTAINER_ID,
    kind: "container",
    name: "Profile container",
    organizationId: PROFILE_ORGANIZATION_ID,
    parentId: null,
    syncState: {
      lastError: null,
      pendingAttachmentBytes: 0,
      pendingAttachmentCount: 0,
      pendingUpdateCount: 0,
      status: "synced",
    },
  };
  const actions = OrgManagerProvider.createOrgManagerContextValue(
    sdk.organizations,
    {
      captureOperationScope: () => null,
      isOperationScopeActive: () => false,
      ensureRosterProfileDocument: async () => null,
      ensureOrganizationProfileDocument: async () => null,
      ensureRosterProfileContainer: async () => container,
      ensureOrganizationMetadataContainer: async () => container,
    },
  );
  const restoreRuntime = installProfileEditorRuntime(sdk);
  const actionsHook = spyOn(
    OrgManagerProvider,
    "useOrgManagerActions",
  ).mockReturnValue({ ...actions, ...overrides });
  return () => {
    actionsHook.mockRestore();
    restoreRuntime();
  };
}

export function installProfileEditorRuntime(sdk: Tearleads) {
  let version = sdk.runtime.version;
  const snapshot = (): SdkProvider.RuntimeSnapshot => {
    const input = sdk.runtime.input();
    return {
      ...input,
      auth: { ...input.auth, authToken: sdk.session.authToken },
      infra: { ...input.infra, dbId: sdk.database.id },
    };
  };
  let runtime = snapshot();
  const getSnapshot = () => {
    if (version !== sdk.runtime.version) {
      version = sdk.runtime.version;
      runtime = snapshot();
    }
    return runtime;
  };
  const sdkHook = spyOn(SdkProvider, "useTearleads").mockReturnValue(sdk);
  const runtimeHook = spyOn(
    SdkProvider,
    "useTearleadsRuntime",
  ).mockImplementation(() =>
    useSyncExternalStore(sdk.runtime.subscribe, getSnapshot, getSnapshot),
  );
  return () => {
    runtimeHook.mockRestore();
    sdkHook.mockRestore();
  };
}
