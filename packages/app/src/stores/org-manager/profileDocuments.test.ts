import { expect, test } from "bun:test";
import {
  type DocumentStore,
  type Documents,
  getRosterProfileDocumentLocalId,
  type OrganizationDirectoryUser,
} from "@tearleads/client-sdk";
import { createRosterProfileDocument } from "./profileDocuments";

const user: OrganizationDirectoryUser = {
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
  updatedAt: "2026-05-20T12:00:00.000Z",
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

test("roster profile documents persist trusted identity fields", async () => {
  let documentId: string | null = null;
  let requestSyncCalls = 0;
  let structuredFields: Readonly<Record<string, string | undefined>> = {};
  let unsubscribeCalls = 0;
  const store = {
    ensureInitialized: () => Promise.resolve(true),
    getSnapshot: () => ({ documentId, ready: true }),
    requestSync: () => {
      requestSyncCalls += 1;
    },
    setStructuredFields: (
      _documentKind: string,
      patch: Readonly<Record<string, string | undefined>>,
    ) => {
      structuredFields = patch;
      return Promise.resolve();
    },
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
    identity: {
      encapsulationPublicKey: "trusted-encapsulation-public-key",
      userId: user.userId,
    },
    isSelf: true,
    nickname: "Ada",
    organizationId: "organization-1",
  });

  expect(createdDocumentId).toBe("profile-document-1");
  expect(structuredFields).toEqual({
    encapsulationPublicKey: "trusted-encapsulation-public-key",
    isSelf: "1",
    nickname: "Ada",
    userId: user.userId,
  });
  expect(unsubscribeCalls).toBe(1);
  expect(requestSyncCalls).toBe(1);
});
