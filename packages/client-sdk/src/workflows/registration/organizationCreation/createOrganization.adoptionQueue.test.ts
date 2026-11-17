import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { organizationAdoptionFixture } from "../../../../test/helpers/organizationAdoption";
import { createPendingUpdateFields } from "../../../data/documents/documentSync";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { createInitializedContainerMetadataDocument } from "../../container-contents/metadata/containerMetadataDocument";
import { createOrganization } from "./createOrganization";

test("adoption keeps edited container queues and seeds only missing metadata", async () => {
  const fixture = await organizationAdoptionFixture();
  try {
    const { response, execSql } = fixture;
    const roster = response.rosterProfileContainer;
    if (!roster) throw new Error("Expected roster profile container");
    const retained = [
      {
        id: response.rootContainerId,
        documentId: response.rootMetadataDocumentId,
      },
      {
        id: roster.container.containerId,
        documentId: roster.metadataDocument.id,
      },
    ];
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    for (const container of retained) {
      const metadata = await createInitializedContainerMetadataDocument(
        container.id,
        { name: "Edited after discovery", icon: "star" },
      );
      await sqlContainerContentsPersistence.saveContainer(
        execSql,
        {
          id: container.id,
          organizationId: response.organizationId,
          metadataDocumentId: container.documentId,
          parentId: null,
          name: "Edited after discovery",
          icon: "star",
          effectiveAccessLevel: "read",
        },
        {
          id: container.id,
          documentId: container.documentId,
          accessEpoch: 1,
          metadataUpdates: bytesToBase64(metadata.initialUpdate),
          snapshotEndVersion: "",
          lastCommitLsn: "42",
        },
      );
      const update = createPendingUpdateFields(metadata.initialUpdate);
      if (!update) throw new Error("Expected pending metadata edit");
      await sqlContainerContentsPersistence.enqueuePendingUpdate(execSql, {
        containerId: container.id,
        ...update,
      });
    }
    const before = await Promise.all(
      retained.map(async ({ id }) => ({
        stored:
          await sqlContainerContentsPersistence.loadContainerMetadataState(
            execSql,
            id,
          ),
        pending: await sqlContainerContentsPersistence.listPendingUpdates(
          execSql,
          id,
        ),
      })),
    );
    const acknowledgement = { ...response, committedCoreMetadataUpdateIds: [] };
    expect(
      await createOrganization({
        ...fixture.input,
        apiClient: { createOrganization: async () => acknowledgement },
      }),
    ).toEqual(acknowledgement);
    for (const [index, { id }] of retained.entries()) {
      const original = before[index];
      if (!original) throw new Error("Expected retained container state");
      expect(
        await sqlContainerContentsPersistence.loadContainerMetadataState(
          execSql,
          id,
        ),
      ).toEqual(original.stored);
      expect(
        await sqlContainerContentsPersistence.listPendingUpdates(execSql, id),
      ).toEqual(original.pending);
    }
    // An absent sibling still receives its bootstrap and unacknowledged update.
    const missingId =
      response.organizationMetadataContainer.container.containerId;
    expect(
      (
        await sqlContainerContentsPersistence.loadContainerMetadataState(
          execSql,
          missingId,
        )
      )?.record?.documentId,
    ).toBe(response.organizationMetadataContainer.metadataDocument.id);
    expect(
      await sqlContainerContentsPersistence.listPendingUpdates(
        execSql,
        missingId,
      ),
    ).toHaveLength(1);
    expect(
      await execSql(
        "SELECT organization_id FROM organization_provisioning_attempts",
      ),
    ).toEqual([]);
  } finally {
    fixture.close();
  }
});
