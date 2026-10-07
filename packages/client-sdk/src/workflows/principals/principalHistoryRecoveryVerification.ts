import {
  KeyingVerificationError,
  type PrincipalPolicyStateChainEntry,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import type { RecoverPrincipalPolicyHistoryOptions } from "./principalHistoryRecoveryTypes";

export function principalHistoryVerificationContext(
  input: RecoverPrincipalPolicyHistoryOptions,
): string {
  const mode = input.historyVerification ?? "standard";
  if (mode !== "standard" && mode !== "direct-admins")
    throw new KeyingVerificationError(
      "invalid_shape",
      "Unknown principal history verification mode",
    );
  if (mode === "standard")
    return input.loadExternalAuthority
      ? serializeKeyingCanonicalJson([
          "tearleads.sdk.principal-history.external-authority.v1",
          input.protection.context,
        ])
      : input.protection.context;
  if (
    input.expectedHead.principalType !== "group" ||
    input.loadExternalAuthority
  )
    throw new KeyingVerificationError(
      "invalid_shape",
      "Strict Admins history requires a group without external authority fallback",
    );
  // Retire this local attestation domain whenever strict validation changes.
  return serializeKeyingCanonicalJson([
    "tearleads.sdk.principal-history.direct-admins.v1",
    input.protection.context,
  ]);
}

export function assertPrincipalHistoryVerificationMode(
  input: RecoverPrincipalPolicyHistoryOptions,
  entries: readonly PrincipalPolicyStateChainEntry[],
): void {
  if (input.historyVerification !== "direct-admins") return;
  if (
    entries.some(
      (entry) =>
        entry.projection.length === 0 ||
        entry.projection.some((member) => member.role !== "admin"),
    )
  )
    throw new KeyingVerificationError(
      "invalid_shape",
      "Reserved Admins history must contain only direct admin users",
    );
}
