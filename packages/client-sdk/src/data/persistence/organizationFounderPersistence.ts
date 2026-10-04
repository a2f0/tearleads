import {
  type AnyVerifiedPrincipalPolicy,
  KeyingVerificationError,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { organizationFounders } from "../sqlite/organizationFounderSchema";
import { keyingCheckpointTables } from "../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../sqlite/sqlSchema";

function assertSameFounder(
  stored: typeof organizationFounders.$inferSelect,
  founder: typeof organizationFounders.$inferInsert,
): void {
  if (
    stored.userId !== founder.userId ||
    stored.signingKeyFingerprint !== founder.signingKeyFingerprint ||
    stored.genesisStateHash !== founder.genesisStateHash
  )
    throw new KeyingVerificationError(
      "equivocation",
      "Organization founder conflicts with its durable genesis binding",
    );
}

export async function loadOrganizationFounder(
  execSql: ExecSql,
  organizationId: string,
): Promise<typeof organizationFounders.$inferSelect | null> {
  await ensureSqlTables(execSql, keyingCheckpointTables);
  const runtime = getClientSQLitePersistenceRuntime(execSql);
  const [stored] = await runtime.db
    .select()
    .from(organizationFounders)
    .where(eq(organizationFounders.organizationId, organizationId))
    .limit(1);
  return stored ?? null;
}

/** Pin verified genesis, never a later administrator or a folder's creator. */
export async function rememberOrganizationFounder(input: {
  readonly execSql: ExecSql;
  readonly organization: AnyVerifiedPrincipalPolicy;
}): Promise<void> {
  const genesis = input.organization.history?.find(
    ({ state }) => state.version === 1,
  )?.state;
  if (
    genesis?.principalType !== "organization" ||
    genesis.prevStateHash !== null
  )
    throw new KeyingVerificationError(
      "missing_dependency",
      "Organization founder requires verified genesis",
    );
  const founder = {
    organizationId: genesis.principalId,
    userId: genesis.signerUserId,
    signingKeyFingerprint: genesis.signerUserKeyFingerprint,
    genesisStateHash: genesis.stateHash,
  };
  const held = await loadOrganizationFounder(
    input.execSql,
    founder.organizationId,
  );
  if (held) {
    assertSameFounder(held, founder);
    return;
  }
  const runtime = getClientSQLitePersistenceRuntime(input.execSql);
  await runtime.transaction(
    async (tx) => {
      const [stored] = await tx
        .select()
        .from(organizationFounders)
        .where(eq(organizationFounders.organizationId, founder.organizationId))
        .limit(1);
      if (stored) {
        assertSameFounder(stored, founder);
        return;
      }
      await tx
        .insert(organizationFounders)
        .values(founder)
        .onConflictDoNothing()
        .run();
    },
    { behavior: "immediate" },
  );
}
