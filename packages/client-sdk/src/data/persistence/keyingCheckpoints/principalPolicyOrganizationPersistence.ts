import { KeyingVerificationError } from "@tearleads/crypto";
import type { PrincipalStateResponse } from "@tearleads/validators/response";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { principalPolicyCheckpoints } from "../../sqlite/schema";
import { sqliteInsertBatchSize } from "../../sqlite/sqliteBindBudget";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import { excludedValue } from "../../sqlite/sqliteUpsert";

interface PrincipalPolicyOrganizationInput {
  readonly organizationId?: string | undefined;
  readonly principalId: string;
  readonly principalType: PrincipalStateResponse["principalType"];
}

/** The pin a checkpoint row carries; all null records ownership alone. */
interface PrincipalPolicyPinColumns {
  readonly version: number | null;
  readonly stateHash: string | null;
  readonly updatedAt: string | null;
}

type PrincipalPolicyOwnedRow = PrincipalPolicyPinColumns & {
  readonly organizationId: string;
  readonly principalId: string;
  readonly principalType: PrincipalStateResponse["principalType"];
};

const OWNED_ROW_WRITE_BATCH_SIZE = sqliteInsertBatchSize(
  principalPolicyCheckpoints,
);

function resolveOrganizationId(
  input: PrincipalPolicyOrganizationInput,
): string {
  if (input.principalType === "organization") {
    if (
      input.organizationId !== undefined &&
      input.organizationId !== input.principalId
    ) {
      throw new KeyingVerificationError(
        "object_mismatch",
        "organization policy cache ownership targets another organization",
      );
    }
    return input.principalId;
  }
  if (!input.organizationId) {
    throw new Error("Group policy cache writes require an organization ID");
  }
  return input.organizationId;
}

function ownedRowKey(row: {
  readonly principalId: string;
  readonly principalType: string;
}): string {
  return JSON.stringify([row.principalType, row.principalId]);
}

function slices<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

/**
 * A pin replaces the stored one only when it is newer, or repeats it exactly:
 * whatever a caller checked, a write can never regress or fork a pin.
 */
const pinAdvances = or(
  isNull(principalPolicyCheckpoints.version),
  gt(
    excludedValue(principalPolicyCheckpoints.version),
    principalPolicyCheckpoints.version,
  ),
  and(
    eq(
      excludedValue(principalPolicyCheckpoints.version),
      principalPolicyCheckpoints.version,
    ),
    eq(
      excludedValue(principalPolicyCheckpoints.stateHash),
      principalPolicyCheckpoints.stateHash,
    ),
  ),
);

const sameOwner = eq(
  principalPolicyCheckpoints.organizationId,
  excludedValue(principalPolicyCheckpoints.organizationId),
);

/** Names why the stored row refused `row`'s write. */
async function refusedWrite(
  tx: ClientSQLiteTransactionScope,
  row: PrincipalPolicyOwnedRow,
): Promise<KeyingVerificationError> {
  const [stored] = await tx
    .select({ organizationId: principalPolicyCheckpoints.organizationId })
    .from(principalPolicyCheckpoints)
    .where(
      and(
        eq(principalPolicyCheckpoints.principalType, row.principalType),
        eq(principalPolicyCheckpoints.principalId, row.principalId),
      ),
    );
  return stored && stored.organizationId === row.organizationId
    ? new KeyingVerificationError(
        "rollback",
        "principal policy pin would regress or fork the stored pin",
      )
    : new KeyingVerificationError(
        "object_mismatch",
        "principal policy cache is already owned by another organization",
      );
}

/**
 * Inserts each row, or updates it only where the stored row has the same
 * owner and, for a pin, only where the pin advances; refuses when any row is
 * owned by another organization or would regress or fork its stored pin.
 * The refused row's statement changes nothing, and the caller's transaction
 * rolls back whatever came before it. An ownership-only write never clears a
 * stored pin.
 */
async function writeOwnedRows(
  tx: ClientSQLiteTransactionScope,
  rows: readonly PrincipalPolicyOwnedRow[],
  pinned: boolean,
): Promise<void> {
  const written = new Set<string>();
  for (const batch of slices(rows, OWNED_ROW_WRITE_BATCH_SIZE)) {
    const returned = await tx
      .insert(principalPolicyCheckpoints)
      .values(batch)
      .onConflictDoUpdate({
        target: [
          principalPolicyCheckpoints.principalType,
          principalPolicyCheckpoints.principalId,
        ],
        set: pinned
          ? {
              version: excludedValue(principalPolicyCheckpoints.version),
              stateHash: excludedValue(principalPolicyCheckpoints.stateHash),
              updatedAt: excludedValue(principalPolicyCheckpoints.updatedAt),
            }
          : {
              organizationId: excludedValue(
                principalPolicyCheckpoints.organizationId,
              ),
            },
        setWhere: pinned
          ? (and(sameOwner, pinAdvances) ?? sameOwner)
          : sameOwner,
      })
      .returning({
        principalId: principalPolicyCheckpoints.principalId,
        principalType: principalPolicyCheckpoints.principalType,
      });
    for (const row of returned) written.add(ownedRowKey(row));
  }
  const refused = rows.find((row) => !written.has(ownedRowKey(row)));
  if (refused) throw await refusedWrite(tx, refused);
}

/**
 * Resolves each input's owner in order, writes the rows before the first
 * input that fails to resolve, and only then throws that failure: an earlier
 * input owned by another organization refuses first, as a per-row loop did.
 */
async function writeResolvedRows(
  tx: ClientSQLiteTransactionScope,
  inputs: readonly (PrincipalPolicyOrganizationInput &
    PrincipalPolicyPinColumns)[],
  pinned: boolean,
): Promise<void> {
  // A repeated principal keeps its last pin, as sequential upserts would.
  const rows = new Map<string, PrincipalPolicyOwnedRow>();
  let failure: { readonly error: unknown } | null = null;
  for (const input of inputs) {
    let organizationId: string;
    try {
      organizationId = resolveOrganizationId(input);
    } catch (error) {
      failure = { error };
      break;
    }
    rows.set(ownedRowKey(input), {
      principalType: input.principalType,
      principalId: input.principalId,
      organizationId,
      version: input.version,
      stateHash: input.stateHash,
      updatedAt: input.updatedAt,
    });
  }
  await writeOwnedRows(tx, [...rows.values()], pinned);
  if (failure) throw failure.error;
}

/** Pins cache ownership in the same transaction as the cached policy state. */
export async function recordPrincipalPolicyOrganizationInTransaction(
  tx: ClientSQLiteTransactionScope,
  input: PrincipalPolicyOrganizationInput,
): Promise<void> {
  await writeResolvedRows(
    tx,
    [{ ...input, version: null, stateHash: null, updatedAt: null }],
    false,
  );
}

export function recordPrincipalPolicyBundleOrganizationInTransaction(
  tx: ClientSQLiteTransactionScope,
  bundle: { readonly currentState: PrincipalStateResponse },
  organizationId?: string | undefined,
): Promise<void> {
  return recordPrincipalPolicyOrganizationInTransaction(tx, {
    organizationId,
    principalId: bundle.currentState.principalId,
    principalType: bundle.currentState.principalType,
  });
}

/**
 * Records each checkpoint's owner and pin in one upsert per batch: a principal
 * owned by another organization is refused, and the first input that cannot
 * name its owner fails once the inputs before it were checked.
 */
export async function writePrincipalPolicyCheckpointRowsInTransaction(
  tx: ClientSQLiteTransactionScope,
  checkpoints: readonly {
    readonly principalId: string;
    readonly principalType: PrincipalStateResponse["principalType"];
    readonly version: number;
    readonly stateHash: string;
  }[],
  updatedAt: string,
  organizationId: string | undefined,
): Promise<void> {
  if (checkpoints.length === 0) return;
  await writeResolvedRows(
    tx,
    checkpoints.map((checkpoint) => ({
      organizationId,
      principalType: checkpoint.principalType,
      principalId: checkpoint.principalId,
      version: checkpoint.version,
      stateHash: checkpoint.stateHash,
      updatedAt,
    })),
    true,
  );
}

/** Every principal's durable owner, pinned or not; remote reset keeps them all. */
export function listPrincipalPolicyOwners(
  tx: ClientSQLiteTransactionScope,
): Promise<
  { organizationId: string; principalId: string; principalType: string }[]
> {
  return tx
    .select({
      organizationId: principalPolicyCheckpoints.organizationId,
      principalId: principalPolicyCheckpoints.principalId,
      principalType: principalPolicyCheckpoints.principalType,
    })
    .from(principalPolicyCheckpoints);
}
