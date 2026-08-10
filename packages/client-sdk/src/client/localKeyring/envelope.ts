import {
  readExactString,
  readNullableString,
  readObject,
  readOptionalString,
  readString,
  readVersion1,
} from "./jsonReaders";
import { assertNonEmptyString } from "./primitives";
import {
  canonicalLocalSecretContext,
  localSecretContext,
  normalizeLocalKeyringScope,
} from "./scope";
import {
  type LocalSecretContext,
  type NormalizedLocalKeyringScope,
  WRAPPED_LOCAL_SECRET_FORMAT,
  type WrappedLocalSecretEnvelope,
} from "./types";

export function assertEnvelopeContextMatches(input: {
  readonly actual: LocalSecretContext;
  readonly expected: LocalSecretContext;
}): void {
  if (
    canonicalLocalSecretContext(input.actual) !==
    canonicalLocalSecretContext(input.expected)
  ) {
    throw new Error("Wrapped local secret context does not match.");
  }
}

export function assertWrappedLocalSecretEnvelope(
  envelope: WrappedLocalSecretEnvelope,
): void {
  if (envelope.format !== WRAPPED_LOCAL_SECRET_FORMAT) {
    throw new Error("Wrapped local secret envelope format is unsupported.");
  }
  if (envelope.version !== 1) {
    throw new Error("Wrapped local secret envelope version is unsupported.");
  }
  assertNonEmptyString(envelope.algorithm, "Wrapped local secret algorithm");
  assertNonEmptyString(envelope.ciphertext, "Wrapped local secret ciphertext");
  assertNonEmptyString(envelope.keyId, "Wrapped local secret key id");
  assertNonEmptyString(envelope.provider, "Wrapped local secret provider");
  assertNonEmptyString(envelope.wrappedAt, "Wrapped local secret wrappedAt");
  normalizeLocalKeyringScope(envelope.context.scope);
  assertNonEmptyString(
    envelope.context.purpose,
    "Wrapped local secret purpose",
  );
}

export function readLocalKeyringScope(
  value: unknown,
): NormalizedLocalKeyringScope {
  const scope = readObject(value, "scope");
  return normalizeLocalKeyringScope({
    accountId: readNullableString(scope, "accountId"),
    namespace: readString(scope, "namespace"),
    signingFingerprint: readNullableString(scope, "signingFingerprint"),
  });
}

function readLocalSecretContext(value: unknown): LocalSecretContext {
  const context = readObject(value, "context");
  return localSecretContext(
    readLocalKeyringScope(context.get("scope")),
    readString(context, "purpose"),
  );
}

export function readWrappedLocalSecretEnvelope(
  value: unknown,
): WrappedLocalSecretEnvelope {
  const envelope = readObject(value, "rootKeyEnvelope");
  const parsed = {
    algorithm: readString(envelope, "algorithm"),
    ciphertext: readString(envelope, "ciphertext"),
    context: readLocalSecretContext(envelope.get("context")),
    format: readExactString(envelope, "format", WRAPPED_LOCAL_SECRET_FORMAT),
    iv: readOptionalString(envelope, "iv"),
    keyId: readString(envelope, "keyId"),
    provider: readString(envelope, "provider"),
    version: readVersion1(envelope),
    wrappedAt: readString(envelope, "wrappedAt"),
  } satisfies WrappedLocalSecretEnvelope;
  assertWrappedLocalSecretEnvelope(parsed);
  return parsed;
}
