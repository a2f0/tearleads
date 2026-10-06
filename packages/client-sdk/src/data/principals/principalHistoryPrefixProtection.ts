import {
  type PrincipalPolicyHistoryProgressOptions,
  type ReferencedPrincipalHead,
  serializeKeyingCanonicalJson,
  toFingerprint,
} from "@tearleads/crypto";
import type { PrincipalHistoryPrefix } from "../persistence/principalHistoryPrefixPersistence";

// Signed entries and index nodes are content-addressed public evidence. Keep
// their storage namespace stable across local-key replacement; authenticating a
// prefix still requires the current private key. An unreadable prefix is discarded
// and rebuilt from signatures, reusing rows only after checking the new root.
export async function principalHistoryEvidenceScopeId(input: {
  readonly organizationId: string;
  readonly head: Pick<ReferencedPrincipalHead, "principalType" | "principalId">;
  readonly protection: PrincipalPolicyHistoryProgressOptions;
}): Promise<string> {
  return toFingerprint(
    new TextEncoder().encode(
      serializeKeyingCanonicalJson([
        "tearleads.sdk.principal-history-evidence.v2",
        input.organizationId,
        input.head.principalType,
        input.head.principalId,
        input.protection.context,
      ]),
    ),
  );
}

export async function principalHistoryPrefixProtection(
  protection: PrincipalPolicyHistoryProgressOptions,
  prefix: Omit<PrincipalHistoryPrefix, "progress">,
): Promise<PrincipalPolicyHistoryProgressOptions> {
  return {
    localKey: protection.localKey,
    context: serializeKeyingCanonicalJson({
      domain: "tearleads.sdk.principal-history-prefix.v2",
      context: protection.context,
      scopeId: prefix.scopeId,
      organizationId: prefix.organizationId,
      version: prefix.version,
      headJson: prefix.headJson,
      currentDigest: await toFingerprint(
        new TextEncoder().encode(prefix.currentJson),
      ),
    }),
  };
}
