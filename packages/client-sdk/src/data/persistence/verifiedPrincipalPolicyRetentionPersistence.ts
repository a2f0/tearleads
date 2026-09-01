import type { VerifiedPrincipalPolicy } from "@symcrypt/crypto";
import type { PrincipalPolicyBundleResponse } from "@symcrypt/validators/response";
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
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly updatedAt: string;
}): Promise<void> {
  await assertBundleMatchesVerifiedPolicy(input);
  await ensurePrincipalPolicyTables(input.execSql);
  const runtime = getClientSQLitePersistenceRuntime(input.execSql);
  const retain = (
    tx: Parameters<typeof retainPrincipalPolicyBundleInTransaction>[0],
  ) =>
    retainPrincipalPolicyBundleInTransaction(
      tx,
      input.bundle,
      input.updatedAt,
      input.organizationId,
    );
  if (input.stillCurrent) {
    await runtime.guardedTransaction(retain, input.stillCurrent, {
      behavior: "immediate",
    });
    return;
  }
  await runtime.transaction(retain, { behavior: "immediate" });
}
