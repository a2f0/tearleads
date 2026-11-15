import { expect, spyOn, test } from "bun:test";
import {
  type DocumentStore,
  defaultDocumentsPersistence,
  deriveStableDocumentId,
  getRosterProfileDocumentLocalId,
  type OrganizationDirectoryUser,
  Tearleads,
} from "@tearleads/client-sdk";
import { createTestExecSql } from "@tearleads/test-utils";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../document-types/projectors";
import { createRosterProfileDocument } from "./profileDocuments";

const user: OrganizationDirectoryUser = {
  createdAt: "2026-05-20T12:00:00.000Z",
  disabledAt: null,
  disabledByUserId: null,
  encapsulationKeyFingerprint: "encapsulation-fingerprint",
  encapsulationPublicKey: "encapsulation-public-key",
  isPersonalOrganizationOwner: false,
  isSelf: true,
  joinedAt: "2026-05-20T12:00:00.000Z",
  leaveRequest: null,
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
  const database = await createTestExecSql("fresh-roster-profile");
  const sdk = new Tearleads({
    database: { execSql: database.execSql, id: "fresh-roster-profile" },
    documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  });
  sdk.network.setOnline(false);
  const opened = Promise.withResolvers<DocumentStore>();
  const originalOpen = sdk.documents.open.bind(sdk.documents);
  const open = spyOn(sdk.documents, "open").mockImplementation((...args) => {
    const store = originalOpen(...args);
    opened.resolve(store);
    return store;
  });
  let active = true;
  let created: Promise<unknown> | undefined;
  try {
    const localId = getRosterProfileDocumentLocalId({
      organizationId: "organization-1",
      userId: user.userId,
    });
    const documentId = await deriveStableDocumentId(localId);
    created = createRosterProfileDocument({
      containerId: "roster-profile-container-1",
      documents: sdk.documents,
      identity: {
        encapsulationPublicKey: "trusted-encapsulation-public-key",
        userId: user.userId,
      },
      isSelf: true,
      names: { firstName: " Ada ", lastName: "Lovelace", nickname: "  " },
      organizationId: "organization-1",
      stillCurrent: () => active,
    }).catch((error: unknown) => error);
    const store = await opened.promise;
    expect(await store.ensureInitialized()).toBe(true);
    expect(store.getSnapshot().structuredFields).toEqual({
      encapsulationPublicKey: "trusted-encapsulation-public-key",
      firstName: "Ada",
      isSelf: "1",
      lastName: "Lovelace",
      nickname: "",
      userId: user.userId,
    });
    // Complete local identity binding through the actual store. This tests the
    // factory's awaited publication, not an authenticated server create.
    expect(
      await store.relink({
        localId,
        containerId: "roster-profile-container-1",
        documentId,
        accessEpoch: 1,
      }),
    ).not.toBeNull();
    expect(await created).toBe(documentId);
    expect(
      await defaultDocumentsPersistence.loadDocument(database.execSql, localId),
    ).toMatchObject({ documentId, title: "Ada Lovelace" });
  } finally {
    active = false;
    await created;
    open.mockRestore();
    sdk.dispose();
    database.close();
  }
});
