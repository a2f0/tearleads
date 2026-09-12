import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import { inArray } from "drizzle-orm";

/** Retained signed history does not prove that a container still exists. */
export async function loadLiveContainerOrganizations(
  executor: DatabaseSession,
  containerIds: readonly string[],
): Promise<Map<string, string>> {
  if (containerIds.length === 0) return new Map();
  const rows = await executor
    .select({ id: containers.id, organizationId: containers.organizationId })
    .from(containers)
    .where(inArray(containers.id, [...new Set(containerIds)]));
  return new Map(rows.map((row) => [row.id, row.organizationId]));
}
