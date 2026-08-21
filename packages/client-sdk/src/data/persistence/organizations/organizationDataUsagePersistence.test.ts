import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { OrganizationDataUsageResponse } from "@symcrypt/validators/response";
import { and, eq } from "drizzle-orm";
import {
  organizationDataUsageCategories,
  organizationDataUsageSnapshots,
  organizationDataUsageTables,
} from "../../sqlite/organizationDataUsageSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../sqlite/sqlTableSchema";
import {
  loadOrganizationDataUsageProjection,
  purgeOrganizationDataUsageProjection,
  saveOrganizationDataUsageProjection,
} from "./organizationDataUsagePersistence";

const ORGANIZATION_ID = "organization-usage-1";
const REQUESTER_1 = "requester-1";
const REQUESTER_2 = "requester-2";

function usage(
  organizationId = ORGANIZATION_ID,
  extraUserBytes = 0,
): OrganizationDataUsageResponse {
  const breakdown = [
    {
      byteLength: 10,
      category: "containerMetadata" as const,
      documentCount: 1,
      updateCount: 2,
    },
    {
      byteLength: 20,
      category: "rosterProfiles" as const,
      documentCount: 2,
      updateCount: 3,
    },
    {
      byteLength: 30,
      category: "organizationMetadata" as const,
      documentCount: 3,
      updateCount: 4,
    },
    {
      byteLength: 40 + extraUserBytes,
      category: "user" as const,
      documentCount: 4,
      updateCount: 5,
    },
  ];
  const documentByteLength = 100 + extraUserBytes;
  return {
    organizationId,
    blobs: { blobCount: 5, byteLength: 50 },
    documents: {
      breakdown,
      byteLength: documentByteLength,
      documentCount: 10,
      updateCount: 14,
    },
    totalByteLength: documentByteLength + 50,
  };
}

test("usage projections round-trip, replace, and remain requester scoped", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-data-usage-round-trip",
  );
  try {
    const first = usage();
    const secondRequester = usage(ORGANIZATION_ID, 25);
    await saveOrganizationDataUsageProjection({
      execSql,
      requesterUserId: REQUESTER_1,
      response: first,
    });
    await saveOrganizationDataUsageProjection({
      execSql,
      requesterUserId: REQUESTER_2,
      response: secondRequester,
    });

    await expect(
      loadOrganizationDataUsageProjection(
        execSql,
        ORGANIZATION_ID,
        REQUESTER_1,
      ),
    ).resolves.toEqual(first);
    await expect(
      loadOrganizationDataUsageProjection(
        execSql,
        ORGANIZATION_ID,
        REQUESTER_2,
      ),
    ).resolves.toEqual(secondRequester);

    const replacement = usage(ORGANIZATION_ID, 75);
    await saveOrganizationDataUsageProjection({
      execSql,
      requesterUserId: REQUESTER_1,
      response: replacement,
    });
    await expect(
      loadOrganizationDataUsageProjection(
        execSql,
        ORGANIZATION_ID,
        REQUESTER_1,
      ),
    ).resolves.toEqual(replacement);
    await expect(
      loadOrganizationDataUsageProjection(
        execSql,
        ORGANIZATION_ID,
        REQUESTER_2,
      ),
    ).resolves.toEqual(secondRequester);

    await purgeOrganizationDataUsageProjection(
      execSql,
      ORGANIZATION_ID,
      REQUESTER_1,
    );
    await expect(
      loadOrganizationDataUsageProjection(
        execSql,
        ORGANIZATION_ID,
        REQUESTER_1,
      ),
    ).resolves.toBeNull();
    await expect(
      loadOrganizationDataUsageProjection(
        execSql,
        ORGANIZATION_ID,
        REQUESTER_2,
      ),
    ).resolves.toEqual(secondRequester);

    await purgeOrganizationDataUsageProjection(execSql, ORGANIZATION_ID);
    await expect(
      loadOrganizationDataUsageProjection(
        execSql,
        ORGANIZATION_ID,
        REQUESTER_2,
      ),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("invalid usage responses never replace a valid projection", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-data-usage-invalid-save",
  );
  const valid = usage();
  try {
    await saveOrganizationDataUsageProjection({
      execSql,
      requesterUserId: REQUESTER_1,
      response: valid,
    });
    await expect(
      saveOrganizationDataUsageProjection({
        execSql,
        requesterUserId: REQUESTER_1,
        response: { ...valid, totalByteLength: valid.totalByteLength + 1 },
      }),
    ).rejects.toThrow("Organization data usage response is invalid");
    await expect(
      saveOrganizationDataUsageProjection({
        execSql,
        requesterUserId: REQUESTER_1,
        response: {
          ...valid,
          documents: {
            ...valid.documents,
            breakdown: [
              ...valid.documents.breakdown.slice(0, 3),
              valid.documents.breakdown[0],
            ].filter((entry) => entry !== undefined),
          },
        },
      }),
    ).rejects.toThrow("Organization data usage response is invalid");
    await expect(
      loadOrganizationDataUsageProjection(
        execSql,
        ORGANIZATION_ID,
        REQUESTER_1,
      ),
    ).resolves.toEqual(valid);
  } finally {
    close();
  }
});

test("invalid stored usage is purged without affecting another requester", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-data-usage-corrupt-load",
  );
  try {
    await Promise.all(
      [REQUESTER_1, REQUESTER_2].map((requesterUserId) =>
        saveOrganizationDataUsageProjection({
          execSql,
          requesterUserId,
          response: usage(),
        }),
      ),
    );
    await ensureSqlTables(execSql, organizationDataUsageTables);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    await db
      .update(organizationDataUsageSnapshots)
      .set({ projectionVersion: 2 })
      .where(
        and(
          eq(organizationDataUsageSnapshots.organizationId, ORGANIZATION_ID),
          eq(organizationDataUsageSnapshots.requesterUserId, REQUESTER_1),
        ),
      );

    await expect(
      loadOrganizationDataUsageProjection(
        execSql,
        ORGANIZATION_ID,
        REQUESTER_1,
      ),
    ).resolves.toBeNull();
    await expect(
      loadOrganizationDataUsageProjection(
        execSql,
        ORGANIZATION_ID,
        REQUESTER_2,
      ),
    ).resolves.toEqual(usage());
    expect(
      await db
        .select()
        .from(organizationDataUsageCategories)
        .where(
          eq(organizationDataUsageCategories.requesterUserId, REQUESTER_1),
        ),
    ).toEqual([]);

    await saveOrganizationDataUsageProjection({
      execSql,
      requesterUserId: REQUESTER_1,
      response: usage(),
    });
    await db
      .delete(organizationDataUsageCategories)
      .where(
        and(
          eq(organizationDataUsageCategories.organizationId, ORGANIZATION_ID),
          eq(organizationDataUsageCategories.requesterUserId, REQUESTER_1),
          eq(organizationDataUsageCategories.category, "user"),
        ),
      );
    await expect(
      loadOrganizationDataUsageProjection(
        execSql,
        ORGANIZATION_ID,
        REQUESTER_1,
      ),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});
