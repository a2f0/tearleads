import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import type { TestUser } from "@tearleads/bob-and-alice";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { and, asc, eq, isNull } from "drizzle-orm";

/** Expected persisted root candidates in the lane's (updatedAt, id) order. */
export async function loadRegisteredContainerRoots(owner: TestUser) {
  const [personal] = await db
    .select()
    .from(containers)
    .where(eq(containers.id, owner.rootContainerId))
    .limit(1);
  if (!personal) throw new Error("Expected the registered personal root");
  const metadataSlot = await deriveOrganizationMetadataContainerSystemSlot({
    organizationId: personal.organizationId,
  });
  const roots = await db
    .select()
    .from(containers)
    .where(
      and(
        eq(containers.organizationId, personal.organizationId),
        isNull(containers.parentId),
      ),
    )
    .orderBy(asc(containers.updatedAt), asc(containers.id));
  expect(roots).toHaveLength(2);
  expect(roots.map((root) => root.systemSlot)).toEqual(
    expect.arrayContaining([null, metadataSlot]),
  );
  return roots;
}

export function rootWatermark(
  root: { readonly id: string; readonly updatedAt: Date } | undefined,
) {
  if (!root) throw new Error("Expected a root candidate");
  return { id: root.id, updatedAt: root.updatedAt.toISOString() };
}
