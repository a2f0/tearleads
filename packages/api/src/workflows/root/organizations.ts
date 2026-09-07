import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizations,
} from "@tearleads/api-shared/schema";
import type { RootOrganizationSummaryResponse } from "@tearleads/validators/response";
import { and, desc, eq, sql } from "drizzle-orm";

const selection = {
  organizationId: organizations.id,
  name: organizations.name,
  createdAt: organizations.createdAt,
  billingStatus: organizationBilling.status,
};
function summarize(row: {
  organizationId: string;
  name: string;
  createdAt: Date;
  billingStatus: RootOrganizationSummaryResponse["billingStatus"];
}): RootOrganizationSummaryResponse {
  return { ...row, createdAt: row.createdAt.toISOString() };
}
export async function getRootOrganization(
  executor: DatabaseSession,
  organizationId: string,
) {
  const [row] = await executor
    .select(selection)
    .from(organizations)
    .leftJoin(
      organizationBilling,
      eq(organizationBilling.organizationId, organizations.id),
    )
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return row ? summarize(row) : null;
}
export async function listRootOrganizations(
  executor: DatabaseSession,
  input: {
    afterId?: string | undefined;
    search?: string | undefined;
    limit: number;
  },
) {
  const afterCreatedAt = sql`(select ${organizations.createdAt} from ${organizations} where ${organizations.id} = ${input.afterId})`;
  // Literal substring matching: '%' and '_' in organization names are not wildcards.
  const search = input.search?.trim().toLowerCase();
  const pattern = `%${search?.replace(/[!%_]/gu, "!$&") ?? ""}%`;
  const rows = await executor
    .select(selection)
    .from(organizations)
    .leftJoin(
      organizationBilling,
      eq(organizationBilling.organizationId, organizations.id),
    )
    .where(
      and(
        input.afterId === undefined
          ? undefined
          : sql`(${organizations.createdAt} < ${afterCreatedAt} or (${organizations.createdAt} = ${afterCreatedAt} and ${organizations.id} < ${input.afterId}))`,
        search
          ? sql`(lower(${organizations.name}) like ${pattern} escape '!' or lower(cast(${organizations.id} as text)) = ${search})`
          : undefined,
      ),
    )
    .orderBy(desc(organizations.createdAt), desc(organizations.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  return {
    organizations: page.map(summarize),
    nextAfterId:
      rows.length > input.limit ? (page.at(-1)?.organizationId ?? null) : null,
  };
}
