import type { VerifiedPrincipalPolicy } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../sqlite/sqlSchema";
import {
  ensurePrincipalPolicyTables,
  retainPrincipalPolicyBundleInTransaction,
} from "./principalPolicyPersistence";
import { assertBundleMatchesVerifiedPolicy } from "./verifiedPrincipalPolicyBundle";

/** Retains a just-verified epoch without promoting it to the mutable head. */
export async function retainVerifiedPrincipalPolicyBundle(input: {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly execSql: ExecSql;
  readonly organizationId?: string | undefined;
  readonly policy: VerifiedPrincipalPolicy;
  readonly updatedAt: string;
}): Promise<void> {
  await assertBundleMatchesVerifiedPolicy(input);
  await ensurePrincipalPolicyTables(input.execSql);
  await getClientSQLitePersistenceRuntime(input.execSql).transaction(
    (tx) =>
      retainPrincipalPolicyBundleInTransaction(
        tx,
        input.bundle,
        input.updatedAt,
        input.organizationId,
      ),
    { behavior: "immediate" },
  );
}
