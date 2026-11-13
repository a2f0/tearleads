import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  principalMemberEnvelopes,
  principalMembershipProjection,
  principalStatePayloads,
  principalStates,
} from "@tearleads/api-shared/schema";
import {
  compareCanonicalStrings,
  type ManagedRecipientPrincipalType,
  type PrincipalProjectionRole,
  type PrincipalStatePayloadCipherSuite,
} from "@tearleads/crypto";
import { and, eq, type GetColumnData, type SQL, sql } from "drizzle-orm";
import {
  type PrincipalPolicyArtifactRead,
  principalPolicyArtifactsFromRows,
} from "./principalPolicyArtifacts";
import {
  principalStateSelect,
  readStoredPrincipalContainerGrants,
  type StoredPrincipalStateChainEntry,
  toStoredPrincipalState,
  toStoredProjectionMember,
} from "./principalStateRecords";

// The kind discriminator determines which columns are populated. Preserve the
// state branch's column decoders (notably dates and JSON) in the compound read.
const emptyState: {
  [K in keyof typeof principalStateSelect]: SQL<
    GetColumnData<(typeof principalStateSelect)[K]>
  >;
} = {
  principalType: sql`null`,
  principalId: sql`null`,
  version: sql`null`,
  prevStateHash: sql`null`,
  keyEpoch: sql`null`,
  encapsulationPublicKey: sql`null`,
  keyFingerprint: sql`null`,
  membershipMode: sql`null`,
  membershipRoot: sql`null`,
  memberEnvelopesRoot: sql`null`,
  projectionRoot: sql`null`,
  grantRoot: sql`null`,
  payloadCiphertextHash: sql`null`,
  memberCount: sql`null`,
  grantCount: sql`null`,
  externalAuthority: sql`null`,
  signedAt: sql`null`,
  signerUserId: sql`null`,
  signerUserKeyFingerprint: sql`null`,
  signature: sql`null`,
  stateHash: sql`null`,
  createdAt: sql`null`,
};

const emptyArtifacts = {
  cipherSuite: sql<PrincipalStatePayloadCipherSuite | null>`null`,
  ciphertext: sql<string | null>`null`,
  ciphertextHash: sql<string | null>`null`,
  memberKeyFingerprint: sql<string | null>`null`,
  kemCipherText: sql<string | null>`null`,
  wrappedKey: sql<string | null>`null`,
};
type RowKind = "state" | "member" | "payload" | "envelope";

interface EntryScope {
  readonly principalType: ManagedRecipientPrincipalType;
  readonly principalId: string;
  readonly version: number;
}

function buildEntryRead(executor: DatabaseSession, input: EntryScope) {
  const scope = and(
    eq(principalStates.principalType, input.principalType),
    eq(principalStates.principalId, input.principalId),
    eq(principalStates.version, input.version),
  );
  return executor
    .select({
      kind: sql<RowKind>`'state'`,
      ...principalStateSelect,
      ...emptyArtifacts,
      containerGrants: principalStates.containerGrants,
      userId: sql<string>`null`,
      role: sql<PrincipalProjectionRole>`null`,
      identityBundleFingerprint: sql<string>`null`,
    })
    .from(principalStates)
    .where(scope)
    .unionAll(
      executor
        .select({
          kind: sql<RowKind>`'member'`,
          ...emptyState,
          ...emptyArtifacts,
          principalType: principalMembershipProjection.principalType,
          principalId: principalMembershipProjection.principalId,
          stateHash: principalMembershipProjection.stateHash,
          createdAt: principalMembershipProjection.createdAt,
          containerGrants: sql<
            typeof principalStates.$inferSelect.containerGrants
          >`null`,
          userId: principalMembershipProjection.userId,
          role: principalMembershipProjection.role,
          identityBundleFingerprint:
            principalMembershipProjection.identityBundleFingerprint,
        })
        .from(principalStates)
        .innerJoin(
          principalMembershipProjection,
          and(
            eq(
              principalMembershipProjection.principalType,
              principalStates.principalType,
            ),
            eq(
              principalMembershipProjection.principalId,
              principalStates.principalId,
            ),
            eq(
              principalMembershipProjection.stateHash,
              principalStates.stateHash,
            ),
          ),
        )
        .where(scope),
    );
}

function appendArtifactReads(
  query: ReturnType<typeof buildEntryRead>,
  executor: DatabaseSession,
  input: EntryScope,
  artifactRead: PrincipalPolicyArtifactRead,
) {
  const payload = principalStatePayloads;
  const envelope = principalMemberEnvelopes;
  query
    .unionAll(
      executor
        .select({
          kind: sql<RowKind>`'payload'`,
          ...emptyState,
          ...emptyArtifacts,
          cipherSuite: payload.cipherSuite,
          ciphertext: payload.ciphertext,
          ciphertextHash: payload.ciphertextHash,
          createdAt: payload.createdAt,
          containerGrants: sql<
            typeof principalStates.$inferSelect.containerGrants
          >`null`,
          userId: sql<string>`null`,
          role: sql<PrincipalProjectionRole>`null`,
          identityBundleFingerprint: sql<string>`null`,
        })
        .from(payload)
        .where(
          and(
            eq(payload.principalType, input.principalType),
            eq(payload.principalId, input.principalId),
            eq(payload.stateHash, artifactRead.stateHash),
          ),
        ),
    )
    .unionAll(
      executor
        .select({
          kind: sql<RowKind>`'envelope'`,
          ...emptyState,
          ...emptyArtifacts,
          memberKeyFingerprint: envelope.memberKeyFingerprint,
          kemCipherText: envelope.kemCipherText,
          wrappedKey: envelope.wrappedKey,
          createdAt: envelope.createdAt,
          containerGrants: sql<
            typeof principalStates.$inferSelect.containerGrants
          >`null`,
          userId: envelope.userId,
          role: sql<PrincipalProjectionRole>`null`,
          identityBundleFingerprint: sql<string>`null`,
        })
        .from(envelope)
        .where(
          and(
            eq(envelope.principalType, input.principalType),
            eq(envelope.principalId, input.principalId),
            eq(envelope.stateHash, artifactRead.stateHash),
          ),
        ),
    );
}

/** Single-version only: large pages keep the cheaper two-query join plan. */
export async function readPrincipalHistoryEntryRows(
  executor: DatabaseSession,
  input: EntryScope,
  artifactRead?: PrincipalPolicyArtifactRead,
): Promise<StoredPrincipalStateChainEntry[]> {
  const query = buildEntryRead(executor, input);
  if (artifactRead) appendArtifactReads(query, executor, input, artifactRead);
  const rows = await query;
  if (artifactRead)
    artifactRead.artifacts = principalPolicyArtifactsFromRows(
      input.principalType,
      input.principalId,
      artifactRead.stateHash,
      rows.flatMap((row) =>
        row.kind === "payload" || row.kind === "envelope"
          ? [{ ...row, kind: row.kind }]
          : [],
      ),
    );
  const state = rows.find((row) => row.kind === "state");
  if (!state) return [];
  return [
    {
      state: toStoredPrincipalState(state),
      grants: readStoredPrincipalContainerGrants(state.containerGrants),
      projection: rows
        .filter((row) => row.kind === "member")
        .map(toStoredProjectionMember)
        .sort((a, b) => compareCanonicalStrings(a.userId, b.userId)),
    },
  ];
}
