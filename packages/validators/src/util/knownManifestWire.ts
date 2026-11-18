import { z } from "zod";
import {
  registerJsonSchemaFragment,
  registerJsonSchemaRuntimeRefinements,
} from "../jsonSchema";
import { knownManifestsHeaderRefinement } from "../knownManifestsRefinements";
import { isSha256HexString, SHA256_HEX_LENGTH } from "./protocol";

/**
 * Hints bound the omission a request can ask for, never the history a reader
 * receives: an uncited manifest or KEK level always travels.
 */
export const KNOWN_MANIFEST_HINT_LIMIT = 48;
/**
 * Organization directory states one request may declare held, beside its
 * manifest and KEK-level hints.
 */
export const KNOWN_DIRECTORY_HINT_LIMIT = 8;
/**
 * `m:` cites a manifest bundle by hash, `k:` a KEK level by digest, `d:` an
 * organization directory payload by its signed state's hash.
 */
const MANIFEST_HINT_PREFIX = "m:";
const KEK_LEVEL_HINT_PREFIX = "k:";
const DIRECTORY_HINT_PREFIX = "d:";
const KNOWN_MANIFEST_HINT_CHARACTERS =
  (KNOWN_MANIFEST_HINT_LIMIT + KNOWN_DIRECTORY_HINT_LIMIT) *
    (MANIFEST_HINT_PREFIX.length + SHA256_HEX_LENGTH + 1) -
  1;

/** The typed digests one request declares held. */
export interface KnownManifestHints {
  readonly manifests: readonly string[];
  readonly kekLevels: readonly string[];
  readonly directories: readonly string[];
}

/**
 * Null unless the header is unique typed entries, at most 48 `m:` or `k:`
 * and at most 8 `d:`, each followed by a lowercase SHA-256 hex digest.
 */
export function parseKnownManifestHints(
  value: string,
): KnownManifestHints | null {
  const entries = value.split(",");
  if (
    entries.length > KNOWN_MANIFEST_HINT_LIMIT + KNOWN_DIRECTORY_HINT_LIMIT ||
    new Set(entries).size !== entries.length
  )
    return null;
  const manifests: string[] = [];
  const kekLevels: string[] = [];
  const directories: string[] = [];
  for (const entry of entries) {
    const digest = entry.slice(MANIFEST_HINT_PREFIX.length);
    if (!isSha256HexString(digest)) return null;
    if (entry.startsWith(MANIFEST_HINT_PREFIX)) manifests.push(digest);
    else if (entry.startsWith(KEK_LEVEL_HINT_PREFIX)) kekLevels.push(digest);
    else if (entry.startsWith(DIRECTORY_HINT_PREFIX)) directories.push(digest);
    else return null;
  }
  if (
    manifests.length + kekLevels.length > KNOWN_MANIFEST_HINT_LIMIT ||
    directories.length > KNOWN_DIRECTORY_HINT_LIMIT
  )
    return null;
  return { manifests, kekLevels, directories };
}

/** The header value for `hints`; callers keep each kind within its limit. */
export function formatKnownManifestHints(hints: KnownManifestHints): string {
  return [
    ...hints.kekLevels.map((digest) => `${KEK_LEVEL_HINT_PREFIX}${digest}`),
    ...hints.manifests.map((hash) => `${MANIFEST_HINT_PREFIX}${hash}`),
    ...hints.directories.map((hash) => `${DIRECTORY_HINT_PREFIX}${hash}`),
  ].join(",");
}

const hintHeader = registerJsonSchemaFragment(
  z.string().max(KNOWN_MANIFEST_HINT_CHARACTERS),
  {
    type: "string",
    maxLength: KNOWN_MANIFEST_HINT_CHARACTERS,
    description: `Comma-separated typed digests the device holds verified: m:<manifest hash> for an access-manifest bundle, k:<level digest> for a container KEK level (at most ${KNOWN_MANIFEST_HINT_LIMIT} of these), d:<organization state hash> for that state's directory payload (at most ${KNOWN_DIRECTORY_HINT_LIMIT}); unique`,
  },
);

export const KnownManifestsHeadersSchema = z.object({
  "x-known-manifests": registerJsonSchemaRuntimeRefinements(
    hintHeader.refine((value) => parseKnownManifestHints(value) !== null),
    [knownManifestsHeaderRefinement],
  ).optional(),
});
