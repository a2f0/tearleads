import { expect, test } from "bun:test";
import {
  compareCanonicalStrings,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { execSqlClientFromExecSql } from "../../../test/helpers/data/execSqlClient";
import { respondToRegistration } from "../../../test/helpers/data/organizationProvisioningResponder";
import { CONTAINER_METADATA_APP_KIND } from "../../data/persistence/container-contents/dormantContainerMetadata";
import { type RegistrationApi, registerIdentity } from "./registerIdentity";

test("every container metadata seed registration commits keeps the cursor it stands for", async () => {
  const { execSql, close } = await createTestExecSql(
    "registration-seed-cursor",
  );
  try {
    const seeds: { documentId: string; updateId: string }[] = [];
    const response = await registerIdentity({
      identityTrustDomain: "https://api.example.test",
      apiClient: {
        registerUser: async (
          ...args: Parameters<RegistrationApi["registerUser"]>
        ) => {
          const acknowledged = await respondToRegistration(args);
          const [, , , , , , , , , root, roster, , metadata, , system] = args;
          for (const [documentId, sync] of [
            [acknowledged.rootMetadataDocumentId, root.initialSync],
            [
              acknowledged.rosterProfileContainer?.metadataDocument.id,
              roster?.initialMetadataSync,
            ],
            [
              acknowledged.organizationMetadataContainer.metadataDocument.id,
              metadata.initialMetadataSync,
            ],
            ...(system ?? []).map(
              (request, index) =>
                [
                  acknowledged.systemContainers[index]?.metadataDocument.id,
                  request.initialMetadataSync,
                ] as const,
            ),
          ] as const) {
            const updateId = sync?.outgoingUpdates[0]?.id;
            if (documentId === undefined || updateId === undefined) continue;
            seeds.push({ documentId, updateId });
          }
          return acknowledged;
        },
      },
      containerId: crypto.randomUUID(),
      dbClient: execSqlClientFromExecSql(execSql),
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
      pinLocalUserIdentity: async () => undefined,
      provisionedSystemContainers: [
        {
          icon: "trash",
          name: "Trash",
          slotNamespace: "tearleads.organization-trash",
        },
      ],
      signingKeyPair: generateSigningSeedAndKeyPair(),
    });
    if (!response) throw new Error("Expected acknowledged registration");
    // Root, roster profile, organization metadata and Trash.
    expect(seeds).toHaveLength(4);

    const rows = await execSql(
      `SELECT d.document_id AS "documentId",
          p.through_update_count AS "count",
          p.through_update_id AS "updateId"
       FROM documents d
       LEFT JOIN document_sync_progress p
         ON p.app_kind = d.app_kind AND p.local_id = d.local_id
       WHERE d.app_kind = ?`,
      [CONTAINER_METADATA_APP_KIND],
    );
    // A listing that counts a seed owes this device no read of its own update.
    const byDocument = (left: unknown, right: unknown) =>
      compareCanonicalStrings(
        String(Reflect.get(Object(left), "documentId")),
        String(Reflect.get(Object(right), "documentId")),
      );
    expect(rows.toSorted(byDocument)).toEqual(
      seeds
        .map(({ documentId, updateId }) => ({ count: 1, documentId, updateId }))
        .toSorted(byDocument),
    );
  } finally {
    close();
  }
});
