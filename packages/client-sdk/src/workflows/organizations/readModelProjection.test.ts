import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  ORGANIZATION_PRESENTATION_ERROR_CODES,
  ORGANIZATION_READ_MODEL_ERROR_CODES,
  type OrganizationReadModelResponse,
} from "@tearleads/validators/response";
import { dataUsage } from "../../../test/helpers/organizationReadModelFixtures";
import {
  organizationReadModelFailure,
  organizationReadModelGroupsDelta,
  organizationReadModelOrganizationId,
  organizationReadModelSnapshot,
  organizationReadModelUserId,
} from "../../../test/helpers/organizationReadModelProjectionFixtures";
import {
  loadOrganizationDataUsageProjection,
  saveOrganizationDataUsageProjection,
} from "../../data/persistence/organizations/organizationDataUsagePersistence";
import { applyOrganizationReadModelResponse } from "../../data/persistence/organizations/organizationReadModelPersistence";
import {
  loadLocalOrganizationDirectoryAndGroups,
  reconcileOrganizationDirectoryAndGroups,
} from "./readModelProjection";

const organizationId = organizationReadModelOrganizationId;
const currentUserId = organizationReadModelUserId;

async function seedProjection(
  execSql: Parameters<typeof applyOrganizationReadModelResponse>[0]["execSql"],
  response: OrganizationReadModelResponse = organizationReadModelSnapshot(),
): Promise<void> {
  await applyOrganizationReadModelResponse({
    currentUserId,
    execSql,
    requestedCursor: null,
    response,
  });
}

test("cold reconciliation stores a snapshot from the read-model feed", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-cold-reconcile-test",
  );
  const requests: Array<[string, string | undefined]> = [];
  const response = organizationReadModelSnapshot();
  const apiClient = {
    async getOrganizationReadModelResult(
      nextOrganizationId: string,
      cursor?: string,
    ) {
      requests.push([nextOrganizationId, cursor]);
      return { data: response, ok: true } as const;
    },
  };

  try {
    const projection = await reconcileOrganizationDirectoryAndGroups({
      apiClient,
      currentUserId,
      execSql,
      organizationId,
    });

    expect(requests).toEqual([[organizationId, undefined]]);
    expect(projection?.directory.organizationId).toBe(organizationId);
    expect(projection?.directory.currentUser).toEqual({ isOrgAdmin: true });
    expect(projection?.groups[0]?.name).toBe("Admins");
    await expect(
      loadLocalOrganizationDirectoryAndGroups({
        currentUserId,
        execSql,
        organizationId,
      }),
    ).resolves.toEqual(projection ?? null);
  } finally {
    close();
  }
});

test("warm reconciliation requests and applies a cursor delta", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-warm-reconcile-test",
  );
  const requestedCursors: Array<string | undefined> = [];
  const response = organizationReadModelGroupsDelta({
    cursor: "cursor-2",
    groupName: "Operators",
  });

  try {
    await seedProjection(execSql);
    const projection = await reconcileOrganizationDirectoryAndGroups({
      apiClient: {
        async getOrganizationReadModelResult(_organizationId, cursor) {
          requestedCursors.push(cursor);
          return { data: response, ok: true };
        },
      },
      currentUserId,
      execSql,
      organizationId,
    });

    expect(requestedCursors).toEqual(["cursor-1"]);
    expect(projection?.groups[0]?.name).toBe("Operators");
    expect(projection?.directory.users).toHaveLength(2);
  } finally {
    close();
  }
});

test("a missing requester reconciles from the shared global cursor", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-missing-requester-test",
  );
  const requestedCursors: Array<string | undefined> = [];
  const response: OrganizationReadModelResponse = {
    version: 6,
    mode: "delta",
    organizationId,
    nextCursor: "cursor-1",
    hasMore: false,
    currentUser: { isOrgAdmin: false },
    lanes: {},
  };

  try {
    await seedProjection(execSql);
    const projection = await reconcileOrganizationDirectoryAndGroups({
      apiClient: {
        async getOrganizationReadModelResult(_organizationId, cursor) {
          requestedCursors.push(cursor);
          return { data: response, ok: true };
        },
      },
      currentUserId: "user-2",
      execSql,
      organizationId,
    });

    expect(requestedCursors).toEqual(["cursor-1"]);
    expect(projection?.directory.currentUser).toEqual({ isOrgAdmin: false });
    expect(
      projection?.directory.users.find((user) => user.userId === "user-2")
        ?.isSelf,
    ).toBe(true);
  } finally {
    close();
  }
});

for (const status of [403, 404] as const) {
  test(`${status} purges the organization projection`, async () => {
    const { close, execSql } = await createTestExecSql(
      `organization-read-model-purge-${status}-test`,
    );
    let reported = false;

    try {
      await seedProjection(execSql);
      await saveOrganizationDataUsageProjection({
        execSql,
        requesterUserId: currentUserId,
        response: { ...dataUsage, organizationId },
      });
      await expect(
        reconcileOrganizationDirectoryAndGroups({
          apiClient: {
            async getOrganizationReadModelResult() {
              return organizationReadModelFailure({
                code: ORGANIZATION_PRESENTATION_ERROR_CODES.accessDenied,
                kind: "http",
                report: () => {
                  reported = true;
                },
                status,
              });
            },
          },
          currentUserId,
          execSql,
          organizationId,
        }),
      ).resolves.toBeNull();
      await expect(
        loadLocalOrganizationDirectoryAndGroups({
          currentUserId,
          execSql,
          organizationId,
        }),
      ).resolves.toBeNull();
      await expect(
        loadOrganizationDataUsageProjection(
          execSql,
          organizationId,
          currentUserId,
        ),
      ).resolves.toBeNull();
      expect(reported).toBe(false);
    } finally {
      close();
    }
  });
}

test("network, shape, and server failures retain and report last-known-good data", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-retained-failure-test",
  );
  const reports: string[] = [];
  const failures = [
    { kind: "network", status: null },
    { kind: "shape", status: 200 },
    { kind: "http", status: 404 },
    { kind: "http", status: 503 },
  ] as const;
  let failureIndex = 0;

  try {
    await seedProjection(execSql);
    const local = await loadLocalOrganizationDirectoryAndGroups({
      currentUserId,
      execSql,
      organizationId,
    });

    for (const failure of failures) {
      const result = await reconcileOrganizationDirectoryAndGroups({
        apiClient: {
          async getOrganizationReadModelResult() {
            const label = `${failure.kind}:${failure.status}`;
            failureIndex += 1;
            return organizationReadModelFailure({
              ...failure,
              report: () => reports.push(label),
            });
          },
        },
        currentUserId,
        execSql,
        organizationId,
      });
      expect(result).toEqual(local);
    }

    expect(failureIndex).toBe(4);
    expect(reports).toEqual([
      "network:null",
      "shape:200",
      "http:404",
      "http:503",
    ]);
  } finally {
    close();
  }
});

test("an invalid warm cursor resets once with a cursorless snapshot", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-invalid-cursor-test",
  );
  const cursors: Array<string | undefined> = [];
  const replacement = organizationReadModelSnapshot({
    cursor: "cursor-reset",
    groupName: "Reset Group",
  });
  let reports = 0;

  try {
    await seedProjection(execSql);
    const projection = await reconcileOrganizationDirectoryAndGroups({
      apiClient: {
        async getOrganizationReadModelResult(_organizationId, cursor) {
          cursors.push(cursor);
          return cursors.length === 1
            ? organizationReadModelFailure({
                code: ORGANIZATION_READ_MODEL_ERROR_CODES.cursorInvalid,
                kind: "http",
                report: () => {
                  reports += 1;
                },
                status: 400,
              })
            : ({ data: replacement, ok: true } as const);
        },
      },
      currentUserId,
      execSql,
      organizationId,
    });

    expect(cursors).toEqual(["cursor-1", undefined]);
    expect(reports).toBe(0);
    expect(projection?.groups[0]?.name).toBe("Reset Group");
  } finally {
    close();
  }
});

test("cursor reset fails closed without the exact status and code", async () => {
  const failures = [
    { kind: "http", status: 400 },
    { code: "unknown_code", kind: "http", status: 400 },
    {
      code: ` ${ORGANIZATION_READ_MODEL_ERROR_CODES.cursorInvalid} `,
      kind: "http",
      status: 400,
    },
    {
      code: ORGANIZATION_READ_MODEL_ERROR_CODES.cursorInvalid,
      kind: "http",
      status: 409,
    },
    { kind: "network", status: null },
    { kind: "shape", status: 400 },
  ] as const;

  for (const [index, failure] of failures.entries()) {
    const { close, execSql } = await createTestExecSql(
      `organization-read-model-cursor-fail-closed-${index}`,
    );
    const cursors: Array<string | undefined> = [];
    let reports = 0;

    try {
      await seedProjection(execSql);
      const local = await loadLocalOrganizationDirectoryAndGroups({
        currentUserId,
        execSql,
        organizationId,
      });
      const projection = await reconcileOrganizationDirectoryAndGroups({
        apiClient: {
          async getOrganizationReadModelResult(_organizationId, cursor) {
            cursors.push(cursor);
            return organizationReadModelFailure({
              ...failure,
              report: () => {
                reports += 1;
              },
            });
          },
        },
        currentUserId,
        execSql,
        organizationId,
      });

      expect(cursors).toEqual(["cursor-1"]);
      expect(reports).toBe(1);
      expect(projection).toEqual(local);
    } finally {
      close();
    }
  }
});

test("a binding failure purges and retries from a snapshot", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-binding-reset-test",
  );
  const cursors: Array<string | undefined> = [];
  const inconsistentDelta = organizationReadModelGroupsDelta({
    cursor: "cursor-2",
    groupName: "Missing membership head",
  });
  const replacement = organizationReadModelSnapshot({
    cursor: "cursor-reset",
    groupName: "Recovered Group",
  });
  const inconsistentGroups = inconsistentDelta.lanes.groups;
  if (!inconsistentGroups) {
    throw new Error("Expected an inconsistent groups lane");
  }
  const responses: OrganizationReadModelResponse[] = [
    {
      ...inconsistentDelta,
      lanes: { groups: inconsistentGroups },
    },
    replacement,
  ];

  try {
    await seedProjection(execSql);
    const projection = await reconcileOrganizationDirectoryAndGroups({
      apiClient: {
        async getOrganizationReadModelResult(_organizationId, cursor) {
          cursors.push(cursor);
          const response = responses.shift();
          if (!response) {
            throw new Error("Unexpected read-model request");
          }
          return { data: response, ok: true };
        },
      },
      currentUserId,
      execSql,
      organizationId,
    });

    expect(cursors).toEqual(["cursor-1", undefined]);
    expect(projection?.groups[0]?.name).toBe("Recovered Group");
  } finally {
    close();
  }
});

test("a response for another organization retains the scoped projection", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-scope-mismatch-test",
  );
  const logs: string[] = [];

  try {
    await seedProjection(execSql);
    const local = await loadLocalOrganizationDirectoryAndGroups({
      currentUserId,
      execSql,
      organizationId,
    });
    const result = await reconcileOrganizationDirectoryAndGroups({
      apiClient: {
        async getOrganizationReadModelResult() {
          return {
            data: organizationReadModelSnapshot({
              cursor: "wrong-scope-cursor",
              organizationId: "org-2",
            }),
            ok: true,
          } as const;
        },
      },
      currentUserId,
      execSql,
      logError: (message) => logs.push(String(message)),
      organizationId,
    });

    expect(result).toEqual(local);
    expect(logs).toEqual([
      `Organization read-model response scope does not match ${organizationId}`,
    ]);
    await expect(
      loadLocalOrganizationDirectoryAndGroups({
        currentUserId,
        execSql,
        organizationId: "org-2",
      }),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("a failed feed with no local projection resolves undefined", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-failed-cold-test",
  );

  try {
    // Not a completed pass: consumers must not mark the scope caught up or
    // repaint a loss, because nothing authoritative was learned.
    await expect(
      reconcileOrganizationDirectoryAndGroups({
        apiClient: {
          async getOrganizationReadModelResult() {
            return organizationReadModelFailure({ kind: "http", status: 503 });
          },
        },
        currentUserId,
        execSql,
        organizationId,
      }),
    ).resolves.toBeUndefined();
  } finally {
    close();
  }
});
