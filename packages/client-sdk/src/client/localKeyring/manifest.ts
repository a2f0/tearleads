import {
  assertEnvelopeContextMatches,
  assertWrappedLocalSecretEnvelope,
  readLocalKeyringScope,
  readWrappedLocalSecretEnvelope,
} from "./envelope";
import {
  readExactString,
  readObject,
  readString,
  readVersion1,
} from "./jsonReaders";
import { assertNonEmptyString } from "./primitives";
import { localSecretContext, normalizeLocalKeyringScope } from "./scope";
import {
  LOCAL_KEYRING_MANIFEST_FORMAT,
  type LocalKeyringManifest,
} from "./types";

export function assertLocalKeyringManifest(
  manifest: LocalKeyringManifest,
): void {
  if (manifest.format !== LOCAL_KEYRING_MANIFEST_FORMAT) {
    throw new Error("Local keyring manifest format is unsupported.");
  }
  if (manifest.version !== 1) {
    throw new Error("Local keyring manifest version is unsupported.");
  }
  assertNonEmptyString(manifest.createdAt, "Local keyring manifest createdAt");
  assertNonEmptyString(manifest.updatedAt, "Local keyring manifest updatedAt");
  const scope = normalizeLocalKeyringScope(manifest.scope);
  assertWrappedLocalSecretEnvelope(manifest.rootKeyEnvelope);
  assertEnvelopeContextMatches({
    actual: manifest.rootKeyEnvelope.context,
    expected: localSecretContext(scope, "account-root"),
  });
}

export function serializeLocalKeyringManifest(
  manifest: LocalKeyringManifest,
): string {
  assertLocalKeyringManifest(manifest);
  return JSON.stringify(manifest);
}

export function parseLocalKeyringManifest(
  value: unknown,
): LocalKeyringManifest {
  const parsedValue: unknown =
    typeof value === "string" ? JSON.parse(value) : value;
  const manifest = readObject(parsedValue, "manifest");
  const parsed = {
    createdAt: readString(manifest, "createdAt"),
    format: readExactString(manifest, "format", LOCAL_KEYRING_MANIFEST_FORMAT),
    rootKeyEnvelope: readWrappedLocalSecretEnvelope(
      manifest.get("rootKeyEnvelope"),
    ),
    scope: readLocalKeyringScope(manifest.get("scope")),
    updatedAt: readString(manifest, "updatedAt"),
    version: readVersion1(manifest),
  } satisfies LocalKeyringManifest;
  assertLocalKeyringManifest(parsed);
  return parsed;
}

export function cloneManifest(
  manifest: LocalKeyringManifest,
): LocalKeyringManifest {
  return parseLocalKeyringManifest(serializeLocalKeyringManifest(manifest));
}
