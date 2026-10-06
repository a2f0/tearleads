import {
  type PrincipalPolicyHistoryProgressOptions,
  type ReferencedPrincipalHead,
  serializeKeyingCanonicalJson,
  toFingerprint,
} from "@tearleads/crypto";
import type { PrincipalHistoryPrefix } from "../persistence/principalHistoryPrefixPersistence";

export async function principalHistoryEvidenceScopeId(input: {
  readonly organizationId: string;
  readonly head: ReferencedPrincipalHead;
  readonly protection: PrincipalPolicyHistoryProgressOptions;
}): Promise<string> {
  return toFingerprint(
    new TextEncoder().encode(
      serializeKeyingCanonicalJson([
        "tearleads.sdk.principal-history-evidence.v1",
        input.organizationId,
        input.head.principalType,
        input.head.principalId,
        input.protection.context,
        await toFingerprint(input.protection.localKey),
      ]),
    ),
  );
}

export function principalHistoryPrefixProtection(
  protection: PrincipalPolicyHistoryProgressOptions,
  prefix: Omit<PrincipalHistoryPrefix, "progress">,
): PrincipalPolicyHistoryProgressOptions {
  return {
    localKey: protection.localKey,
    context: serializeKeyingCanonicalJson({
      domain: "tearleads.sdk.principal-history-prefix.v1",
      context: protection.context,
      scopeId: prefix.scopeId,
      organizationId: prefix.organizationId,
      version: prefix.version,
      headJson: prefix.headJson,
    }),
  };
}
