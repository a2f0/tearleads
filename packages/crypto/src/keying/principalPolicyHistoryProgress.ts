import type { PrincipalStateExternalAuthority } from "../principalState";
import { normalizeReferencedPrincipalHead } from "./accessEvent";
import type { normalizePrincipalHistoryInput } from "./principalPolicyHistoryChecks";
import { normalizeAuthenticatedPrincipalHistoryEntry } from "./principalPolicyHistoryProgressEntry";
import { PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT } from "./principalPolicyHistoryTypes";
import { principalPolicyStateMatchesReference } from "./principalPolicyReference";
import {
  assertExactKeys,
  readNullableHashString,
  throwVerification,
} from "./shared";
import type { NormalizedPrincipalPolicyStateChainEntry } from "./types";

export interface PrincipalHistoryProgress {
  readonly previous: NormalizedPrincipalPolicyStateChainEntry | null;
  readonly latestAuthority: PrincipalStateExternalAuthority | null;
  readonly checkpointHash: string | null;
  readonly retained: readonly NormalizedPrincipalPolicyStateChainEntry[];
}

export async function normalizeAuthenticatedPrincipalHistoryProgress(
  value: unknown,
  input: ReturnType<typeof normalizePrincipalHistoryInput>,
): Promise<PrincipalHistoryProgress> {
  const record = assertExactKeys(
    value,
    ["previous", "latestAuthority", "checkpointHash", "retained"],
    "principal history progress",
  );
  if (
    !Array.isArray(record.retained) ||
    record.retained.length > PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT
  )
    throwVerification("invalid_shape", "invalid retained principal progress");
  const previous =
    record.previous === null
      ? null
      : await normalizeAuthenticatedPrincipalHistoryEntry(record.previous);
  const checkpointHash = readNullableHashString(
    record,
    "checkpointHash",
    "principal history progress",
  );
  const authority =
    record.latestAuthority === null
      ? null
      : normalizeReferencedPrincipalHead(record.latestAuthority);
  if (authority && authority.principalType !== "group")
    throwVerification("invalid_shape", "invalid saved principal authority");
  const latestAuthority: PrincipalStateExternalAuthority | null = authority
    ? { ...authority, principalType: "group" }
    : null;
  const retained: NormalizedPrincipalPolicyStateChainEntry[] = [];
  for (const entry of record.retained)
    retained.push(await normalizeAuthenticatedPrincipalHistoryEntry(entry));
  const progress = { previous, latestAuthority, checkpointHash, retained };
  assertProgressConsistency(progress, input);
  assertRetainedReferences(progress, input);
  return progress;
}

function assertProgressConsistency(
  progress: PrincipalHistoryProgress,
  input: ReturnType<typeof normalizePrincipalHistoryInput>,
): void {
  const { previous, latestAuthority, checkpointHash, retained } = progress;
  const entries = previous ? [...retained, previous] : retained;
  if (
    entries.some(
      (entry) =>
        entry.state.principalId !== input.principalId ||
        entry.state.principalType !== input.principalType,
    )
  )
    throwVerification(
      "object_mismatch",
      "saved principal history scope mismatch",
    );
  if (!previous && (latestAuthority || checkpointHash || retained.length > 0))
    throwVerification(
      "invalid_shape",
      "empty principal progress carries history",
    );
  if (
    previous?.state.externalAuthority &&
    (!latestAuthority ||
      !principalPolicyStateMatchesReference(
        previous.state.externalAuthority,
        latestAuthority,
      ))
  )
    throwVerification(
      "invalid_shape",
      "saved principal authority is inconsistent",
    );
  const expectedCheckpointHash =
    previous &&
    input.checkpoint &&
    previous.state.version >= input.checkpoint.version
      ? input.checkpoint.stateHash
      : null;
  if (checkpointHash !== expectedCheckpointHash)
    throwVerification(
      "stale_predecessor",
      "saved principal checkpoint is inconsistent",
    );
}

function assertRetainedReferences(
  progress: PrincipalHistoryProgress,
  input: ReturnType<typeof normalizePrincipalHistoryInput>,
): void {
  const { previous, retained } = progress;
  const expectedReferences = input.references.filter(
    (reference) => reference.version <= (previous?.state.version ?? 0),
  );
  if (
    retained.length !== expectedReferences.length ||
    expectedReferences.some(
      (reference) =>
        retained.filter((entry) =>
          principalPolicyStateMatchesReference(entry.state, reference),
        ).length !== 1,
    )
  )
    throwVerification(
      "missing_dependency",
      "saved principal references are incomplete",
    );
}
