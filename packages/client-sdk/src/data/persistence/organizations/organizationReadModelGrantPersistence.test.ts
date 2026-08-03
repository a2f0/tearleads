import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  OrganizationContainerGrantResponse,
  OrganizationContainerGrantsResponse,
  OrganizationReadModelDeltaResponse,
} from "@tearleads/validators/response";
import { organizationReadModelSnapshot } from "../../../../test/helpers/organizationReadModelPersistenceFixtures";
import {
  applyOrganizationReadModelResponse,
  loadOrganizationReadModelProjection,
  purgeOrganizationReadModelProjection,
} from "./organizationReadModelPersistence";

const CREATED_AT = "2026-07-17T12:00:00.000Z";
const ORGANIZATION_ID = "organization-grants-v4";
const CURRENT_USER_ID = "user-1";

function groupGrant(
  containerId: string,
  groupId = "group-1",
): OrganizationContainerGrantResponse {
  return {
    accessLevel: "read",
    containerId,
    createdAt: CREATED_AT,
    depth: 1,
    isBuiltin: false,
    metadataAccessEpoch: 2,
    metadataAccessStateHash: `manifest-${containerId}`,
    metadataDocumentId: `metadata-${containerId}`,
    parentId: "root-container",
    updatedAt: CREATED_AT,
    subjectType: "group",
    subjectId: groupId,
    userId: null,
    signingKeyFingerprint: null,
    groupId,
    groupName: `Group ${groupId}`,
    organizationName: null,
  };
}

function snapshotWithGrants(
  grants: readonly OrganizationContainerGrantResponse[],
  cursor = "cursor-1",
) {
  const response = organizationReadModelSnapshot(ORGANIZATION_ID, cursor);
  return {
    ...response,
    lanes: {
      ...response.lanes,
      grants: { organizationId: ORGANIZATION_ID, grants: [...grants] },
    },
  };
}

function grantsDelta(input: {
  readonly cursor?: string;
  readonly grants: readonly OrganizationContainerGrantResponse[];
  readonly organizationId?: string;
}): OrganizationReadModelDeltaResponse {
  return {
    version: 5,
    mode: "delta",
    organizationId: ORGANIZATION_ID,
    nextCursor: input.cursor ?? "cursor-2",
    hasMore: false,
    currentUser: { isOrgAdmin: true },
    lanes: {
      grants: {
        organizationId: input.organizationId ?? ORGANIZATION_ID,
        grants: [...input.grants],
      },
    },
  };
}

async function applySnapshot(
  execSql: Parameters<typeof applyOrganizationReadModelResponse>[0]["execSql"],
  grants: readonly OrganizationContainerGrantResponse[],
): Promise<void> {
  await expect(
    applyOrganizationReadModelResponse({
      currentUserId: CURRENT_USER_ID,
      execSql,
      requestedCursor: null,
      response: snapshotWithGrants(grants),
    }),
  ).resolves.toBe("applied");
}

async function loadGrants(
  execSql: Parameters<typeof applyOrganizationReadModelResponse>[0]["execSql"],
): Promise<OrganizationContainerGrantsResponse | undefined> {
  return (
    await loadOrganizationReadModelProjection(
      execSql,
      ORGANIZATION_ID,
      CURRENT_USER_ID,
    )
  )?.grants;
}

test("grants deltas atomically replace the whole lane, including with empty state", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-grants-replacement",
  );
  try {
    await applySnapshot(execSql, [
      groupGrant("container-1"),
      groupGrant("container-2"),
    ]);
    await expect(loadGrants(execSql)).resolves.toMatchObject({
      grants: [{ containerId: "container-1" }, { containerId: "container-2" }],
    });

    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: CURRENT_USER_ID,
        execSql,
        requestedCursor: "cursor-1",
        response: grantsDelta({ grants: [groupGrant("container-3")] }),
      }),
    ).resolves.toBe("applied");
    await expect(loadGrants(execSql)).resolves.toMatchObject({
      grants: [{ containerId: "container-3" }],
    });

    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: CURRENT_USER_ID,
        execSql,
        requestedCursor: "cursor-2",
        response: grantsDelta({ cursor: "cursor-3", grants: [] }),
      }),
    ).resolves.toBe("applied");
    await expect(loadGrants(execSql)).resolves.toEqual({
      organizationId: ORGANIZATION_ID,
      grants: [],
    });
  } finally {
    close();
  }
});

test("grants reject duplicate identities and lane scope without changing durable state", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-grants-validation",
  );
  try {
    const original = groupGrant("container-original");
    await applySnapshot(execSql, [original]);

    const invalidResponses = [
      grantsDelta({
        grants: [
          groupGrant("container-duplicate"),
          groupGrant("container-duplicate"),
        ],
      }),
      grantsDelta({
        grants: [groupGrant("container-wrong-scope")],
        organizationId: "other-organization",
      }),
      grantsDelta({
        grants: [{ ...groupGrant("container-invalid-subject"), groupId: null }],
      }),
    ];
    for (const response of invalidResponses) {
      await expect(
        applyOrganizationReadModelResponse({
          currentUserId: CURRENT_USER_ID,
          execSql,
          requestedCursor: "cursor-1",
          response,
        }),
      ).rejects.toThrow();
      await expect(loadGrants(execSql)).resolves.toEqual({
        organizationId: ORGANIZATION_ID,
        grants: [original],
      });
    }

    const projection = await loadOrganizationReadModelProjection(
      execSql,
      ORGANIZATION_ID,
      CURRENT_USER_ID,
    );
    expect(projection?.cursor).toBe("cursor-1");
  } finally {
    close();
  }
});

test("large grants snapshots preserve wire order across insert batches", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-grants-batching",
  );
  const grants = Array.from({ length: 125 }, (_, index) =>
    groupGrant(`container-${String(index).padStart(3, "0")}`, `group-${index}`),
  );
  try {
    await applySnapshot(execSql, grants);
    const stored = await loadGrants(execSql);
    expect(stored?.grants).toHaveLength(grants.length);
    expect(stored?.grants.map((grant) => grant.containerId)).toEqual(
      grants.map((grant) => grant.containerId),
    );
  } finally {
    close();
  }
});

test("organization projection purge removes persisted grants", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-grants-purge",
  );
  try {
    await applySnapshot(execSql, [groupGrant("container-purge")]);
    await purgeOrganizationReadModelProjection(execSql, ORGANIZATION_ID);

    await expect(loadGrants(execSql)).resolves.toBeUndefined();
    const rows = await execSql(
      "SELECT COUNT(*) FROM organization_read_model_container_grants",
      undefined,
      { rowMode: "array" },
    );
    expect(rows[0]?.[0]).toBe(0);
  } finally {
    close();
  }
});

test("a mid-apply storage failure rolls back the grants lane and cursor", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-grants-rollback",
  );
  try {
    const original = groupGrant("container-original");
    await applySnapshot(execSql, [original]);
    await execSql(`CREATE TRIGGER fail_grant_insert
      BEFORE INSERT ON organization_read_model_container_grants
      WHEN NEW.container_id = 'container-fail'
      BEGIN
        SELECT RAISE(ABORT, 'injected grant insert failure');
      END`);

    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: CURRENT_USER_ID,
        execSql,
        requestedCursor: "cursor-1",
        response: grantsDelta({
          grants: [groupGrant("container-ok"), groupGrant("container-fail")],
        }),
      }),
    ).rejects.toThrow();

    await expect(loadGrants(execSql)).resolves.toEqual({
      organizationId: ORGANIZATION_ID,
      grants: [original],
    });
    const projection = await loadOrganizationReadModelProjection(
      execSql,
      ORGANIZATION_ID,
      CURRENT_USER_ID,
    );
    expect(projection?.cursor).toBe("cursor-1");
  } finally {
    close();
  }
});
