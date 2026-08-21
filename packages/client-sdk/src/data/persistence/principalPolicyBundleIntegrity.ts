import {
  KeyingVerificationError,
  normalizePrincipalContainerGrants,
  normalizePrincipalProjectionMembers,
} from "@symcrypt/crypto";
import type { PrincipalPolicyBundleResponse } from "@symcrypt/validators/response";
import { isPrincipalPolicyBundleResponse } from "@symcrypt/validators/response";
import { canonicalKeyingJsonString } from "../keyingCanonicalJson";
import {
  type StoredPrincipalPolicyBundleJson,
  storedPrincipalPolicyBundleFromJson,
} from "./storedPrincipalPolicyBundle";

function parseBundle(
  row: StoredPrincipalPolicyBundleJson,
): PrincipalPolicyBundleResponse {
  const bundle = storedPrincipalPolicyBundleFromJson(row);
  if (!isPrincipalPolicyBundleResponse(bundle)) {
    throw new Error("Stored principal policy bundle is invalid");
  }
  return bundle;
}

function canonical(value: unknown): string {
  return canonicalKeyingJsonString(
    value,
    "principal policy bundle security content",
  );
}

function withoutCreatedAt<T extends { readonly createdAt: string }>(
  value: T,
): Omit<T, "createdAt"> {
  const { createdAt: _createdAt, ...content } = value;
  return content;
}

function securityContent(bundle: PrincipalPolicyBundleResponse) {
  return {
    currentMemberEnvelopes: {
      ...bundle.currentMemberEnvelopes,
      envelopes: [...bundle.currentMemberEnvelopes.envelopes].sort((a, b) =>
        canonical(a).localeCompare(canonical(b)),
      ),
    },
    currentPayload: withoutCreatedAt(bundle.currentPayload),
    currentProjection: normalizePrincipalProjectionMembers(
      bundle.currentProjection,
    ),
    currentGrants: normalizePrincipalContainerGrants(bundle.currentGrants),
    currentState: withoutCreatedAt(bundle.currentState),
    previousStates: bundle.previousStates.map((entry) => ({
      projection: normalizePrincipalProjectionMembers(entry.projection),
      grants: normalizePrincipalContainerGrants(entry.grants),
      state: withoutCreatedAt(entry.state),
    })),
  };
}

export function assertSameHeadPrincipalPolicyBundle(
  stored: StoredPrincipalPolicyBundleJson,
  incoming: StoredPrincipalPolicyBundleJson,
): void {
  try {
    if (
      canonical(securityContent(parseBundle(stored))) ===
      canonical(securityContent(parseBundle(incoming)))
    ) {
      return;
    }
  } catch {
    // Invalid same-head cache content is also an integrity conflict: replacing
    // it would erase the only durable evidence that the head was inconsistent.
  }
  throw new KeyingVerificationError(
    "equivocation",
    "principal policy bundle content conflicts with the cached bundle at the same head",
  );
}
