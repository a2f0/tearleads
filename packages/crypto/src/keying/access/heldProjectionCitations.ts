import {
  type ContainerKekWireLevel,
  type HeldDirectoryCitation,
  type HeldProjectionCitations,
  isContainerKekWireLevel,
  isHeldDirectoryCitation,
  type PrincipalStatePayloadResponse,
} from "@tearleads/validators/response";
import {
  isServedAccessManifestBundleWireResponse,
  isSha256HexString,
  KNOWN_DIRECTORY_HINT_LIMIT,
  KNOWN_MANIFEST_HINT_LIMIT,
  type ServedAccessManifestBundleWireResponse,
} from "@tearleads/validators/util";
import {
  computePrincipalStateHash,
  computePrincipalStatePayloadCiphertextHash,
} from "../../principalState/principalState";
import { computeContainerKekLevelDigest } from "../core/canonicalJsonGuard";

/**
 * The payload, under its state hash, when its organization state recomputes
 * to its own hash and its bytes hash to the `payloadCiphertextHash` that
 * state signs; null otherwise. A payload is only its ciphertext (#2903 P23),
 * so the signed hash is its whole identity: a cited payload is exactly the
 * bytes the server would serve for that state, and verification of the
 * rebuilt evidence decides as if they had travelled.
 */
async function signedDirectoryPayload(
  citation: HeldDirectoryCitation,
): Promise<{
  readonly payload: PrincipalStatePayloadResponse;
  readonly stateHash: string;
} | null> {
  const { directoryState: state, directoryPayload: payload } = citation;
  try {
    if (
      state.principalType !== "organization" ||
      !isSha256HexString(state.stateHash) ||
      (await computePrincipalStateHash(state)) !== state.stateHash
    )
      return null;
    return (await computePrincipalStatePayloadCiphertextHash(
      payload.ciphertext,
    )) === state.payloadCiphertextHash
      ? { payload, stateHash: state.stateHash }
      : null;
  } catch {
    return null;
  }
}

/** Copies of the source's entries, each kind within its own hint quota. */
function copyHeldEntries(entries: readonly unknown[]) {
  const bundles = new Map<string, ServedAccessManifestBundleWireResponse>();
  const levels: ContainerKekWireLevel[] = [];
  const directories: HeldDirectoryCitation[] = [];
  const manifestQuotaLeft = () =>
    bundles.size + levels.length < KNOWN_MANIFEST_HINT_LIMIT;
  for (const entry of entries) {
    try {
      if (isHeldDirectoryCitation(entry)) {
        if (directories.length < KNOWN_DIRECTORY_HINT_LIMIT)
          directories.push(structuredClone(entry));
      } else if (!manifestQuotaLeft()) continue;
      else if (isContainerKekWireLevel(entry))
        levels.push(structuredClone(entry));
      else if (
        isServedAccessManifestBundleWireResponse(entry) &&
        isSha256HexString(entry.manifestHash) &&
        !bundles.has(entry.manifestHash)
      )
        bundles.set(entry.manifestHash, structuredClone(entry));
    } catch {
      // An uncloneable entry is skipped; its bytes simply travel.
    }
  }
  return { bundles, levels, directories };
}

/**
 * The exact bytes a writer projection request may cite from what a device
 * holds. Copies each entry so a later eviction or mutation of the source
 * cannot change what fills the response's omissions, keeps each kind within
 * its hint quota, and keys each KEK level by the digest recomputed from its
 * own bytes, never by a digest the source names. A directory payload is cited
 * only when it hashes to the payload hash its own signed organization state
 * commits. Citing is never trust input: the caller verifies the rebuilt
 * projection exactly as a full one.
 */
export async function prepareHeldProjectionCitations(
  entries: readonly unknown[],
): Promise<HeldProjectionCitations> {
  const { bundles, levels, directories } = copyHeldEntries(entries);
  const kekLevels = new Map<string, ContainerKekWireLevel>();
  const digests = await Promise.all(levels.map(computeContainerKekLevelDigest));
  levels.forEach((level, index) => {
    const digest = digests[index];
    if (digest && !kekLevels.has(digest)) kekLevels.set(digest, level);
  });
  const heldDirectories = new Map<string, PrincipalStatePayloadResponse>();
  const payloads = await Promise.all(directories.map(signedDirectoryPayload));
  for (const signed of payloads)
    if (signed && !heldDirectories.has(signed.stateHash))
      heldDirectories.set(signed.stateHash, signed.payload);
  return { bundles, kekLevels, directories: heldDirectories };
}
