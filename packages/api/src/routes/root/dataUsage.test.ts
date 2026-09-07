import { beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@tearleads/api-shared/postgres";
import {
  blobContentWriteHeaders,
  organizationRosterEntries,
  organizations,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  OrganizationDataUsageResponseSchema,
  RootDataUsageReportResponseSchema,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { registerAndAuthenticate } from "../../../test/helpers/organizationBillingHistory";
import {
  seedOrganizationDataUsage,
  seedUsageDocument,
} from "../../../test/helpers/organizationDataUsage";
import { routeApp } from "../../routeApp";

const root = createTestUser();
const member = createTestUser();
const prefix = `Usage %_ ${randomUUID()}`;
const emptyId = randomUUID();
let organizationId: string;
let expected: Awaited<ReturnType<typeof seedOrganizationDataUsage>>;
const headers = (token = root.token) => ({ Authorization: `Bearer ${token}` });
const request = (path: string) =>
  routeApp.request(path, { headers: headers() });
const reportPath = (suffix = "") =>
  `/root/reports/data-usage?search=${encodeURIComponent(prefix)}${suffix}`;

beforeAll(async () => {
  await registerAndAuthenticate(root);
  organizationId = await registerAndAuthenticate(member);
  await db.update(users).set({ isRoot: true }).where(eq(users.id, root.userId));
  await db
    .update(organizations)
    .set({ name: `${prefix} used` })
    .where(eq(organizations.id, organizationId));
  await db.insert(organizations).values({
    id: emptyId,
    name: `${prefix} empty`,
    memberGroupId: randomUUID(),
    adminGroupId: randomUUID(),
  });
  expected = await seedOrganizationDataUsage({ actor: member, organizationId });
});

test("usage endpoints authenticate and require root before validating inputs", async () => {
  for (const path of [
    "/root/reports/data-usage?limit=0",
    "/root/organizations/invalid/data-usage",
  ]) {
    expect((await routeApp.request(path)).status).toBe(401);
    expect(
      (await routeApp.request(path, { headers: headers(member.token) })).status,
    ).toBe(403);
    expect((await request(path)).status).toBe(400);
  }
});

test("root can read a non-member organization's usage with the same accounting as Org Manager", async () => {
  const path = `/organizations/${organizationId}/data-usage`;
  const usage = await request(`/root${path}`);
  expect(usage.status).toBe(200);
  const body = OrganizationDataUsageResponseSchema.parse(await usage.json());
  expect(body).toEqual({ organizationId, ...expected });
  const memberUsage = await routeApp.request(path, {
    headers: headers(member.token),
  });
  expect(await memberUsage.json()).toEqual(body);
  expect((await routeApp.request(path, { headers: headers() })).status).toBe(
    403,
  );
  expect(
    (await request(`/root/organizations/${randomUUID()}/data-usage`)).status,
  ).toBe(404);
});

test("reports page through used and empty organizations, with scoped cursors and literal search", async () => {
  const firstResponse = await request(reportPath("&limit=1"));
  expect(firstResponse.status).toBe(200);
  const first = RootDataUsageReportResponseSchema.parse(
    await firstResponse.json(),
  );
  expect(first.organizations).toHaveLength(1);
  expect(first.nextCursor).toBeString();
  const secondResponse = await request(
    reportPath(`&limit=1&cursor=${encodeURIComponent(first.nextCursor ?? "")}`),
  );
  expect(secondResponse.status).toBe(200);
  const second = RootDataUsageReportResponseSchema.parse(
    await secondResponse.json(),
  );
  expect(second.nextCursor).toBeNull();
  const rows = [...first.organizations, ...second.organizations];
  expect(rows.map((row) => row.organization.organizationId).sort()).toEqual(
    [organizationId, emptyId].sort(),
  );
  expect(
    rows.find((row) => row.organization.organizationId === organizationId)
      ?.dataUsage,
  ).toEqual({ organizationId, ...expected });
  expect(
    rows.find((row) => row.organization.organizationId === emptyId)?.dataUsage
      .totalByteLength,
  ).toBe(0);
  const cursor = encodeURIComponent(first.nextCursor ?? "");
  expect(
    (
      await request(
        `/root/organizations?search=${encodeURIComponent(prefix)}&cursor=${cursor}`,
      )
    ).status,
  ).toBe(400);
  expect(
    (await request(`/root/reports/data-usage?search=changed&cursor=${cursor}`))
      .status,
  ).toBe(400);
  const missing = await request(
    `/root/reports/data-usage?search=${randomUUID()}`,
  );
  expect(await missing.json()).toEqual({ organizations: [], nextCursor: null });
});

test("batched usage scopes metadata and deduplicates shared blobs per organization", async () => {
  const actor = createTestUser();
  const usedId = await registerAndAuthenticate(actor);
  const sharedId = randomUUID();
  const batchPrefix = `Batch usage ${randomUUID()}`;
  await db
    .update(organizations)
    .set({ name: `${batchPrefix} used` })
    .where(eq(organizations.id, usedId));
  await db.insert(organizations).values({
    id: sharedId,
    name: `${batchPrefix} shared`,
    memberGroupId: randomUUID(),
    adminGroupId: randomUUID(),
  });
  await seedOrganizationDataUsage({ actor, organizationId: usedId });
  const [source] = await db
    .select()
    .from(blobContentWriteHeaders)
    .where(eq(blobContentWriteHeaders.organizationId, usedId))
    .limit(1);
  if (!source) throw new Error("Expected seeded blob header");
  await db.insert(blobContentWriteHeaders).values(
    [1, 2].map(() => {
      const recordId = randomUUID();
      return {
        ...source,
        organizationId: sharedId,
        recordId,
        contentRecordId: recordId,
        headerHash: recordId,
        nonceDomainHash: recordId,
        header: {
          ...source.header,
          organizationId: sharedId,
          contentRecordId: recordId,
          nonceDomainHash: recordId,
        },
        authorization: { ...source.authorization, organizationId: sharedId },
      };
    }),
  );
  const orgProfileId = randomUUID();
  const rosterProfileId = randomUUID();
  for (const [documentId, sharedBytes, usedBytes] of [
    [orgProfileId, 23, 31],
    [rosterProfileId, 29, 37],
  ] as const) {
    await seedUsageDocument({
      actor,
      organizationId: sharedId,
      documentId,
      updates: [{ id: randomUUID(), byteLength: sharedBytes }],
    });
    await seedUsageDocument({
      actor,
      organizationId: usedId,
      documentId,
      updates: [{ id: randomUUID(), byteLength: usedBytes }],
    });
  }
  await db
    .update(organizations)
    .set({ profileDocumentId: orgProfileId })
    .where(eq(organizations.id, sharedId));
  await db.insert(organizationRosterEntries).values({
    organizationId: sharedId,
    userId: actor.userId,
    profileDocumentId: rosterProfileId,
  });
  const response = await request(
    `/root/reports/data-usage?search=${encodeURIComponent(batchPrefix)}`,
  );
  expect(response.status).toBe(200);
  const report = RootDataUsageReportResponseSchema.parse(await response.json());
  expect(report.organizations).toHaveLength(2);
  const shared = report.organizations.find(
    (row) => row.organization.organizationId === sharedId,
  )?.dataUsage;
  expect(shared?.blobs).toEqual({ blobCount: 1, byteLength: 17 });
  expect(shared?.documents.breakdown).toEqual([
    {
      category: "containerMetadata",
      byteLength: 0,
      documentCount: 0,
      updateCount: 0,
    },
    {
      category: "rosterProfiles",
      byteLength: 29,
      documentCount: 1,
      updateCount: 1,
    },
    {
      category: "organizationMetadata",
      byteLength: 23,
      documentCount: 1,
      updateCount: 1,
    },
    { category: "user", byteLength: 0, documentCount: 0, updateCount: 0 },
  ]);
  expect(shared?.totalByteLength).toBe(69);
  const used = report.organizations.find(
    (row) => row.organization.organizationId === usedId,
  )?.dataUsage;
  expect(used?.totalByteLength).toBe(176);
  expect(
    used?.documents.breakdown.find((entry) => entry.category === "user"),
  ).toEqual({
    category: "user",
    byteLength: 92,
    documentCount: 3,
    updateCount: 4,
  });
});
