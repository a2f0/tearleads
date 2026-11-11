import { and, eq, inArray } from "drizzle-orm";
import {
  trustedUserIdentityPins,
  trustedUserIdentityPinTables,
} from "../../sqlite/schema/trustedUserIdentityPinSchema";
import { sqliteRowsPerStatement } from "../../sqlite/sqliteBindBudget";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import {
  parseStoredPin,
  type TrustedUserIdentityPin,
} from "../trustedUserIdentityPinPersistence";
import { runTrustedUserIdentityPinTransaction } from "../trustedUserIdentityPinTransaction";

// Each member binds one ID; the trust domain binds once per statement.
const PIN_READ_BATCH_SIZE = sqliteRowsPerStatement(1, 1);

/** Read immutable pins together, never exposing another adapter's uncommitted rows. */
export async function loadTrustedUserIdentityPins(input: {
  readonly execSql: ExecSql;
  readonly identityTrustDomain: string;
  readonly userIds: readonly string[];
}): Promise<ReadonlyMap<string, TrustedUserIdentityPin>> {
  const userIds = [...new Set(input.userIds)];
  if (userIds.length === 0) return new Map();
  await ensureSqlTables(input.execSql, trustedUserIdentityPinTables);
  const runtime = getClientSQLitePersistenceRuntime(input.execSql);
  return runTrustedUserIdentityPinTransaction(() =>
    runtime.transaction(async (tx) => {
      const pins = new Map<string, TrustedUserIdentityPin>();
      for (
        let start = 0;
        start < userIds.length;
        start += PIN_READ_BATCH_SIZE
      ) {
        const batch = userIds.slice(start, start + PIN_READ_BATCH_SIZE);
        const rows = await tx
          .select()
          .from(trustedUserIdentityPins)
          .where(
            and(
              eq(
                trustedUserIdentityPins.identityTrustDomain,
                input.identityTrustDomain,
              ),
              inArray(trustedUserIdentityPins.userId, batch),
            ),
          );
        for (const row of rows) {
          const pin = parseStoredPin(row, {
            identityTrustDomain: input.identityTrustDomain,
            userId: row.userId,
          });
          pins.set(pin.userId, pin);
        }
      }
      return pins;
    }),
  );
}
