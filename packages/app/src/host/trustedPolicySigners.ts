import { base64ToBytes } from "@tearleads/encoding";

export const TRUSTED_POLICY_SIGNERS_PUBLIC_ENV_VAR =
  "BUN_PUBLIC_TRUSTED_POLICY_SIGNERS";

function getImportMetaEnvValue(
  importMeta: ImportMeta,
  key: string,
): string | undefined {
  const env = Reflect.get(importMeta, "env");
  if (typeof env !== "object" || env === null) {
    return undefined;
  }

  const value = Reflect.get(env, key);
  return typeof value === "string" ? value : undefined;
}

function isTrustedPolicySignersRecord(
  value: unknown,
): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.entries(value).every(
    ([signerKeyId, publicKeyBase64]) =>
      signerKeyId.length > 0 && typeof publicKeyBase64 === "string",
  );
}

export function parseTrustedPolicySigners(
  envRaw: string | undefined,
): ReadonlyMap<string, Uint8Array> {
  if (!envRaw || envRaw.length === 0) {
    return new Map();
  }

  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(envRaw);
  } catch {
    throw new Error(
      `${TRUSTED_POLICY_SIGNERS_PUBLIC_ENV_VAR} must be valid JSON when configured`,
    );
  }

  if (!isTrustedPolicySignersRecord(parsedValue)) {
    throw new Error(
      `${TRUSTED_POLICY_SIGNERS_PUBLIC_ENV_VAR} must be a JSON object of signer ids to base64-encoded public keys`,
    );
  }

  return new Map(
    Object.entries(parsedValue).map(([signerKeyId, publicKeyBase64]) => [
      signerKeyId,
      base64ToBytes(publicKeyBase64),
    ]),
  );
}

export function readTrustedPolicySignersPublicEnv(
  importMeta: ImportMeta,
): string | undefined {
  return getImportMetaEnvValue(
    importMeta,
    TRUSTED_POLICY_SIGNERS_PUBLIC_ENV_VAR,
  );
}
