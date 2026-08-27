import type {
  VerifiedDocumentLinkSetManifest,
  VerifiedDocumentLinkSetSnapshot,
} from "@symcrypt/crypto";

export function requireVerifiedDocumentPredecessor(input: {
  readonly label: string;
  readonly previousManifestHash: string | null;
  readonly trustedPredecessorByHash?:
    | ReadonlyMap<string, VerifiedDocumentLinkSetSnapshot>
    | undefined;
  readonly verifiedByHash: ReadonlyMap<string, VerifiedDocumentLinkSetManifest>;
}): VerifiedDocumentLinkSetSnapshot | null {
  if (input.previousManifestHash === null) return null;
  const previousManifest =
    input.verifiedByHash.get(input.previousManifestHash) ??
    input.trustedPredecessorByHash?.get(input.previousManifestHash);
  if (!previousManifest) {
    throw new Error(
      `${input.label} previous manifest ${input.previousManifestHash} is missing`,
    );
  }
  return previousManifest;
}
