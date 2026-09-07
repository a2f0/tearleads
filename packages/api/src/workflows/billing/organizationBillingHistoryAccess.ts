import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { withOrganizationAdminTransaction } from "../organizations/mutationAccess";
import { loadOrganizationBillingHistory } from "./organizationBillingHistory";

export function runGetOrganizationBillingHistoryWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
) {
  return withOrganizationAdminTransaction(
    db,
    { organizationId, userId: sessionUserId },
    (tx) => loadOrganizationBillingHistory(tx, organizationId),
  );
}
