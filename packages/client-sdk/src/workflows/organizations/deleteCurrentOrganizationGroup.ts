import type { SigningKeyPair } from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import type { deleteOrganizationGroup } from "./deleteOrganizationGroup";
import {
  buildOrganizationGroupDirectoryPolicyRequest,
  removeOrganizationGroupHead,
} from "./organizationGroupDirectory";
import type { CurrentOrganizationMutationContext } from "./runtimeCurrentOrganizationMutation";
import {
  projectionUserIds,
  resolveRequiredUserIdentities,
} from "./trustedOrganizationUsers";

/** Delete against a verified directory without loading the removed group's history. */
export async function deleteCurrentOrganizationGroup(input: {
  readonly apiClient: Pick<
    Parameters<typeof deleteOrganizationGroup>[0]["apiClient"],
    "deleteOrganizationGroup"
  >;
  readonly context: CurrentOrganizationMutationContext;
  readonly groupId: string;
  readonly organizationId: string;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}) {
  const { context } = input;
  assertProjectionVerificationCurrent(context.stillCurrent);
  const adminProjection = context.admins.policy.projection;
  const request = await buildOrganizationGroupDirectoryPolicyRequest({
    ...input,
    adminProjection,
    adminUsers: await resolveRequiredUserIdentities({
      resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
      userIds: projectionUserIds(adminProjection),
    }),
    currentPolicy: context.directory.current,
    descriptor: context.descriptor,
    groupHeads: removeOrganizationGroupHead({
      descriptor: context.descriptor,
      groupId: input.groupId,
    }),
  });
  assertProjectionVerificationCurrent(context.stillCurrent);
  const stored = await input.apiClient.deleteOrganizationGroup(
    input.organizationId,
    input.groupId,
    { organizationPolicy: request },
  );
  assertProjectionVerificationCurrent(context.stillCurrent);
  if (!stored) throw new Error("Group could not be deleted");
  if (
    stored.organizationId !== input.organizationId ||
    stored.groupId !== input.groupId
  )
    throw new Error("Group deletion response target mismatch");
  await context.retainDirectory(request, stored.organizationPolicy);
  assertProjectionVerificationCurrent(context.stillCurrent);
  return stored;
}
