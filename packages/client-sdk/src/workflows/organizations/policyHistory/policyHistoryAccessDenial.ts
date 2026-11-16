import { OrganizationReadModelRepository } from "../../../data/persistence/organizations/organizationReadModelRepository";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  denyOrganizationPresentationAccess,
  runOrganizationPresentationMutation,
} from "../readModel/organizationPresentationAccessState";

export async function denyPolicyHistoryAccess(input: {
  execSql: ExecSql;
  organizationId: string;
  requesterUserId: string;
  logError: (message: string | Error, cause?: unknown) => void;
}): Promise<void> {
  denyOrganizationPresentationAccess(input, ["readModel", "usage"]);
  const repository = new OrganizationReadModelRepository(input.execSql);
  try {
    await runOrganizationPresentationMutation(input.execSql, () =>
      repository.recordOrganizationPresentationDenials(input, [
        "readModel",
        "usage",
      ]),
    );
  } catch (error) {
    input.logError(
      "Failed to record denied organization policy history",
      error,
    );
  }
  try {
    await runOrganizationPresentationMutation(input.execSql, () =>
      repository.purgeOrganizationAccessProjection(input),
    );
  } catch (error) {
    input.logError("Failed to purge denied organization policy history", error);
  }
}
