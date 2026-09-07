import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { loadOrganizationsDataUsage } from "../organizations/dataUsage";
import { getRootOrganization, listRootOrganizations } from "./organizations";

export async function loadRootOrganizationDataUsage(
  db: ApiDatabase,
  organizationId: string,
) {
  return db.transaction(async (tx) => {
    if (!(await getRootOrganization(tx, organizationId))) return null;
    return (
      (await loadOrganizationsDataUsage(tx, [organizationId])).get(
        organizationId,
      ) ?? null
    );
  });
}

export async function loadRootDataUsageReport(
  db: ApiDatabase,
  input: Parameters<typeof listRootOrganizations>[1],
) {
  return db.transaction(async (tx) => {
    const page = await listRootOrganizations(tx, input);
    const usage = await loadOrganizationsDataUsage(
      tx,
      page.organizations.map((org) => org.organizationId),
    );
    return {
      nextAfterId: page.nextAfterId,
      organizations: page.organizations.map((organization) => {
        const dataUsage = usage.get(organization.organizationId);
        if (!dataUsage) throw new Error("Missing organization data usage");
        return { organization, dataUsage };
      }),
    };
  });
}
