import { expect, test } from "bun:test";
import {
  defaultDocumentsPersistence,
  getRosterProfileDocumentLocalId,
  type OrganizationDirectoryAndGroups,
  SymCrypt,
} from "@symcrypt/client-sdk";
import { createTestExecSql } from "@symcrypt/test-utils";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../../document-types/projectors";
import { getLocalRosterProfileDisplayNames } from "../../../stores/org-manager/rosterProfileDisplayNames";
import {
  getExplorerAttributionProfileBindingsByLocalId,
  getExplorerAttributionProfileDocumentLocalId,
  hydrateExplorerAttributionProfileDocument,
} from "../hooks/explorerAttributionReadModel";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_USER_ID = "00000000-0000-4000-8000-000000000002";
const PROFILE_DOCUMENT_ID = "00000000-0000-4000-8000-000000000003";
const PROFILE_CONTAINER_ID = "00000000-0000-4000-8000-000000000004";

function attributionProjection(): OrganizationDirectoryAndGroups {
  return {
    directory: {
      currentUser: { isOrgAdmin: true },
      organizationId: ORGANIZATION_ID,
      profileDocumentId: null,
      users: [
        {
          createdAt: "2026-08-25T12:00:00.000Z",
          disabledAt: "2026-08-25T13:00:00.000Z",
          disabledByUserId: "admin-user-id",
          encapsulationKeyFingerprint: "encapsulation-fingerprint",
          encapsulationPublicKey: "encapsulation-public-key",
          isSelf: false,
          joinedAt: "2026-08-25T12:00:00.000Z",
          profileDocumentId: PROFILE_DOCUMENT_ID,
          signingKeyFingerprint: "signing-fingerprint",
          signingPublicKey: "signing-public-key",
          status: "disabled",
          updatedAt: "2026-08-25T13:00:00.000Z",
          userId: PROFILE_USER_ID,
        },
      ],
    },
    groups: [],
    memberGroupId: "members-group-id",
    readModelCursor: "cursor-1",
  };
}

test("restart hydration adopts the canonical profile row and its pending edits", async () => {
  const database = await createTestExecSql("attribution-profile-restart");
  const canonicalLocalId = getRosterProfileDocumentLocalId({
    organizationId: ORGANIZATION_ID,
    userId: PROFILE_USER_ID,
  });
  const staleSyntheticLocalId = getExplorerAttributionProfileDocumentLocalId({
    organizationId: ORGANIZATION_ID,
    profileDocumentId: PROFILE_DOCUMENT_ID,
    userId: PROFILE_USER_ID,
  });
  const firstSdk = new SymCrypt({
    database: { execSql: database.execSql, id: "profile-restart-db" },
    documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  });
  let restartedSdk: SymCrypt | null = null;

  try {
    const editor = firstSdk.documents.open({
      containerId: PROFILE_CONTAINER_ID,
      documentId: PROFILE_DOCUMENT_ID,
      initialDocumentKind: "contact",
      localId: canonicalLocalId,
    });
    await editor.setStructuredFields("contact", {
      firstName: "Grace",
      lastName: "Hopper",
    });
    expect(
      await defaultDocumentsPersistence.listPendingUpdates(
        database.execSql,
        canonicalLocalId,
      ),
    ).not.toHaveLength(0);
    firstSdk.dispose();
    await defaultDocumentsPersistence.saveDocument(
      database.execSql,
      {
        accessEpoch: 1,
        containerId: PROFILE_CONTAINER_ID,
        documentId: PROFILE_DOCUMENT_ID,
        documentKind: "contact",
        id: staleSyntheticLocalId,
        snapshotEndVersion: "",
        text: "Stale synthetic profile",
      },
      { updatedAt: "2099-01-01T00:00:00.000Z" },
    );

    restartedSdk = new SymCrypt({
      database: { execSql: database.execSql, id: "profile-restart-db" },
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
    });
    expect(
      await restartedSdk.documents.findLocalIdByDocumentId(PROFILE_DOCUMENT_ID),
    ).toBe(canonicalLocalId);
    await hydrateExplorerAttributionProfileDocument({
      containerId: PROFILE_CONTAINER_ID,
      documents: restartedSdk.documents,
      organizationId: ORGANIZATION_ID,
      target: {
        bindingKey: `${PROFILE_USER_ID}\0${PROFILE_DOCUMENT_ID}`,
        profileDocumentId: PROFILE_DOCUMENT_ID,
        userId: PROFILE_USER_ID,
      },
    });

    const reopenedEditor = restartedSdk.documents.open({
      containerId: PROFILE_CONTAINER_ID,
      documentId: PROFILE_DOCUMENT_ID,
      initialDocumentKind: "contact",
      localId: canonicalLocalId,
    });
    expect(await reopenedEditor.ensureInitialized()).toBe(true);
    expect(reopenedEditor.getSnapshot().structuredFields).toMatchObject({
      firstName: "Grace",
      lastName: "Hopper",
    });
    expect(
      await defaultDocumentsPersistence.listPendingUpdates(
        database.execSql,
        canonicalLocalId,
      ),
    ).not.toHaveLength(0);
    const profileDocuments =
      await defaultDocumentsPersistence.listDocumentSummaries(database.execSql);
    expect(
      profileDocuments.rows.map(({ id, title }) => ({ id, title })),
    ).toContainEqual({ id: canonicalLocalId, title: "Grace Hopper" });
    expect(
      getLocalRosterProfileDisplayNames({
        documents: profileDocuments,
        profileBindingsByLocalId:
          getExplorerAttributionProfileBindingsByLocalId({
            directoryAndGroups: attributionProjection(),
            organizationId: ORGANIZATION_ID,
          }),
      }).get(PROFILE_USER_ID),
    ).toBe("Grace Hopper");
  } finally {
    firstSdk.dispose();
    restartedSdk?.dispose();
    database.close();
  }
});
