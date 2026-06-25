import { expect, test } from "bun:test";
import {
  buildRosterProfileDocumentPatch,
  type DocumentStore,
  type Documents,
  getRosterProfileDocumentLocalId,
  type OrganizationDirectoryUser,
} from "@tearleads/client-sdk";
import { createRosterProfileDocument } from "./profileDocuments";

const user: OrganizationDirectoryUser = {
  accountStatus: "active",
  createdAt: "2026-05-20T12:00:00.000Z",
  disabledAt: null,
  disabledByUserId: null,
  encapsulationKeyFingerprint: "encapsulation-fingerprint",
  encapsulationPublicKey: "encapsulation-public-key",
  isSelf: true,
  joinedAt: "2026-05-20T12:00:00.000Z",
  profileDocumentId: null,
  signingKeyFingerprint: "signing-fingerprint",
  signingPublicKey: "signing-public-key",
  status: "active",
  userId: "550e8400-e29b-41d4-a716-446655440000",
};

test("roster profile documents use stable org-scoped local ids", () => {
  expect(
    getRosterProfileDocumentLocalId({
      organizationId: "organization-1",
      userId: user.userId,
    }),
  ).toBe(`org-profile:organization-1:${user.userId}`);
});

test("roster profile documents seed contact identity fields", () => {
  expect(buildRosterProfileDocumentPatch(user)).toEqual({
    encapsulationPublicKey: user.encapsulationPublicKey,
    isSelf: "1",
    userId: user.userId,
  });
});

test("roster profile document sync wait handles synchronous subscriptions", async () => {
  let documentId: string | null = null;
  let requestSyncCalls = 0;
  let unsubscribeCalls = 0;
  const store = {
    ensureInitialized: () => Promise.resolve(true),
    getSnapshot: () => ({ documentId, ready: true }),
    requestSync: () => {
      requestSyncCalls += 1;
    },
    setStructuredFields: () => Promise.resolve(),
    subscribe: (listener: () => void) => {
      documentId = "profile-document-1";
      listener();
      return () => {
        unsubscribeCalls += 1;
      };
    },
  } as unknown as DocumentStore;
  const documents = {
    open: (input: { containerId?: string | null | undefined }) => {
      expect(input.containerId).toBe("roster-profile-container-1");
      return store;
    },
  } as unknown as Documents;

  const createdDocumentId = await createRosterProfileDocument({
    containerId: "roster-profile-container-1",
    documents,
    organizationId: "organization-1",
    user,
  });

  expect(createdDocumentId).toBe("profile-document-1");
  expect(unsubscribeCalls).toBe(1);
  expect(requestSyncCalls).toBe(1);
});
