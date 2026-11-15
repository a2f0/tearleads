import { expect, test } from "bun:test";
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

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const CONTAINER_ID = "00000000-0000-4000-8000-000000000003";
const IDENTITY = {
  encapsulationPublicKey: "profile-discovery-test-key",
  userId: USER_ID,
};

const profiles = [
  {
    label: "roster",
    documentKind: "contact",
    localId: getRosterProfileDocumentLocalId({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
    }),
    fields: {
      ...IDENTITY,
      firstName: "Ada",
      isSelf: "0",
    },
    create: (documents: Documents) =>
      createRosterProfileDocument({
        containerId: CONTAINER_ID,
        documents,
        identity: IDENTITY,
        isSelf: false,
        names: { firstName: "Replacement seed" },
        organizationId: ORGANIZATION_ID,
      }),
  },
  {
    label: "organization",
    documentKind: ORGANIZATION_PROFILE_DOCUMENT_KIND,
    localId: getOrganizationProfileDocumentLocalId({
      organizationId: ORGANIZATION_ID,
    }),
    fields: { name: "Existing organization" },
    create: (documents: Documents) =>
      createOrganizationProfileDocument({
        containerId: CONTAINER_ID,
        documents,
        name: "Replacement seed",
        organizationId: ORGANIZATION_ID,
      }),
  },
];

for (const profile of profiles) {
  for (const discoveredFirst of [false, true]) {
    const storage = discoveredFirst
      ? "discovered remote id"
      : "preferred local id";
    test(`${profile.label} creation reuses a persisted profile under its ${storage}`, async () => {
      const database = await createTestExecSql(
        `profile-${profile.label}-${storage}`,
      );
      const config = {
        database: { execSql: database.execSql, id: "profile-discovery-db" },
        documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
      };
      const firstSdk = new Tearleads(config);
      let restartedSdk: Tearleads | null = null;
      try {
        const documentId = await deriveStableDocumentId(profile.localId);
        const existingLocalId = discoveredFirst ? documentId : profile.localId;
        await defaultDocumentsPersistence.ensureSchema(database.execSql);
        if (discoveredFirst) {
          const discovered =
            await defaultDocumentsPersistence.upsertDiscoveredDocument(
              database.execSql,
              {
                accessEpoch: 1,
                containerId: CONTAINER_ID,
                createdAt: "2026-11-01T00:00:00.000Z",
                documentId,
                effectiveAccessLevel: "write",
                linkedContainerIds: [CONTAINER_ID],
              },
            );
          expect(discovered.id).toBe(documentId);
        }
        // Materialize real local history after discovery. This tests the local
        // persistence/creation seam, not authenticated remote hydration.
        const backing = firstSdk.documents.open({
          containerId: CONTAINER_ID,
          documentId,
          initialDocumentKind: profile.documentKind,
          initialStructuredFields: profile.fields,
          localId: existingLocalId,
        });
        await backing.setStructuredFields(
          profile.documentKind,
          profile.fields,
          {
            deferRemoteSync: true,
          },
        );
        expect(await backing.ensureInitialized()).toBe(true);
        expect(backing.getSnapshot().structuredFields).toMatchObject(
          profile.fields,
        );
        const before = await defaultDocumentsPersistence.loadDocument(
          database.execSql,
          existingLocalId,
        );
        expect(before?.documentId).toBe(documentId);
        firstSdk.dispose();

        restartedSdk = new Tearleads(config);
        expect(
          await restartedSdk.documents.findLocalIdByDocumentId(documentId),
        ).toBe(existingLocalId);
        const result = await profile.create(restartedSdk.documents);
        // Query backing records, not the product's document-list projection.
        const after = await defaultDocumentsPersistence.loadDocument(
          database.execSql,
          existingLocalId,
        );
        expect(after?.documentId).toBe(documentId);
        expect(
          await defaultDocumentsPersistence.loadDocument(
            database.execSql,
            discoveredFirst ? profile.localId : documentId,
          ),
        ).toBeNull();
        expect(after).toEqual(before);
        const reopened = restartedSdk.documents.open({
          containerId: CONTAINER_ID,
          documentId,
          initialDocumentKind: profile.documentKind,
          localId: existingLocalId,
        });
        expect(await reopened.ensureInitialized()).toBe(true);
        expect(reopened.getSnapshot().structuredFields).toMatchObject(
          profile.fields,
        );
        expect(
          result,
          "an existing readable profile must not be refused as a new birth",
        ).toBe(documentId);
      } finally {
        firstSdk.dispose();
        restartedSdk?.dispose();
        database.close();
      }
    });
  }
}
