import { expect, test } from "bun:test";
import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { DocumentCreateRequest } from "@tearleads/validators/request";
import { loadOrganizationsDataUsage } from "./dataUsage";
import { listUsersReachableFromCurrentPrincipal } from "./principalReachability";
import { readDocumentCreateRequestId } from "./provisionOrganizationProfiles";

function executorReturning(
  ...results: readonly (readonly unknown[])[]
): DatabaseSession {
  const queue = [...results];
  const executor = {
    execute: async () => ({ rows: queue.shift() ?? [] }),
  };
  return executor as unknown as DatabaseSession;
}

const organizationId = "organization";

test("reachable users are read from rows with a string userId", async () => {
  expect(
    await listUsersReachableFromCurrentPrincipal({
      executor: executorReturning([
        { userId: "user-b" },
        { userId: "user-a", extra: 1 },
        { userId: "" },
      ]),
      principalId: "group",
      principalType: "group",
    }),
  ).toEqual(["", "user-a", "user-b"]);
  for (const row of [
    null,
    undefined,
    "user-a",
    1,
    [],
    ["user-a"],
    {},
    { userId: null },
    { userId: 1 },
    { userId: ["user-a"] },
    { user_id: "user-a" },
  ]) {
    await expect(
      listUsersReachableFromCurrentPrincipal({
        executor: executorReturning([{ userId: "user-a" }, row]),
        principalId: "organization",
        principalType: "organization",
      }),
    ).rejects.toThrow("Unexpected principal reachability row shape");
  }
});

const malformedUsageRows: readonly unknown[] = [
  null,
  undefined,
  "organization",
  1,
  [],
  [organizationId],
  {},
  { organizationId: null },
  { organizationId: 1 },
  { organizationId: [organizationId] },
];

test("organization data usage rows need a string organization id", async () => {
  for (const row of malformedUsageRows) {
    await expect(
      loadOrganizationsDataUsage(executorReturning([row], []), [
        organizationId,
      ]),
    ).rejects.toThrow("Invalid document usage row");
    await expect(
      loadOrganizationsDataUsage(executorReturning([], [row]), [
        organizationId,
      ]),
    ).rejects.toThrow("Invalid blob usage row");
  }
  await expect(
    loadOrganizationsDataUsage(
      executorReturning([{ organizationId, category: "spreadsheet" }], []),
      [organizationId],
    ),
  ).rejects.toThrow(
    "Unexpected organization document usage category: spreadsheet",
  );
});

test("organization data usage keeps every column of a valid row", async () => {
  const usage = await loadOrganizationsDataUsage(
    executorReturning(
      [
        {
          organizationId,
          category: "user",
          byteLength: "40",
          documentCount: 2n,
          documentUpdateCount: 3,
          extra: "ignored",
        },
        { organizationId: "other", category: "user", byteLength: 9 },
      ],
      [
        { organizationId, blobByteLength: "5", blobCount: 1 },
        // Absent aggregates read as zero, as they always have.
        { organizationId: "empty" },
      ],
    ),
    [organizationId, "empty"],
  );
  const total = usage.get(organizationId);
  expect(total?.totalByteLength).toBe(45);
  expect(total?.blobs).toEqual({ blobCount: 1, byteLength: 5 });
  expect(total?.documents.updateCount).toBe(3);
  expect(usage.get("empty")?.totalByteLength).toBe(0);
});

test("a provisioned document id is read from the request event", () => {
  function request(event: Record<string, unknown>): DocumentCreateRequest {
    return { event } as unknown as DocumentCreateRequest;
  }
  expect(readDocumentCreateRequestId(request({ objectId: "document" }))).toBe(
    "document",
  );
  expect(
    readDocumentCreateRequestId(request({ objectId: "document", extra: 1 })),
  ).toBe("document");
  for (const event of [
    {},
    { objectId: "" },
    { objectId: null },
    { objectId: 1 },
    { objectId: ["document"] },
    { objectId: { id: "document" } },
  ]) {
    expect(readDocumentCreateRequestId(request(event))).toBe("");
  }
});
