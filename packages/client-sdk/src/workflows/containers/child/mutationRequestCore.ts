import type {
  AccessEvent,
  AccessManifest,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import { principalPolicyRequestRecord } from "../../../data/containers/shared/principalPolicies";
import {
  readCanonicalRecord,
  readCanonicalRecords,
} from "../../../data/keyingCanonicalJson";

/**
 * The eight ContainerMutationRequest fields every child-container mutation
 * (create/share/rekey/revoke/move) assembles identically, labeled by
 * operation. The identity fields — previous manifest/path, manifest history,
 * predecessor bridge, keyring, and the parent KEK — genuinely differ per
 * operation and stay with each builder.
 */
export function containerMutationRequestCore(
  operation: string,
  input: {
    body: unknown;
    event: AccessEvent;
    keyEpoch: ContainerKeyEpoch;
    manifest: AccessManifest;
    manifestHash: string;
    principalPolicies: readonly VerifiedPrincipalPolicy[];
    userRecipientKeys: readonly ContainerUserRecipientKey[];
    wraps: readonly ContainerKeyWrap[];
  },
): Pick<
  ContainerMutationRequest,
  | "event"
  | "body"
  | "expectedManifestHash"
  | "manifest"
  | "principalPolicies"
  | "keyEpoch"
  | "wraps"
  | "userRecipientKeys"
> {
  const label = `Container ${operation}`;
  return {
    event: readCanonicalRecord(input.event, `${label} event`),
    body: readCanonicalRecord(input.body, `${label} body`),
    expectedManifestHash: input.manifestHash,
    manifest: readCanonicalRecord(input.manifest, `${label} manifest`),
    principalPolicies: readCanonicalRecords(
      input.principalPolicies.map((policy) =>
        principalPolicyRequestRecord(policy),
      ),
      `${label} principal policies`,
    ),
    keyEpoch: readCanonicalRecord(input.keyEpoch, `${label} key epoch`),
    wraps: readCanonicalRecords(input.wraps, `${label} wraps`),
    userRecipientKeys: readCanonicalRecords(
      input.userRecipientKeys,
      `${label} user recipient keys`,
    ),
  };
}
