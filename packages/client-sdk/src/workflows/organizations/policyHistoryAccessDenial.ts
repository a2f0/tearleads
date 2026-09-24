import { purgeOrganizationAccessProjection } from "../../data/persistence/organizations/organizationAccessRevocationPersistence";
import { recordOrganizationPresentationDenials } from "../../data/persistence/organizations/organizationPresentationDenialPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  denyOrganizationPresentationAccess,
  runOrganizationPresentationMutation,
} from "./organizationPresentationAccessState";

export async function denyPolicyHistoryAccess(input: {
  execSql: ExecSql;
  organizationId: string;
  requesterUserId: string;
  logError: (message: string | Error, cause?: unknown) => void;
}): Promise<void> {
  denyOrganizationPresentationAccess(input, ["readModel", "usage"]);
  try {
    await runOrganizationPresentationMutation(input.execSql, () =>
      recordOrganizationPresentationDenials(input, ["readModel", "usage"]),
    );
  } catch (error) {
    input.logError(
      "Failed to record denied organization policy history",
      error,
    );
  }
  try {
    await runOrganizationPresentationMutation(input.execSql, () =>
      purgeOrganizationAccessProjection(input),
    );
  } catch (error) {
    input.logError("Failed to purge denied organization policy history", error);
  }
}
