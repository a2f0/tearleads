import { and, eq } from "drizzle-orm";
import { organizationPresentationDenials } from "../../sqlite/schema/organizationReadModelSchema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";

export type OrganizationPresentationDenialProjection = "readModel" | "usage";

export interface OrganizationPresentationDenialScope {
  readonly organizationId: string;
  readonly requesterUserId: string;
}

export async function clearOrganizationPresentationDenialInTransaction(input: {
  readonly organizationId: string;
  readonly projection: OrganizationPresentationDenialProjection;
  readonly requesterUserId: string;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  await input.tx
    .delete(organizationPresentationDenials)
    .where(
      and(
        eq(
          organizationPresentationDenials.organizationId,
          input.organizationId,
        ),
        eq(
          organizationPresentationDenials.requesterUserId,
          input.requesterUserId,
        ),
        eq(organizationPresentationDenials.projection, input.projection),
      ),
    )
    .run();
}
