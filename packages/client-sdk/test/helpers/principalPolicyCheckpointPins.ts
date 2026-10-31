import { and, eq } from "drizzle-orm";
import { principalPolicyCheckpoints } from "../../src/data/sqlite/schema";
import type { ClientSQLiteDatabase } from "../../src/data/sqlite/sqlitePersistenceRuntime";

interface TestPrincipalPolicyPin {
  readonly principalType: string;
  readonly principalId: string;
  readonly version: number;
  readonly stateHash: string;
  readonly updatedAt: string;
  readonly organizationId?: string | undefined;
}

/**
 * Writes a pin straight into the checkpoint row, keeping the owner a cache
 * write already recorded there. A principal without one takes the given
 * owner, and an organization owns itself.
 */
export async function pinPrincipalPolicyCheckpoint(
  db: ClientSQLiteDatabase,
  pin: TestPrincipalPolicyPin,
): Promise<void> {
  const [stored] = await db
    .select({ organizationId: principalPolicyCheckpoints.organizationId })
    .from(principalPolicyCheckpoints)
    .where(
      and(
        eq(principalPolicyCheckpoints.principalType, pin.principalType),
        eq(principalPolicyCheckpoints.principalId, pin.principalId),
      ),
    )
    .limit(1);
  const organizationId =
    stored?.organizationId ??
    pin.organizationId ??
    (pin.principalType === "organization" ? pin.principalId : undefined);
  if (!organizationId)
    throw new Error("Test checkpoint pin requires an owning organization");
  const row = {
    principalType: pin.principalType,
    principalId: pin.principalId,
    organizationId,
    version: pin.version,
    stateHash: pin.stateHash,
    updatedAt: pin.updatedAt,
  };
  await db
    .insert(principalPolicyCheckpoints)
    .values(row)
    .onConflictDoUpdate({
      target: [
        principalPolicyCheckpoints.principalType,
        principalPolicyCheckpoints.principalId,
      ],
      set: row,
    })
    .run();
}

/**
 * Raw-SQL form of `pinPrincipalPolicyCheckpoint`, bound as (principal_type,
 * principal_id, version, state_hash, updated_at[, owner]): it keeps a recorded
 * owner, then uses the bound one, and an organization owns itself.
 */
export const PIN_PRINCIPAL_POLICY_CHECKPOINT_SQL = `INSERT INTO principal_policy_checkpoints
  (principal_type, principal_id, organization_id, version, state_hash, updated_at)
VALUES (?1, ?2, COALESCE(
  (SELECT organization_id FROM principal_policy_checkpoints
    WHERE principal_type = ?1 AND principal_id = ?2),
  ?6,
  CASE WHEN ?1 = 'organization' THEN ?2 END
), ?3, ?4, ?5)
ON CONFLICT (principal_type, principal_id) DO UPDATE SET
  version = excluded.version,
  state_hash = excluded.state_hash,
  updated_at = excluded.updated_at`;
