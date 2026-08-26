import { expect, test } from "bun:test";
import {
  createDocumentsWorkflowRuntime,
  defaultDocumentsPersistence,
  getRosterProfileDocumentLocalId,
  type OrganizationDirectoryAndGroups,
  type OrganizationDirectoryUser,
  openDocumentStore,
} from "@symcrypt/client-sdk";
import { createMockApiClient } from "@symcrypt/test-utils";
import { createSqlRuntimeBase } from "../../../test/helpers/createSqlRuntime";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../document-types/projectors";
import {
  getLocalRosterProfileDisplayNames,
  getRosterProfileBindingsByLocalId,
} from "./rosterProfileDisplayNames";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_DOCUMENT_ID = "00000000-0000-4000-8000-000000000002";
const FIRST_USER_ID = "00000000-0000-4000-8000-000000000003";
const SECOND_USER_ID = "00000000-0000-4000-8000-000000000004";

function rosterUser(userId: string): OrganizationDirectoryUser {
  return {
    createdAt: "2026-08-25T12:00:00.000Z",
    disabledAt: "2026-08-25T13:00:00.000Z",
    disabledByUserId: "admin-user-id",
    encapsulationKeyFingerprint: `encapsulation-${userId}`,
    encapsulationPublicKey: `encapsulation-key-${userId}`,
    isSelf: false,
    joinedAt: "2026-08-25T12:00:00.000Z",
    profileDocumentId: PROFILE_DOCUMENT_ID,
    signingKeyFingerprint: `signing-${userId}`,
    signingPublicKey: `signing-key-${userId}`,
    status: "disabled",
    updatedAt: "2026-08-25T13:00:00.000Z",
    userId,
  };
}

function projection(): OrganizationDirectoryAndGroups {
  return {
    directory: {
      currentUser: { isOrgAdmin: true },
      organizationId: ORGANIZATION_ID,
      profileDocumentId: null,
      users: [rosterUser(FIRST_USER_ID), rosterUser(SECOND_USER_ID)],
    },
    groups: [],
    memberGroupId: "members-group-id",
    readModelCursor: "cursor-1",
  };
}

test("one registered profile document resolves every current roster binding", async () => {
  const runtimeBase = await createSqlRuntimeBase(
    "explorer-attribution-profile-registry-test",
  );
  const { close, ...runtimeInput } = runtimeBase;
  const documents = createDocumentsWorkflowRuntime({
    ...runtimeInput,
    apiClient: createMockApiClient(),
    infra: {
      ...runtimeInput.infra,
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
    },
    state: {
      ...runtimeInput.state,
      containerId: "roster-profile-container-id",
    },
  });

  try {
    const firstStore = openDocumentStore(
      documents.state.domainScope,
      getRosterProfileDocumentLocalId({
        organizationId: ORGANIZATION_ID,
        userId: FIRST_USER_ID,
      }),
      documents,
      PROFILE_DOCUMENT_ID,
      "",
      "contact",
    );
    const secondStore = openDocumentStore(
      documents.state.domainScope,
      getRosterProfileDocumentLocalId({
        organizationId: ORGANIZATION_ID,
        userId: SECOND_USER_ID,
      }),
      documents,
      PROFILE_DOCUMENT_ID,
      "",
      "contact",
    );
    expect(secondStore).toBe(firstStore);

    await firstStore.setStructuredFields("contact", {
      firstName: "Ada",
      lastName: "Lovelace",
    });
    const persistedDocuments =
      await defaultDocumentsPersistence.listDocumentSummaries(
        documents.infra.execSql,
      );
    expect(persistedDocuments.rows).toHaveLength(1);

    const bindings = getRosterProfileBindingsByLocalId({
      organizationId: ORGANIZATION_ID,
      users: projection().directory.users,
    });
    expect(
      getLocalRosterProfileDisplayNames({
        documents: persistedDocuments,
        profileBindingsByLocalId: bindings,
      }),
    ).toEqual(
      new Map([
        [FIRST_USER_ID, "Ada Lovelace"],
        [SECOND_USER_ID, "Ada Lovelace"],
      ]),
    );

    const [hydratedProfile] = persistedDocuments.rows;
    expect(hydratedProfile).toBeDefined();
    if (!hydratedProfile) return;
    expect(
      getLocalRosterProfileDisplayNames({
        documents: {
          rows: [
            { ...hydratedProfile, updatedAt: "2026-08-25T12:00:00.000Z" },
            {
              ...hydratedProfile,
              id: `${hydratedProfile.id}-newer-shell`,
              title: "Untitled contact",
              updatedAt: "2026-08-25T13:00:00.000Z",
            },
          ],
          totalCount: 2,
        },
        profileBindingsByLocalId: bindings,
      }),
    ).toEqual(
      new Map([
        [FIRST_USER_ID, "Ada Lovelace"],
        [SECOND_USER_ID, "Ada Lovelace"],
      ]),
    );
    expect(
      getLocalRosterProfileDisplayNames({
        documents: {
          rows: [
            { ...hydratedProfile, title: "Untitled contact" },
            {
              ...hydratedProfile,
              id: `${hydratedProfile.id}-stale-duplicate`,
              title: "Stale duplicate",
              updatedAt: "2099-01-01T00:00:00.000Z",
            },
          ],
          totalCount: 2,
        },
        profileBindingsByLocalId: bindings,
      }),
    ).toEqual(new Map());
  } finally {
    close();
  }
});
