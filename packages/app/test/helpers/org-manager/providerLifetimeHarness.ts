import { expect, type Mock, spyOn } from "bun:test";
import {
  type ContainerContentsStore,
  type ContainerNode,
  createMemoryBlobStore,
  defaultDocumentsPersistence,
  deriveOrganizationMetadataContainerSystemSlot,
  deriveOrganizationRosterProfileContainerSystemSlot,
  deriveStableDocumentId,
  getOrganizationProfileDocumentLocalId,
  getRosterProfileDocumentLocalId,
  ORGANIZATION_PROFILE_DOCUMENT_KIND,
  type OrganizationDirectoryUser,
  syncedContainerDocumentObjectSyncState,
  Tearleads,
} from "@tearleads/client-sdk";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { useMemo, useSyncExternalStore } from "react";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../../src/document-types/projectors";
import * as SdkProvider from "../../../src/providers/sdk/TearleadsProvider";
import * as DeviceFirstProvider from "../../../src/stores/device-first/DeviceFirstProvider";
import {
  PROFILE_CONTAINER_ID,
  PROFILE_ORGANIZATION_ID,
  PROFILE_USER_ID,
  profileEditorUser,
} from "./profileEditorHarness";

export type ProfileKind = "roster" | "organization";
export type ProfileLifetimeBoundary = "container" | "identity" | "document";

function createLookupGate() {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  return {
    entered: entered.promise,
    release: () => release.resolve(),
    async pause() {
      entered.resolve();
      await release.promise;
    },
  };
}

function useHostRuntime(sdk: Tearleads): SdkProvider.RuntimeSnapshot {
  // Match TearleadsProvider: subscribe to the number, read input in render.
  // Reading input in the subscription would rotate the lazy domain during B
  // and accidentally turn this A-B-A test into an ordinary scope replacement.
  const version = useSyncExternalStore(
    sdk.runtime.subscribe,
    () => sdk.runtime.version,
    () => sdk.runtime.version,
  );
  return useMemo(() => {
    const input = sdk.runtime.input();
    return {
      ...input,
      auth: { ...input.auth, authToken: sdk.session.authToken },
      infra: { ...input.infra, dbId: sdk.database.id },
    };
  }, [sdk, version]);
}

type TestDatabase = Awaited<ReturnType<typeof createTestExecSql>>;
type ProfileRecord = Awaited<
  ReturnType<typeof defaultDocumentsPersistence.loadDocument>
>;

interface ProviderLifetimeHarness {
  database: TestDatabase;
  documentId: string;
  ensureContainer: Mock<ContainerContentsStore["ensureSystemContainer"]>;
  gate: ReturnType<typeof createLookupGate>;
  load: Mock<typeof defaultDocumentsPersistence.loadDocument>;
  open: Mock<Tearleads["documents"]["open"]>;
  preferredLocalId: string;
  published: { roster: string | null; organization: string | null };
  resolveVerified: Mock<Tearleads["userIdentities"]["resolveVerified"]>;
  sdk: Tearleads;
  systemSlot: NonNullable<ContainerNode["systemSlot"]>;
  updateProfile: Mock<Tearleads["organizations"]["updateProfile"]>;
  updateRosterEntry: Mock<Tearleads["organizations"]["updateRosterEntry"]>;
  user: OrganizationDirectoryUser;
  durableState(): Promise<{
    records: Awaited<ReturnType<TestDatabase["execSql"]>>;
    profile: ProfileRecord;
    preferred: ProfileRecord;
  }>;
  close(): void;
}

export async function createProviderLifetimeHarness(
  kind: ProfileKind,
  boundary?: ProfileLifetimeBoundary,
): Promise<ProviderLifetimeHarness> {
  const database = await createTestExecSql(`profile-provider-${kind}`);
  const config = {
    blobStore: createMemoryBlobStore(),
    database: { execSql: database.execSql, id: "profile-provider-db" },
    documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
    identityTrustDomain: "https://profile-lifetime.example.test/api/v1",
    online: false,
  };
  let sdk = new Tearleads(config);
  const restores: Array<() => void> = [];
  const gate = createLookupGate();
  try {
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
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    // Already-registered local fixture, not authenticated remote hydration.
    // Its directory pointer is absent; a healthy ensure must resolve this real
    // readable document, not manufacture a factory result or wait for a server.
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
    const seeded = sdk.documents.open({
      containerId: PROFILE_CONTAINER_ID,
      documentId,
      initialDocumentKind: documentKind,
      localId: documentId,
    });
    expect(await seeded.ensureInitialized()).toBe(true);
    await seeded.setStructuredFields(
      documentKind,
      kind === "roster" ? { firstName: "Preserved" } : { name: "Preserved" },
      { deferRemoteSync: true },
    );
    sdk.dispose();
    sdk = new Tearleads(config);
    await sdk.identity.setKeyPairs({
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
      signingKeyPair: generateSigningSeedAndKeyPair(),
    });
    // Host-restored session metadata only: there is no login/network proof.
    sdk.session.setContext({
      containerId: "profile-provider-root",
      isAuthenticated: true,
      organizationId: PROFILE_ORGANIZATION_ID,
      userId: PROFILE_USER_ID,
    });
    const link = await sdk.userIdentities.createLink(
      "https://profile-lifetime.example.test",
    );
    const identity = await sdk.userIdentities.verifyLink(link);
    expect(await sdk.userIdentities.resolveVerified(PROFILE_USER_ID)).toEqual(
      identity,
    );
    const user = {
      ...profileEditorUser(documentId),
      ...identity,
      isSelf: true,
      profileDocumentId: null,
    };
    const systemSlot = await (kind === "roster"
      ? deriveOrganizationRosterProfileContainerSystemSlot
      : deriveOrganizationMetadataContainerSystemSlot)({
      organizationId: PROFILE_ORGANIZATION_ID,
    });
    const container: ContainerNode = {
      id: PROFILE_CONTAINER_ID,
      kind: "container",
      name: "Profile container",
      organizationId: PROFILE_ORGANIZATION_ID,
      parentId: kind === "roster" ? sdk.session.containerId : null,
      syncState: syncedContainerDocumentObjectSyncState,
      systemSlot,
    };
    const containerStore = sdk.containerContents.openTree();
    const ensureContainer = spyOn(
      containerStore,
      "ensureSystemContainer",
    ).mockImplementation(async () => {
      if (boundary === "container") await gate.pause();
      return container;
    });
    restores.push(() => ensureContainer.mockRestore());
    const originalResolve = sdk.userIdentities.resolveVerified.bind(
      sdk.userIdentities,
    );
    const resolveVerified = spyOn(
      sdk.userIdentities,
      "resolveVerified",
    ).mockImplementation(async (userId) => {
      const resolved = await originalResolve(userId);
      if (boundary === "identity") await gate.pause();
      return resolved;
    });
    restores.push(() => resolveVerified.mockRestore());
    const originalLoad = defaultDocumentsPersistence.loadDocument;
    const load = spyOn(
      defaultDocumentsPersistence,
      "loadDocument",
    ).mockImplementation(async (...args) => {
      const record = await originalLoad(...args);
      if (
        boundary === "document" &&
        args[0] === database.execSql &&
        args[1] === preferredLocalId
      ) {
        await gate.pause();
      }
      return record;
    });
    restores.push(() => load.mockRestore());
    const open = spyOn(sdk.documents, "open");
    restores.push(() => open.mockRestore());
    // The remote metadata ports record publication; factories and document
    // selection/open/initialization/persistence are never replaced.
    const published: { roster: string | null; organization: string | null } = {
      roster: null,
      organization: null,
    };
    const updateRosterEntry = spyOn(
      sdk.organizations,
      "updateRosterEntry",
    ).mockImplementation(async (userId, profileDocumentId) => {
      published.roster = profileDocumentId;
      return { ...user, userId, profileDocumentId };
    });
    restores.push(() => updateRosterEntry.mockRestore());
    const updateProfile = spyOn(
      sdk.organizations,
      "updateProfile",
    ).mockImplementation(async (profileDocumentId) => {
      published.organization = profileDocumentId;
      return { organizationId: PROFILE_ORGANIZATION_ID, profileDocumentId };
    });
    restores.push(() => updateProfile.mockRestore());
    const sdkHook = spyOn(SdkProvider, "useTearleads").mockReturnValue(sdk);
    restores.push(() => sdkHook.mockRestore());
    const runtimeHook = spyOn(
      SdkProvider,
      "useTearleadsRuntime",
    ).mockImplementation(() => useHostRuntime(sdk));
    restores.push(() => runtimeHook.mockRestore());
    // OrgManager consumes only containerStore. Do not start DeviceFirst's
    // unrelated reconciler or replace any OrgManager hook/context behavior.
    const contentsHook = spyOn(
      DeviceFirstProvider,
      "useDeviceFirstContainerContents",
    ).mockReturnValue({ containerStore } as ReturnType<
      typeof DeviceFirstProvider.useDeviceFirstContainerContents
    >);
    restores.push(() => contentsHook.mockRestore());
    return {
      database,
      documentId,
      ensureContainer,
      gate,
      load,
      open,
      preferredLocalId,
      published,
      resolveVerified,
      sdk,
      systemSlot,
      updateProfile,
      updateRosterEntry,
      user,
      async durableState() {
        return {
          records: await database.execSql(
            "SELECT local_id AS id, document_id FROM documents WHERE app_kind = 'documents' ORDER BY local_id",
          ),
          profile: await originalLoad(database.execSql, documentId),
          preferred: await originalLoad(database.execSql, preferredLocalId),
        };
      },
      close() {
        for (const restore of restores.reverse()) restore();
        sdk.dispose();
        database.close();
      },
    };
  } catch (error) {
    for (const restore of restores.reverse()) restore();
    sdk.dispose();
    database.close();
    throw error;
  }
}
