import { expect, test } from "bun:test";
import {
  compareCanonicalStrings,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { LEGAL_TERMS_VERSION } from "@tearleads/validators/legalTerms";
import { execSqlClientFromExecSql } from "../../../test/helpers/data/execSqlClient";
import { respondToRegistration } from "../../../test/helpers/data/organizationProvisioningResponder";
import { CONTAINER_METADATA_APP_KIND } from "../../data/persistence/container-contents/dormantContainerMetadata";
import { DOCUMENTS_APP_KIND } from "../../data/persistence/documents/documentsPersistence";
import { type RegistrationApi, registerIdentity } from "./registerIdentity";

interface Seed {
  readonly documentId: string;
  readonly updateId: string;
}

/**
 * Registers an identity, then compares the cursors its `appKind` records
 * keep with the seeds provisioning committed for them.
 */
async function expectCommittedSeedCursors(
  appKind: string,
  expectedSeeds: number,
) {
  const { execSql, close } = await createTestExecSql(
    `registration-seed-cursor-${crypto.randomUUID()}`,
  );
  try {
    const seeds: Record<string, Seed[]> = {
      [CONTAINER_METADATA_APP_KIND]: [],
      [DOCUMENTS_APP_KIND]: [],
    };
    const collect = (
      kind: string,
      documentId: string | undefined,
      updateId: string | undefined,
    ) => {
      if (documentId === undefined || updateId === undefined) return;
      seeds[kind]?.push({ documentId, updateId });
    };
    const response = await registerIdentity({
      acceptedLegalTermsVersion: LEGAL_TERMS_VERSION,
      identityTrustDomain: "https://api.example.test",
      apiClient: {
        registerUser: async (
          ...args: Parameters<RegistrationApi["registerUser"]>
        ) => {
          const acknowledged = await respondToRegistration(args);
          const [
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            root,
            roster,
            rosterProfile,
            metadata,
            organizationProfile,
            system,
          ] = args;
          collect(
            DOCUMENTS_APP_KIND,
            acknowledged.rosterProfileDocument?.id,
            rosterProfile?.initialSync.outgoingUpdates[0]?.id,
          );
          collect(
            DOCUMENTS_APP_KIND,
            acknowledged.organizationProfileDocument?.id,
            organizationProfile?.initialSync.outgoingUpdates[0]?.id,
          );
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
            collect(
              CONTAINER_METADATA_APP_KIND,
              documentId,
              sync?.outgoingUpdates[0]?.id,
            );
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
    const committed = seeds[appKind] ?? [];
    expect(committed).toHaveLength(expectedSeeds);

    const rows = await execSql(
      `SELECT d.document_id AS "documentId",
          p.through_update_count AS "count",
          p.through_update_id AS "updateId"
       FROM documents d
       LEFT JOIN document_sync_progress p
         ON p.app_kind = d.app_kind AND p.local_id = d.local_id
       WHERE d.app_kind = ?`,
      [appKind],
    );
    // A listing that counts a seed owes this device no read of its own update.
    const byDocument = (left: unknown, right: unknown) =>
      compareCanonicalStrings(
        String(Reflect.get(Object(left), "documentId")),
        String(Reflect.get(Object(right), "documentId")),
      );
    expect(rows.toSorted(byDocument)).toEqual(
      committed
        .map(({ documentId, updateId }) => ({ count: 1, documentId, updateId }))
        .toSorted(byDocument),
    );
  } finally {
    close();
  }
}

test("every container metadata seed registration commits keeps the cursor it stands for", async () => {
  // Root, roster profile, organization metadata and Trash.
  await expectCommittedSeedCursors(CONTAINER_METADATA_APP_KIND, 4);
});

test("every profile document seed registration commits keeps the cursor it stands for", async () => {
  // The roster profile and the organization profile.
  await expectCommittedSeedCursors(DOCUMENTS_APP_KIND, 2);
});
