import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { loadPrincipalPolicyCheckpoint } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointPersistence";
import { loadPrincipalPolicyBundleForReference } from "../../../data/persistence/principalPolicy/principalPolicyReferencePersistence";
import {
  parseOrganizationAuthorityDescriptor,
  principalHeadMatchesReference,
} from "../../../data/principals/organizationAuthorityDescriptor";
import { principalPolicyReferenceFromBundle } from "../../../data/principals/principalPolicyAdminSigners";
import type { CurrentPrincipalPolicyReader } from "../../principals/currentPrincipalPolicyReader";
import { loadOrganizationExternalAdminPolicy } from "../../principals/externalAdminPolicy";
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
    currentPolicyReader: directoryPinnedPolicyReader({
      load,
      organization,
      organizationId: input.organizationId,
    }),
  });
}

/**
 * Serves the organization bundle already read and each directory group at the
 * head that organization's directory pins, so the authority check reads the
 * heads the projection cited rather than whatever the server holds now.
 */
function directoryPinnedPolicyReader(input: {
  readonly load: (
    reference: ReferencedPrincipalHead,
  ) => Promise<PrincipalPolicyBundleResponse | null>;
  readonly organization: PrincipalPolicyBundleResponse;
  readonly organizationId: string;
}): CurrentPrincipalPolicyReader {
  return {
    getCurrentPrincipalPolicy: async (type, id) => {
      if (type === "organization")
        return id === input.organizationId ? input.organization : null;
      // Reached only after the organization signature and scope checks.
      const descriptor = parseOrganizationAuthorityDescriptor(
        input.organization.currentPayload.ciphertext,
      );
      const head = descriptor.groupHeads.find(
        (head) => head.principalId === id,
      );
      return head ? input.load(head) : null;
    },
  };
}
