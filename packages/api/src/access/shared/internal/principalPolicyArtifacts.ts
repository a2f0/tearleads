import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  principalMemberEnvelopes,
  principalStatePayloads,
} from "@tearleads/api-shared/schema";
import type {
  ManagedRecipientPrincipalType,
  PrincipalStateMemberEnvelope,
  PrincipalStatePayloadCipherSuite,
} from "@tearleads/crypto";
import { compareCanonicalStrings } from "@tearleads/crypto";
import { and, eq, sql } from "drizzle-orm";
import type { StoredPrincipalStatePayload } from "./principalStateRecords";

async function readPrincipalPolicyArtifactRows(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  stateHash: string,
  executor: DatabaseSession,
) {
  const emptyText = sql<string | null>`null`;
  return executor
    .select({
      kind: sql<"payload" | "envelope">`'payload'`,
      cipherSuite: sql<PrincipalStatePayloadCipherSuite | null>`${principalStatePayloads.cipherSuite}`,
      ciphertext: sql<string | null>`${principalStatePayloads.ciphertext}`,
      ciphertextHash: sql<
        string | null
      >`${principalStatePayloads.ciphertextHash}`,
      createdAt: principalStatePayloads.createdAt,
      userId: emptyText,
      memberKeyFingerprint: emptyText,
      kemCipherText: emptyText,
      wrappedKey: emptyText,
    })
    .from(principalStatePayloads)
    .where(
      and(
        eq(principalStatePayloads.principalType, principalType),
        eq(principalStatePayloads.principalId, principalId),
        eq(principalStatePayloads.stateHash, stateHash),
      ),
    )
    .unionAll(
      executor
        .select({
          kind: sql<"payload" | "envelope">`'envelope'`,
          cipherSuite: sql<PrincipalStatePayloadCipherSuite | null>`null`,
          ciphertext: emptyText,
          ciphertextHash: emptyText,
          createdAt: principalMemberEnvelopes.createdAt,
          userId: sql<string | null>`${principalMemberEnvelopes.userId}`,
          memberKeyFingerprint: sql<
            string | null
          >`${principalMemberEnvelopes.memberKeyFingerprint}`,
          kemCipherText: sql<
            string | null
          >`${principalMemberEnvelopes.kemCipherText}`,
          wrappedKey: sql<
            string | null
          >`${principalMemberEnvelopes.wrappedKey}`,
        })
        .from(principalMemberEnvelopes)
        .where(
          and(
            eq(principalMemberEnvelopes.principalType, principalType),
            eq(principalMemberEnvelopes.principalId, principalId),
            eq(principalMemberEnvelopes.stateHash, stateHash),
          ),
        ),
    );
}

/** Read both current artifacts without repeating the payload for every member. */
export async function getPrincipalPolicyArtifactsForState(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  stateHash: string,
  executor: DatabaseSession,
): Promise<{
  payload: StoredPrincipalStatePayload | null;
  memberEnvelopes: PrincipalStateMemberEnvelope[];
}> {
  const rows = await readPrincipalPolicyArtifactRows(
    principalType,
    principalId,
    stateHash,
    executor,
  );
  let payload: StoredPrincipalStatePayload | null = null;
  const memberEnvelopes: PrincipalStateMemberEnvelope[] = [];
  for (const row of rows) {
    if (row.kind === "payload") {
      const { cipherSuite, ciphertext, ciphertextHash, createdAt } = row;
      if (
        cipherSuite === null ||
        ciphertext === null ||
        ciphertextHash === null
      )
        throw new Error("Stored principal payload is invalid");
      payload = {
        principalType,
        principalId,
        stateHash,
        cipherSuite,
        ciphertext,
        ciphertextHash,
        createdAt,
      };
    } else {
      const { userId, memberKeyFingerprint, kemCipherText, wrappedKey } = row;
      if (
        userId === null ||
        memberKeyFingerprint === null ||
        kemCipherText === null ||
        wrappedKey === null
      )
        throw new Error("Stored principal member envelope is invalid");
      memberEnvelopes.push({
        userId,
        memberKeyFingerprint,
        kemCipherText,
        wrappedKey,
      });
    }
  }
  memberEnvelopes.sort((a, b) => compareCanonicalStrings(a.userId, b.userId));
  return { payload, memberEnvelopes };
}
