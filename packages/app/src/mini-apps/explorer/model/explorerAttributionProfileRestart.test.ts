import { expect, test } from "bun:test";
import {
  defaultDocumentsPersistence,
  getRosterProfileDocumentLocalId,
  SymCrypt,
} from "@symcrypt/client-sdk";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  getExplorerAttributionProfileDocumentLocalId,
  hydrateExplorerAttributionProfileDocument,
} from "../hooks/explorerAttributionReadModel";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_USER_ID = "00000000-0000-4000-8000-000000000002";
const PROFILE_DOCUMENT_ID = "00000000-0000-4000-8000-000000000003";
const PROFILE_CONTAINER_ID = "00000000-0000-4000-8000-000000000004";

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
  } finally {
    firstSdk.dispose();
    restartedSdk?.dispose();
    database.close();
  }
});
