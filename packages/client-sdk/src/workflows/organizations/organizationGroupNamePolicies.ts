import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { loadPrincipalPolicyBundleForReference } from "../../data/persistence/principalPolicyReferencePersistence";
import {
  parseOrganizationAuthorityDescriptor,
  principalHeadMatchesReference,
} from "../../data/principals/organizationAuthorityDescriptor";
import { principalPolicyReferenceFromBundle } from "../../data/principals/principalPolicyAdminSigners";
import { loadOrganizationExternalAdminPolicy } from "../principals/externalAdminPolicy";
import type { DirectoryGroupWalkInput } from "./groupNameUniqueness";

type Input = Pick<
  DirectoryGroupWalkInput,
  "apiClient" | "execSql" | "organizationId" | "resolveTrustedUserIdentity"
> & {
  readonly organizationPolicyReference?: ReferencedPrincipalHead | null;
  readonly stillCurrent: () => boolean;
};

/** Cached directory policies are reusable only at the exact projected head. */
export async function loadGroupNameDirectoryAuthority(input: Input) {
  const load = async (reference: ReferencedPrincipalHead) => {
    const checkpoint = await loadPrincipalPolicyCheckpoint(
      input.execSql,
      reference.principalType,
      reference.principalId,
    );
    const bundle =
      (await loadPrincipalPolicyBundleForReference(
        input.execSql,
        reference,
        checkpoint,
      )) ??
      (await input.apiClient.getCurrentPrincipalPolicy(
        reference.principalType,
        reference.principalId,
      ));
    if (
      bundle &&
      !principalHeadMatchesReference(
        principalPolicyReferenceFromBundle(bundle),
        reference,
      )
    )
      throw new Error(
        "Group name authority does not match the projected directory head",
      );
    return bundle;
  };
  const organization = input.organizationPolicyReference
    ? await load(input.organizationPolicyReference)
    : await input.apiClient.getCurrentPrincipalPolicy(
        "organization",
        input.organizationId,
      );
  if (!organization) return null;
  return loadOrganizationExternalAdminPolicy({
    ...input,
    getCurrentPrincipalPolicy: async (type, id) => {
      if (type === "organization")
        return id === input.organizationId ? organization : null;
      // This callback runs after the organization signature and scope checks.
      const descriptor = parseOrganizationAuthorityDescriptor(
        organization.currentPayload.ciphertext,
      );
      const head = descriptor.groupHeads.find(
        (head) => head.principalId === id,
      );
      return head ? load(head) : null;
    },
  });
}
