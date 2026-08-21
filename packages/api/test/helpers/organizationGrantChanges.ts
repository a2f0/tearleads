import { expect } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  accessManifestHeads,
  containers,
  organizationReadModelChanges,
} from "@symcrypt/api-shared/schema";
import { isOrganizationReadModelResponse } from "@symcrypt/validators/response";
import { and, desc, eq } from "drizzle-orm";
import invariant from "invariant";
import { routeApp } from "../../src/routeApp";

const PINNED_CONTAINER_UPDATED_AT = new Date("2000-01-01T00:00:00.000Z");

async function loadOrganizationReadModel(input: {
  readonly cursor?: string | undefined;
  readonly organizationId: string;
  readonly token: string;
}) {
  const query = input.cursor
    ? `?${new URLSearchParams({ cursor: input.cursor })}`
    : "";
  const response = await routeApp.request(
    `/organizations/${input.organizationId}/read-model${query}`,
    { headers: { Authorization: `Bearer ${input.token}` } },
  );
  expect(response.status).toBe(200);
  const readModel = await response.json();
  invariant(
    isOrganizationReadModelResponse(readModel),
    "expected organization read-model response",
  );
  return readModel;
}

export async function expectLatestChange(
  organizationId: string,
): Promise<void> {
  const [change] = await db
    .select({
      entityId: organizationReadModelChanges.entityId,
      lane: organizationReadModelChanges.lane,
      operation: organizationReadModelChanges.operation,
    })
    .from(organizationReadModelChanges)
    .where(eq(organizationReadModelChanges.organizationId, organizationId))
    .orderBy(desc(organizationReadModelChanges.cursor))
    .limit(1);
  expect(change).toEqual({
    entityId: organizationId,
    lane: "grants",
    operation: "replace",
  });
}

export async function trackDelta(
  organizationId: string,
  token: string,
): Promise<{ expectReplacement(containerId: string): Promise<void> }> {
  const before = await loadOrganizationReadModel({ organizationId, token });
  invariant(before.mode === "snapshot", "expected read-model snapshot");

  return {
    async expectReplacement(containerId: string): Promise<void> {
      const beforeContainerGrantCount = before.lanes.grants.grants.filter(
        (grant) => grant.containerId === containerId,
      ).length;
      const [pinnedContainer] = await db
        .update(containers)
        .set({ updatedAt: PINNED_CONTAINER_UPDATED_AT })
        .where(eq(containers.id, containerId))
        .returning({ updatedAt: containers.updatedAt });
      invariant(pinnedContainer, "expected container timestamp to be pinned");
      const [manifestHead] = await db
        .select({ updatedAt: accessManifestHeads.updatedAt })
        .from(accessManifestHeads)
        .where(
          and(
            eq(accessManifestHeads.objectKind, "container"),
            eq(accessManifestHeads.objectId, containerId),
          ),
        )
        .limit(1);
      invariant(manifestHead, "expected container access-manifest head");

      const delta = await loadOrganizationReadModel({
        cursor: before.nextCursor,
        organizationId,
        token,
      });
      invariant(delta.mode === "delta", "expected read-model delta");
      const current = await loadOrganizationReadModel({
        organizationId,
        token,
      });
      invariant(current.mode === "snapshot", "expected current snapshot");
      expect(delta.lanes).toEqual({ grants: current.lanes.grants });

      const containerGrants = current.lanes.grants.grants.filter(
        (grant) => grant.containerId === containerId,
      );
      expect(containerGrants.length).toBeGreaterThan(beforeContainerGrantCount);
      expect(containerGrants.map((grant) => grant.updatedAt)).toEqual(
        containerGrants.map(() => manifestHead.updatedAt.toISOString()),
      );
      expect(containerGrants.map((grant) => grant.updatedAt)).not.toContain(
        pinnedContainer.updatedAt.toISOString(),
      );
    },
  };
}
