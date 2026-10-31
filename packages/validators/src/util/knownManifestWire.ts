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
/** `m:` cites a manifest bundle by hash, `k:` a KEK level by digest. */
const MANIFEST_HINT_PREFIX = "m:";
const KEK_LEVEL_HINT_PREFIX = "k:";
const KNOWN_MANIFEST_HINT_CHARACTERS =
  KNOWN_MANIFEST_HINT_LIMIT *
    (MANIFEST_HINT_PREFIX.length + SHA256_HEX_LENGTH + 1) -
  1;

/** The typed digests one request declares held. */
export interface KnownManifestHints {
  readonly manifests: readonly string[];
  readonly kekLevels: readonly string[];
}

/**
 * Null unless the header is 1–48 unique typed entries, each `m:` or `k:`
 * followed by a lowercase SHA-256 hex digest.
 */
export function parseKnownManifestHints(
  value: string,
): KnownManifestHints | null {
  const entries = value.split(",");
  if (
    entries.length > KNOWN_MANIFEST_HINT_LIMIT ||
    new Set(entries).size !== entries.length
  )
    return null;
  const manifests: string[] = [];
  const kekLevels: string[] = [];
  for (const entry of entries) {
    const digest = entry.slice(MANIFEST_HINT_PREFIX.length);
    if (!isSha256HexString(digest)) return null;
    if (entry.startsWith(MANIFEST_HINT_PREFIX)) manifests.push(digest);
    else if (entry.startsWith(KEK_LEVEL_HINT_PREFIX)) kekLevels.push(digest);
    else return null;
  }
  return { manifests, kekLevels };
}

/** The header value for `hints`; callers keep the total within the limit. */
export function formatKnownManifestHints(hints: KnownManifestHints): string {
  return [
    ...hints.kekLevels.map((digest) => `${KEK_LEVEL_HINT_PREFIX}${digest}`),
    ...hints.manifests.map((hash) => `${MANIFEST_HINT_PREFIX}${hash}`),
  ].join(",");
}

const hintHeader = registerJsonSchemaFragment(
  z.string().max(KNOWN_MANIFEST_HINT_CHARACTERS),
  {
    type: "string",
    maxLength: KNOWN_MANIFEST_HINT_CHARACTERS,
    description: `Comma-separated typed digests the device holds verified: m:<manifest hash> for an access-manifest bundle, k:<level digest> for a container KEK level; at most ${KNOWN_MANIFEST_HINT_LIMIT}, unique`,
  },
);

export const KnownManifestsHeadersSchema = z.object({
  "x-known-manifests": registerJsonSchemaRuntimeRefinements(
    hintHeader.refine((value) => parseKnownManifestHints(value) !== null),
    [knownManifestsHeaderRefinement],
  ).optional(),
});
