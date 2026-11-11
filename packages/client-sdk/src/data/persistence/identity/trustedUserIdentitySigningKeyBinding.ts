import { and, eq } from "drizzle-orm";
import {
  trustedUserIdentityPins,
  trustedUserIdentityPinTables,
} from "../../sqlite/schema/trustedUserIdentityPinSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";

/**
 * The user a signing key is already bound to in this trust domain, if any.
 * Each key has at most one such user: the reverse binding is unique.
 */
export async function loadTrustedUserIdForSigningKey(input: {
  readonly execSql: ExecSql;
  readonly identityTrustDomain: string;
  readonly signingKeyFingerprint: string;
}): Promise<string | null> {
  await ensureSqlTables(input.execSql, trustedUserIdentityPinTables);
  const rows = await getClientSQLitePersistenceRuntime(input.execSql)
    .db.select({ userId: trustedUserIdentityPins.userId })
    .from(trustedUserIdentityPins)
    .where(
      and(
        eq(
          trustedUserIdentityPins.identityTrustDomain,
          input.identityTrustDomain,
        ),
        eq(
          trustedUserIdentityPins.signingKeyFingerprint,
          input.signingKeyFingerprint,
        ),
      ),
    )
    .limit(1);
  return rows[0]?.userId ?? null;
}
