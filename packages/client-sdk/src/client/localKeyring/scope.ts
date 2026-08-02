import { assertNonEmptyString, copyBytes, hashHex } from "./primitives";
import type {
  LocalKeyPurpose,
  LocalKeyringScope,
  LocalSecretContext,
  NormalizedLocalKeyringScope,
} from "./types";

const TEXT_ENCODER = new TextEncoder();

function normalizeOptionalString(
  value: string | null | undefined,
  label: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  assertNonEmptyString(value, label);
  return value;
}

export function normalizeLocalKeyringScope(
  scope: LocalKeyringScope,
): NormalizedLocalKeyringScope {
  assertNonEmptyString(scope.namespace, "Local keyring namespace");

  return {
    accountId: normalizeOptionalString(
      scope.accountId,
      "Local keyring account id",
    ),
    namespace: scope.namespace,
    signingFingerprint: normalizeOptionalString(
      scope.signingFingerprint,
      "Local keyring signing fingerprint",
    ),
  };
}

export function localKeyringScopeKey(scope: LocalKeyringScope): string {
  const normalizedScope = normalizeLocalKeyringScope(scope);
  return JSON.stringify([
    normalizedScope.namespace,
    normalizedScope.accountId,
    normalizedScope.signingFingerprint,
  ]);
}

export function localSecretContext(
  scope: NormalizedLocalKeyringScope,
  purpose: LocalKeyPurpose,
): LocalSecretContext {
  assertNonEmptyString(purpose, "Local key purpose");
  return { purpose, scope };
}

export function canonicalLocalSecretContext(
  context: LocalSecretContext,
): string {
  return JSON.stringify({
    purpose: context.purpose,
    scope: normalizeLocalKeyringScope(context.scope),
  });
}

export function localSecretAdditionalData(
  context: LocalSecretContext,
): Uint8Array<ArrayBuffer> {
  return copyBytes(TEXT_ENCODER.encode(canonicalLocalSecretContext(context)));
}

export function localKeyringSalt(
  scope: NormalizedLocalKeyringScope,
): Uint8Array<ArrayBuffer> {
  return copyBytes(
    TEXT_ENCODER.encode(
      `tearleads.local-keyring.v1.${localKeyringScopeKey(scope)}`,
    ),
  );
}

export async function localWrappingKeyScopeHash(
  scope: NormalizedLocalKeyringScope,
): Promise<string> {
  const keyMaterial = TEXT_ENCODER.encode(
    `tearleads.local-wrapping-key.v1.${localKeyringScopeKey(scope)}`,
  );
  return hashHex(keyMaterial);
}
