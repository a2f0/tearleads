import { KeyingVerificationError } from "@tearleads/crypto";
import type {
  PrincipalPolicyBundleResponse,
  PrincipalStateResponse,
} from "@tearleads/validators/response";
import { isPrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { and, eq, or } from "drizzle-orm";
import { principalPolicyBundles } from "../../sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import { storedPrincipalPolicyPin } from "../keyingCheckpoints/keyingCheckpointPersistence";
import {
  recordPrincipalPolicyBundleOrganizationInTransaction,
  recordPrincipalPolicyOrganizationInTransaction,
} from "../keyingCheckpoints/principalPolicyOrganizationPersistence";
import { assertSameHeadPrincipalPolicyBundle } from "./principalPolicyBundleIntegrity";
import { indexPrincipalPolicyBundleInTransaction } from "./principalPolicyReferenceIndexPersistence";
import { storedPrincipalPolicyBundleFromJson } from "./storedPrincipalPolicyBundle";

interface PrincipalPolicyRow {
  principalType: "group" | "organization";
  principalId: string;
  stateHash: string;
  currentStateJson: string;
  currentPayloadJson: string;
  currentProjectionJson: string;
  currentGrantsJson: string;
  currentMemberEnvelopesJson: string;
  previousStatesJson: string;
  updatedAt: string;
}

export interface SelectedPrincipalPolicyRow {
  principalType: string;
  principalId: string;
  stateHash: string;
  isCurrent: boolean;
  currentStateJson: string;
  currentPayloadJson: string;
  currentProjectionJson: string;
  currentGrantsJson: string;
  currentMemberEnvelopesJson: string;
  previousStatesJson: string;
  updatedAt: string;
}

interface StoredPrincipalPolicyHead {
  readonly stateHash: string;
  readonly version: number;
}

function isManagedPrincipalType(
  value: string,
): value is PrincipalStateResponse["principalType"] {
  return value === "group" || value === "organization";
}

function parsePrincipalPolicyRow(
  row: SelectedPrincipalPolicyRow,
): PrincipalPolicyRow | null {
  if (!isManagedPrincipalType(row.principalType)) {
    return null;
  }

  return {
    principalType: row.principalType,
    principalId: row.principalId,
    stateHash: row.stateHash,
    currentStateJson: row.currentStateJson,
    currentPayloadJson: row.currentPayloadJson,
    currentProjectionJson: row.currentProjectionJson,
    currentGrantsJson: row.currentGrantsJson,
    currentMemberEnvelopesJson: row.currentMemberEnvelopesJson,
    previousStatesJson: row.previousStatesJson,
    updatedAt: row.updatedAt,
  };
}

function parseStoredPrincipalPolicyHead(
  currentStateJson: string,
): StoredPrincipalPolicyHead | null {
  try {
    const value: unknown = JSON.parse(currentStateJson);
    if (!value || typeof value !== "object") {
      return null;
    }
    const stateHash = Reflect.get(value, "stateHash");
    const version = Reflect.get(value, "version");
    return typeof stateHash === "string" && typeof version === "number"
      ? { stateHash, version }
      : null;
  } catch {
    return null;
  }
}

function parsePrincipalPolicyBundle(
  row: PrincipalPolicyRow,
): PrincipalPolicyBundleResponse {
  const bundle = storedPrincipalPolicyBundleFromJson(row);

  if (!isPrincipalPolicyBundleResponse(bundle)) {
    throw new Error("Stored principal policy bundle is invalid");
  }

  return bundle;
}

/** A selected row's bundle; null when the row is not a managed principal. */
export function parseSelectedPrincipalPolicyBundle(
  row: SelectedPrincipalPolicyRow,
): PrincipalPolicyBundleResponse | null {
  const parsed = parsePrincipalPolicyRow(row);
  return parsed ? parsePrincipalPolicyBundle(parsed) : null;
}

/** The ONE select shape for a stored principal-policy bundle row. */
export const principalPolicyBundleSelection = {
  principalType: principalPolicyBundles.principalType,
  principalId: principalPolicyBundles.principalId,
  stateHash: principalPolicyBundles.stateHash,
  isCurrent: principalPolicyBundles.isCurrent,
  currentStateJson: principalPolicyBundles.currentStateJson,
  currentPayloadJson: principalPolicyBundles.currentPayloadJson,
  currentProjectionJson: principalPolicyBundles.currentProjectionJson,
  currentGrantsJson: principalPolicyBundles.currentGrantsJson,
  currentMemberEnvelopesJson: principalPolicyBundles.currentMemberEnvelopesJson,
  previousStatesJson: principalPolicyBundles.previousStatesJson,
  updatedAt: principalPolicyBundles.updatedAt,
};

/** Every stored bundle of one principal. */
export function wherePrincipalPolicyBundlePrincipal(principal: {
  readonly principalType: string;
  readonly principalId: string;
}) {
  return and(
    eq(principalPolicyBundles.principalType, principal.principalType),
    eq(principalPolicyBundles.principalId, principal.principalId),
  );
}

/** The one current head of a principal. */
export function wherePrincipalPolicyCurrent(principal: {
  readonly principalType: string;
  readonly principalId: string;
}) {
  return and(
    wherePrincipalPolicyBundlePrincipal(principal),
    eq(principalPolicyBundles.isCurrent, true),
  );
}

function wherePrincipalPolicyBundle(row: {
  readonly principalType: string;
  readonly principalId: string;
  readonly stateHash: string;
}) {
  return and(
    wherePrincipalPolicyBundlePrincipal(row),
    eq(principalPolicyBundles.stateHash, row.stateHash),
  );
}

/** A principal's current head and its retained bundle at `row`'s exact hash, in one read. */
async function loadCurrentAndRetainedPolicyBundles(
  tx: ClientSQLiteTransactionScope,
  row: PrincipalPolicyRow,
) {
  const rows = await tx
    .select(principalPolicyBundleSelection)
    .from(principalPolicyBundles)
    .where(
      and(
        wherePrincipalPolicyBundlePrincipal(row),
        or(
          eq(principalPolicyBundles.isCurrent, true),
          eq(principalPolicyBundles.stateHash, row.stateHash),
        ),
      ),
    );
  return {
    current: rows.find((stored) => stored.isCurrent),
    retained: rows.find(
      (stored) => !stored.isCurrent && stored.stateHash === row.stateHash,
    ),
  };
}

function policyBundleRow(
  bundle: PrincipalPolicyBundleResponse,
  updatedAt: string,
): PrincipalPolicyRow {
  return {
    principalType: bundle.currentState.principalType,
    principalId: bundle.currentState.principalId,
    stateHash: bundle.currentState.stateHash,
    currentStateJson: JSON.stringify(bundle.currentState),
    currentPayloadJson: JSON.stringify(bundle.currentPayload),
    currentProjectionJson: JSON.stringify(bundle.currentProjection),
    currentGrantsJson: JSON.stringify(bundle.currentGrants),
    currentMemberEnvelopesJson: JSON.stringify(bundle.currentMemberEnvelopes),
    previousStatesJson: JSON.stringify(bundle.previousStates),
    updatedAt,
  };
}

function assertNoHeadConflict(
  incoming: StoredPrincipalPolicyHead,
  checkpoint: StoredPrincipalPolicyHead | null,
): void {
  if (
    checkpoint &&
    incoming.version === checkpoint.version &&
    incoming.stateHash !== checkpoint.stateHash
  ) {
    throw new KeyingVerificationError(
      "equivocation",
      "principal policy bundle conflicts with the cached head at one version",
    );
  }
}

/**
 * The replaced head stays as a retained bundle when it is an older valid
 * bundle; a corrupt cache row is dropped, never retained as key material.
 */
async function retirePrincipalPolicyHead(
  tx: ClientSQLiteTransactionScope,
  storedPolicy: SelectedPrincipalPolicyRow | undefined,
  storedHead: StoredPrincipalPolicyHead | null,
  incomingHead: StoredPrincipalPolicyHead,
): Promise<void> {
  if (!storedPolicy) {
    return;
  }
  const where = wherePrincipalPolicyBundle(storedPolicy);
  if (isRetainablePolicyHead(storedPolicy, storedHead, incomingHead)) {
    await tx
      .update(principalPolicyBundles)
      .set({ isCurrent: false })
      .where(where)
      .run();
    return;
  }
  await tx.delete(principalPolicyBundles).where(where).run();
}

function isRetainablePolicyHead(
  storedPolicy: SelectedPrincipalPolicyRow,
  storedHead: StoredPrincipalPolicyHead | null,
  incomingHead: StoredPrincipalPolicyHead,
): boolean {
  if (!storedHead || storedHead.version >= incomingHead.version) {
    return false;
  }
  const row = parsePrincipalPolicyRow(storedPolicy);
  if (!row) {
    return false;
  }
  try {
    parsePrincipalPolicyBundle(row);
    return true;
  } catch {
    return false;
  }
}

async function writePrincipalPolicyBundle(
  tx: ClientSQLiteTransactionScope,
  bundle: PrincipalPolicyBundleResponse,
  nextRow: PrincipalPolicyRow,
  incomingHead: StoredPrincipalPolicyHead,
  durablePin: Awaited<
    ReturnType<typeof recordPrincipalPolicyBundleOrganizationInTransaction>
  >,
): Promise<void> {
  const { current: storedPolicy, retained: retainedPolicy } =
    await loadCurrentAndRetainedPolicyBundles(tx, nextRow);
  const durableCheckpoint = durablePin
    ? storedPrincipalPolicyPin(durablePin)
    : null;
  const storedHead = storedPolicy
    ? parseStoredPrincipalPolicyHead(storedPolicy.currentStateJson)
    : null;
  if (
    storedPolicy &&
    storedHead?.version === incomingHead.version &&
    storedHead.stateHash === incomingHead.stateHash
  ) {
    assertSameHeadPrincipalPolicyBundle(storedPolicy, nextRow);
    await indexPrincipalPolicyBundleInTransaction(tx, bundle);
    return;
  }
  if (retainedPolicy) {
    assertSameHeadPrincipalPolicyBundle(retainedPolicy, nextRow);
    await indexPrincipalPolicyBundleInTransaction(tx, bundle);
  }
  const effectiveHead =
    durableCheckpoint &&
    (!storedHead || durableCheckpoint.version >= storedHead.version)
      ? durableCheckpoint
      : storedHead;
  assertNoHeadConflict(incomingHead, storedHead);
  assertNoHeadConflict(incomingHead, durableCheckpoint ?? null);
  if (effectiveHead && incomingHead.version < effectiveHead.version) {
    return;
  }

  // Promotion flips the head flag; a retained row at this hash becomes current.
  await retirePrincipalPolicyHead(tx, storedPolicy, storedHead, incomingHead);
  const currentRow = { ...nextRow, isCurrent: true };
  await tx
    .insert(principalPolicyBundles)
    .values(currentRow)
    .onConflictDoUpdate({
      target: [
        principalPolicyBundles.principalType,
        principalPolicyBundles.principalId,
        principalPolicyBundles.stateHash,
      ],
      set: currentRow,
    })
    .run();
  await indexPrincipalPolicyBundleInTransaction(tx, bundle);
}

export async function writePrincipalPolicyBundleInTransaction(
  tx: ClientSQLiteTransactionScope,
  bundle: PrincipalPolicyBundleResponse,
  updatedAt: string,
  organizationId?: string | undefined,
): Promise<void> {
  const durableCheckpoint =
    await recordPrincipalPolicyBundleOrganizationInTransaction(
      tx,
      bundle,
      organizationId,
    );
  await writePrincipalPolicyBundle(
    tx,
    bundle,
    policyBundleRow(bundle, updatedAt),
    bundle.currentState,
    durableCheckpoint,
  );
}

export async function assertPrincipalPolicyBundleStoredInTransaction(
  tx: ClientSQLiteTransactionScope,
  bundle: PrincipalPolicyBundleResponse,
): Promise<void> {
  const expected = policyBundleRow(bundle, bundle.currentState.createdAt);
  const [stored] = await tx
    .select(principalPolicyBundleSelection)
    .from(principalPolicyBundles)
    .where(wherePrincipalPolicyCurrent(expected))
    .limit(1);
  if (!stored) {
    throw new Error("Verified principal policy bundle was not persisted");
  }
  assertSameHeadPrincipalPolicyBundle(stored, expected);
}

export async function retainPrincipalPolicyBundleInTransaction(
  tx: ClientSQLiteTransactionScope,
  bundle: PrincipalPolicyBundleResponse,
  updatedAt: string,
  organizationId?: string | undefined,
): Promise<void> {
  const row = policyBundleRow(bundle, updatedAt);
  await recordPrincipalPolicyOrganizationInTransaction(tx, {
    organizationId,
    principalId: row.principalId,
    principalType: row.principalType,
  });
  const { current, retained } = await loadCurrentAndRetainedPolicyBundles(
    tx,
    row,
  );
  const stored = current?.stateHash === row.stateHash ? current : retained;
  if (stored) {
    assertSameHeadPrincipalPolicyBundle(stored, row);
    await indexPrincipalPolicyBundleInTransaction(tx, bundle);
    return;
  }
  await tx
    .insert(principalPolicyBundles)
    .values({ ...row, isCurrent: false })
    .run();
  await indexPrincipalPolicyBundleInTransaction(tx, bundle);
}
