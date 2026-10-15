import { z } from "zod";
import {
  registerJsonSchemaFragment,
  registerJsonSchemaRuntimeRefinements,
} from "../jsonSchema";
import { knownManifestsHeaderRefinement } from "../knownManifestsRefinements";
import { isSha256HexString, SHA256_HEX_LENGTH } from "./protocol";

/**
 * Hints bound the omission a request can ask for, never the history a reader
 * receives: an uncited manifest always travels.
 */
export const KNOWN_MANIFEST_HINT_LIMIT = 48;
const KNOWN_MANIFEST_HINT_CHARACTERS =
  KNOWN_MANIFEST_HINT_LIMIT * (SHA256_HEX_LENGTH + 1) - 1;

/** Null unless the header is 1–48 unique lowercase SHA-256 manifest hashes. */
export function parseKnownManifestHints(value: string): string[] | null {
  const hashes = value.split(",");
  return hashes.length <= KNOWN_MANIFEST_HINT_LIMIT &&
    new Set(hashes).size === hashes.length &&
    hashes.every(isSha256HexString)
    ? hashes
    : null;
}

const hintHeader = registerJsonSchemaFragment(
  z.string().max(KNOWN_MANIFEST_HINT_CHARACTERS),
  {
    type: "string",
    maxLength: KNOWN_MANIFEST_HINT_CHARACTERS,
    description: `Comma-separated manifest hashes whose verified bundles the device already holds; at most ${KNOWN_MANIFEST_HINT_LIMIT}, unique`,
  },
);

export const KnownManifestsHeadersSchema = z.object({
  "x-known-manifests": registerJsonSchemaRuntimeRefinements(
    hintHeader.refine((value) => parseKnownManifestHints(value) !== null),
    [knownManifestsHeaderRefinement],
  ).optional(),
});
