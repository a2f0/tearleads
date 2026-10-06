import {
  type PrincipalPolicyHistoryProgressOptions,
  type ReferencedPrincipalHead,
  serializeKeyingCanonicalJson,
  toFingerprint,
} from "@tearleads/crypto";
import type { PrincipalHistoryPrefix } from "../persistence/principalHistoryPrefixPersistence";

async function principalHistoryKeyId(localKey: Uint8Array): Promise<string> {
  const owned = new Uint8Array(localKey);
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      owned,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const id = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(
        "tearleads.sdk.principal-history-evidence.key-id.v1",
      ),
    );
    return toFingerprint(new Uint8Array(id));
  } finally {
    owned.fill(0);
  }
}

export async function principalHistoryEvidenceScopeId(input: {
  readonly organizationId: string;
  readonly head: Pick<ReferencedPrincipalHead, "principalType" | "principalId">;
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
        await principalHistoryKeyId(input.protection.localKey),
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
      domain: "tearleads.sdk.principal-history-prefix.v1",
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
