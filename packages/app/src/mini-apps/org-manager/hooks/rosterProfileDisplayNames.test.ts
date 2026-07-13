import { expect, test } from "bun:test";
import type {
  DocumentStore,
  Documents,
  DocumentsRuntime,
  OrganizationDirectoryUser,
} from "@tearleads/client-sdk";
import { loadRosterProfileDisplayName } from "../../../stores/org-manager/rosterProfileDisplayNames";

const rosterUser: OrganizationDirectoryUser & { profileDocumentId: string } = {
  createdAt: "2026-05-20T12:00:00.000Z",
  disabledAt: null,
  disabledByUserId: null,
  encapsulationKeyFingerprint: "encapsulation-fingerprint",
  encapsulationPublicKey: "encapsulation-public-key",
  isSelf: true,
  joinedAt: "2026-05-20T12:00:00.000Z",
  profileDocumentId: "550e8400-e29b-41d4-a716-446655440001",
  signingKeyFingerprint: "signing-fingerprint",
  signingPublicKey: "signing-public-key",
  status: "active",
  updatedAt: "2026-05-20T12:00:00.000Z",
  userId: "550e8400-e29b-41d4-a716-446655440000",
};

test("roster profile display-name loading clears blank display names", async () => {
  const runtime = {} as DocumentsRuntime;
  const displayNameUpdates: Array<[string, string | null]> = [];
  const store = {
    getSnapshot: () => ({
      ready: true,
      structuredFields: {
        firstName: "",
        lastName: "",
        nickname: "",
      },
    }),
    relink: () => Promise.resolve(true),
    requestSync: () => undefined,
    subscribe: () => () => undefined,
  } as unknown as DocumentStore;
  const documents = {
    open: (
      input: {
        containerId?: string | null | undefined;
        documentId?: string | null | undefined;
        initialDocumentKind?: string | undefined;
        localId?: string | undefined;
      },
      options: { workflowRuntime?: DocumentsRuntime | undefined },
    ) => {
      expect(input).toEqual({
        containerId: "profile-container-1",
        documentId: rosterUser.profileDocumentId,
        initialDocumentKind: "contact",
        localId: `org-profile:organization-1:${rosterUser.userId}`,
      });
      expect(options.workflowRuntime).toBe(runtime);
      return store;
    },
  } as unknown as Documents;

  await loadRosterProfileDisplayName({
    documents,
    isCancelled: () => false,
    organizationId: "organization-1",
    profileContainerId: "profile-container-1",
    runtime,
    setProfileDisplayName: (userId, displayName) => {
      displayNameUpdates.push([userId, displayName]);
    },
    unsubscribes: [],
    user: rosterUser,
  });

  expect(displayNameUpdates).toEqual([[rosterUser.userId, null]]);
});
