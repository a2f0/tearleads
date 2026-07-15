import {
  KeyingVerificationError,
  normalizePrincipalProjectionMembers,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { isPrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { readCanonicalJson } from "../keyingCanonicalJson";

interface StoredPrincipalPolicyBundleJson {
  readonly currentMemberEnvelopesJson: string;
  readonly currentPayloadJson: string;
  readonly currentProjectionJson: string;
  readonly currentStateJson: string;
  readonly previousStatesJson: string;
}

function parseBundle(
  row: StoredPrincipalPolicyBundleJson,
): PrincipalPolicyBundleResponse {
  const bundle = {
    currentMemberEnvelopes: JSON.parse(row.currentMemberEnvelopesJson),
    currentPayload: JSON.parse(row.currentPayloadJson),
    currentProjection: JSON.parse(row.currentProjectionJson),
    currentState: JSON.parse(row.currentStateJson),
    previousStates: JSON.parse(row.previousStatesJson),
  };
  if (!isPrincipalPolicyBundleResponse(bundle)) {
    throw new Error("Stored principal policy bundle is invalid");
  }
  return bundle;
}

function canonical(value: unknown): string {
  return serializeKeyingCanonicalJson(
    readCanonicalJson(value, "principal policy bundle security content"),
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
    currentState: withoutCreatedAt(bundle.currentState),
    previousStates: bundle.previousStates.map((entry) => ({
      projection: normalizePrincipalProjectionMembers(entry.projection),
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
