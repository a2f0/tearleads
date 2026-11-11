import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
} from "@tearleads/loro";
import { organizationAdoptionFixture } from "../../../../test/helpers/organizationAdoption";
import {
  initializeStoredDocumentKind,
  readStoredDocumentState,
  writeStoredDocumentFields,
} from "../../../data/documents/documentKinds";
import { createPendingUpdateFields } from "../../../data/documents/documentSync";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { loadPersistedDocumentContent } from "../../documents/historyContent";
import { persistDocumentState } from "../../documents/persistence";
import {
  getOrganizationProfileDocumentLocalId,
  ORGANIZATION_PROFILE_DOCUMENT_KIND,
} from "../organizationProfile";
import {
  getRosterProfileDocumentLocalId,
  ROSTER_PROFILE_DOCUMENT_KIND,
} from "../rosterProfileContainer";

test("ordinary adoption preserves edited profiles, history, access and queued writes", async () => {
  const fixture = await organizationAdoptionFixture();
  const { execSql, request, response } = fixture;
  try {
    const profiles = [
      {
        id: getOrganizationProfileDocumentLocalId(request),
        documentId: response.organizationProfileDocumentId,
        containerId: response.organizationMetadataContainerId,
        kind: ORGANIZATION_PROFILE_DOCUMENT_KIND,
        field: "name",
      },
      {
        id: getRosterProfileDocumentLocalId(request),
        documentId: response.rosterProfileDocumentId,
        containerId: response.rosterProfileContainerId,
        kind: ROSTER_PROFILE_DOCUMENT_KIND,
        field: "nickname",
      },
    ];
    await sqlDocumentsPersistence.ensureSchema(execSql);
    for (const profile of profiles) {
      if (!profile.documentId || !profile.containerId)
        throw new Error("Missing profile response");
      const doc = await createDocument(profile.id);
      initializeStoredDocumentKind(doc, profile.kind);
      writeStoredDocumentFields(doc, profile.kind, {
        [profile.field]: "Later local edit",
      });
      await persistDocumentState({
        currentDoc: doc,
        currentRecord: null,
        documentProjectors: [],
        execSql,
        localId: profile.id,
        patch: {
          accessEpoch: 1,
          documentId: profile.documentId,
          documentKind: profile.kind,
          containerId: profile.containerId,
          effectiveAccessLevel: "read",
          lastCommitLsn: "42",
          snapshotEndVersion: encodeVersionVector(doc),
        },
        pendingUpdate:
          createPendingUpdateFields(exportAllUpdates(doc)) ?? undefined,
        persistence: sqlDocumentsPersistence,
      });
    }
    const before = await Promise.all(
      profiles.map((profile) =>
        sqlDocumentsPersistence.loadDocumentStoreState(execSql, profile.id),
      ),
    );
    expect(await fixture.retry()).toEqual(response);
    const after = await Promise.all(
      profiles.map((profile) =>
        sqlDocumentsPersistence.loadDocumentStoreState(execSql, profile.id),
      ),
    );
    expect(after).toEqual(before);
    for (const profile of profiles) {
      const content = await loadPersistedDocumentContent({
        execSql,
        localId: profile.id,
        persistence: sqlDocumentsPersistence,
      });
      if (!content) throw new Error("Missing preserved profile");
      expect(
        readStoredDocumentState(content).structuredFields[profile.field],
      ).toBe("Later local edit");
      expect(
        await sqlDocumentsPersistence.listPendingUpdates(execSql, profile.id),
      ).toHaveLength(1);
    }
    expect(
      await execSql(
        "SELECT organization_id FROM organization_provisioning_attempts",
      ),
    ).toEqual([]);
  } finally {
    fixture.close();
  }
});
