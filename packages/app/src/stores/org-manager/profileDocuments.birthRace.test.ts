import { expect, spyOn, test } from "bun:test";
import {
  type Documents,
  defaultDocumentsPersistence,
  deriveStableDocumentId,
  getOrganizationProfileDocumentLocalId,
  getRosterProfileDocumentLocalId,
  ORGANIZATION_PROFILE_DOCUMENT_KIND,
  Tearleads,
} from "@tearleads/client-sdk";
import { createTestExecSql } from "@tearleads/test-utils";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../document-types/projectors";
import {
  createOrganizationProfileDocument,
  createRosterProfileDocument,
} from "./profileDocuments";

const organizationId = "00000000-0000-4000-8000-000000000011";
const userId = "00000000-0000-4000-8000-000000000012";
const containerId = "00000000-0000-4000-8000-000000000013";
const profiles = [
  {
    kind: "contact",
    localId: getRosterProfileDocumentLocalId({ organizationId, userId }),
    fields: { firstName: "Discovered winner", userId },
    create: (documents: Documents) =>
      createRosterProfileDocument({
        containerId,
        documents,
        organizationId,
        identity: { userId, encapsulationPublicKey: "birth-race-key" },
        isSelf: false,
        names: { firstName: "Losing birth seed" },
      }),
  },
  {
    kind: ORGANIZATION_PROFILE_DOCUMENT_KIND,
    localId: getOrganizationProfileDocumentLocalId({ organizationId }),
    fields: { name: "Discovered winner" },
    create: (documents: Documents) =>
      createOrganizationProfileDocument({
        containerId,
        documents,
        organizationId,
        name: "Losing birth seed",
      }),
  },
];

for (const profile of profiles) {
  test(`${profile.kind} factory re-resolves discovery that wins just before atomic birth`, async () => {
    const database = await createTestExecSql("profile-birth-race");
    const sdk = new Tearleads({
      database: { execSql: database.execSql, id: "profile-birth-race" },
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
    });
    sdk.network.setOnline(false);
    const documentId = await deriveStableDocumentId(profile.localId);
    const originalBirth =
      defaultDocumentsPersistence.createDocumentWithHistoryCheckpoint;
    const originalLoad = defaultDocumentsPersistence.loadDocumentStoreState;
    const birthResults: Awaited<ReturnType<typeof originalBirth>>[] = [];
    let before: Awaited<
      ReturnType<typeof defaultDocumentsPersistence.loadDocument>
    > = null;
    let intercepted = false;
    const birth = spyOn(
      defaultDocumentsPersistence,
      "createDocumentWithHistoryCheckpoint",
    ).mockImplementation(async (...args) => {
      const result = await originalBirth(...args);
      if (args[1].id === profile.localId) birthResults.push(result);
      return result;
    });
    const load = spyOn(
      defaultDocumentsPersistence,
      "loadDocumentStoreState",
    ).mockImplementation(async (...args) => {
      const state = await originalLoad(...args);
      if (!intercepted && args[1] === profile.localId) {
        intercepted = true;
        expect(state.document).toBeNull();
        // Return the actual startup miss only after discovery materializes.
        // This is before the outer SQL mutation lock: awaiting discovery from
        // inside the birth port would deadlock behind that already-held lock.
        const discovered =
          await defaultDocumentsPersistence.upsertDiscoveredDocument(
            database.execSql,
            {
              accessEpoch: 1,
              containerId,
              createdAt: "2026-11-01T00:00:00.000Z",
              documentId,
              effectiveAccessLevel: "write",
              linkedContainerIds: [containerId],
            },
          );
        expect(discovered.id).toBe(documentId);
        const winner = sdk.documents.open({
          containerId,
          documentId,
          localId: documentId,
          initialDocumentKind: profile.kind,
        });
        expect(await winner.ensureInitialized()).toBe(true);
        await winner.setStructuredFields(profile.kind, profile.fields, {
          deferRemoteSync: true,
        });
        before = await defaultDocumentsPersistence.loadDocument(
          database.execSql,
          documentId,
        );
      }
      return state;
    });
    try {
      const result = await profile.create(sdk.documents);
      expect(intercepted).toBe(true);
      expect(birthResults).toEqual([
        { status: "remote-alias", documentId, localId: documentId },
      ]);
      expect(before).not.toBeNull();
      expect(result).toBe(documentId);
      expect(
        await defaultDocumentsPersistence.loadDocument(
          database.execSql,
          profile.localId,
        ),
      ).toBeNull();
      expect(
        await defaultDocumentsPersistence.loadDocument(
          database.execSql,
          documentId,
        ),
      ).toEqual(before);
      const reopened = sdk.documents.open({
        containerId,
        documentId,
        localId: documentId,
      });
      expect(await reopened.ensureInitialized()).toBe(true);
      expect(reopened.getSnapshot().structuredFields).toMatchObject(
        profile.fields,
      );
    } finally {
      load.mockRestore();
      birth.mockRestore();
      sdk.dispose();
      database.close();
    }
  });
}
