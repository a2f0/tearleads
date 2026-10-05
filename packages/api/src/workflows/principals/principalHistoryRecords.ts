import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { PrincipalHistoryVerificationKind } from "@tearleads/api-shared/schema";
import {
  normalizePrincipalContainerGrants,
  normalizePrincipalProjectionMembers,
  type PrincipalPolicyStateChainEntry,
  type ReferencedPrincipalHead,
  serializeUnsignedPrincipalState,
  toFingerprint,
} from "@tearleads/crypto";
import { readPrincipalHistoryPage } from "../../access/read/principalHistoryProgress";
import { canonicalJsonEquals } from "../../utils/canonicalJson";
import { loadSignerPublicKey } from "../signerPublicKey";
import { PrincipalPolicyError, toPrincipalStateResponse } from "./shared";

export function principalHistoryHead(
  head: ReferencedPrincipalHead,
): ReferencedPrincipalHead {
  return {
    principalType: head.principalType,
    principalId: head.principalId,
    version: head.version,
    keyEpoch: head.keyEpoch,
    stateHash: head.stateHash,
    keyFingerprint: head.keyFingerprint,
  };
}

export function principalHistoryError(
  kind: PrincipalHistoryVerificationKind,
  message: string,
): PrincipalPolicyError {
  const label = kind === "authority" ? "external admin" : "principal";
  return new PrincipalPolicyError(
    `Stored ${label} policy failed integrity verification: ${message}`,
    409,
  );
}

export async function readPrincipalHistoryEntry(
  executor: DatabaseSession,
  scope: Pick<ReferencedPrincipalHead, "principalType" | "principalId">,
  version: number,
  kind: PrincipalHistoryVerificationKind,
): Promise<PrincipalPolicyStateChainEntry> {
  const [entry] = await readPrincipalHistoryPage(executor, {
    ...scope,
    afterVersion: version - 1,
    throughVersion: version,
  });
  if (!entry)
    throw principalHistoryError(kind, "principal history entry is missing");
  return {
    state: toPrincipalStateResponse(entry.state),
    projection: entry.projection.map(({ userId, role }) => ({ userId, role })),
    grants: entry.grants.map(({ containerId, accessLevel }) => ({
      containerId,
      accessLevel,
    })),
  };
}

export async function principalHistorySigner(
  executor: DatabaseSession,
  entry: PrincipalPolicyStateChainEntry,
  kind: PrincipalHistoryVerificationKind,
) {
  const { signerUserId, signerUserKeyFingerprint } = entry.state;
  const signingPublicKey = await loadSignerPublicKey(executor, {
    userId: signerUserId,
    fingerprint: signerUserKeyFingerprint,
    error: () =>
      principalHistoryError(
        kind,
        "principal policy signer is missing or inconsistent",
      ),
  });
  if ((await toFingerprint(signingPublicKey)) !== signerUserKeyFingerprint)
    throw principalHistoryError(
      kind,
      "principal policy signer key fingerprint does not match public key",
    );
  return {
    userId: signerUserId,
    signingKeyFingerprint: signerUserKeyFingerprint,
    signingPublicKey,
  };
}

/** A persisted prefix never licenses substituting its stored final entry. */
export async function assertPrincipalHistoryEntryUnchanged(
  executor: DatabaseSession,
  expected: PrincipalPolicyStateChainEntry,
  kind: PrincipalHistoryVerificationKind,
): Promise<void> {
  const stored = await readPrincipalHistoryEntry(
    executor,
    expected.state,
    expected.state.version,
    kind,
  );
  if (
    stored.state.stateHash !== expected.state.stateHash ||
    stored.state.signature !== expected.state.signature ||
    (await serializeUnsignedPrincipalState(stored.state)) !==
      (await serializeUnsignedPrincipalState(expected.state)) ||
    !canonicalJsonEquals(
      normalizePrincipalProjectionMembers(stored.projection),
      normalizePrincipalProjectionMembers(expected.projection),
    ) ||
    !canonicalJsonEquals(
      normalizePrincipalContainerGrants(stored.grants),
      normalizePrincipalContainerGrants(expected.grants),
    )
  )
    throw principalHistoryError(
      kind,
      "saved principal history differs from stored artifacts",
    );
  await principalHistorySigner(executor, stored, kind);
}
