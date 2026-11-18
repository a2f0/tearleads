import type { PrincipalStatePayloadResponse } from "./principalSnapshot";
import type {
  ProjectionPolicyEvidenceResponse,
  ProjectionPolicyEvidenceWireResponse,
} from "./projectionPolicyEvidence";

/** Directory payloads a request declared held, by organization state hash. */
export type HeldDirectoryPayloads = ReadonlyMap<
  string,
  PrincipalStatePayloadResponse
>;

/**
 * The served evidence: each directory payload whose organization state the
 * request declared held is `null`; everything else travels. Call after the
 * evidence is loaded and checked as for any reader. Unknown hashes are
 * ignored.
 */
export function encodeProjectionPolicyEvidence(
  evidence: ProjectionPolicyEvidenceResponse,
  heldDirectories: ReadonlySet<string>,
): ProjectionPolicyEvidenceWireResponse {
  if (heldDirectories.size === 0) return evidence;
  return {
    ...evidence,
    organizationPayloads: evidence.organizationPayloads.map((entry) =>
      heldDirectories.has(entry.reference.stateHash)
        ? { ...entry, payload: null }
        : entry,
    ),
  };
}

/**
 * Fills each omitted directory payload with its own copy of the payload the
 * request cited under that state hash. An omission the request did not cite
 * makes the evidence unusable, so the caller refetches in full. A payload is
 * only its ciphertext, so the reader checks every one, refilled or served,
 * against its state's signed `payloadCiphertextHash` (#2903 P23).
 */
export function decodeProjectionPolicyEvidence(
  evidence: ProjectionPolicyEvidenceWireResponse,
  heldDirectories: HeldDirectoryPayloads,
): ProjectionPolicyEvidenceResponse | null {
  const organizationPayloads: ProjectionPolicyEvidenceResponse["organizationPayloads"] =
    [];
  for (const entry of evidence.organizationPayloads) {
    if (entry.payload !== null) {
      organizationPayloads.push({ ...entry, payload: entry.payload });
      continue;
    }
    const payload = heldDirectories.get(entry.reference.stateHash);
    if (!payload) return null;
    organizationPayloads.push({ ...entry, payload: structuredClone(payload) });
  }
  return { ...evidence, organizationPayloads };
}
