import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import {
  buildMaterializedContainerRekeyPlan,
  createRemoteContainer,
  moveRemoteContainer,
  rekeyRemoteContainer,
  revokeRemoteContainer,
  shareRemoteContainer,
} from "@tearleads/client-sdk";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import { createAncestorSdkContext } from "./ancestorSdkRepair";
import { authenticate } from "./authenticate";
import { bootstrapRoot } from "./keyingWriterProjectionKit";
import { addOrganizationMember } from "./organizationMembership";
import { registerUser } from "./registerUser";

interface PathKek {
  readonly containerId: string;
  readonly containerKeyEpochId: string;
  readonly parentContainerKeyEpochId: string | null;
}

/** Every level on the path pins its parent's current key epoch. */
export const isPathCurrent = (keks: readonly PathKek[]) =>
  keks.every(
    (kek, index) =>
      index === 0 ||
      kek.parentContainerKeyEpochId === keks[index - 1]?.containerKeyEpochId,
  );

/**
 * An owner's organization driven through the real SDK against the real routes.
 * Each rotation answers with the container ids it carried, or null if refused.
 */
interface OwnedContainerTree {
  /** A signed rekey of any container that carries nothing, for posting raw. */
  readonly bareRekeyRequest: (
    containerId: string,
  ) => Promise<ContainerMutationRequest>;
  /** The same, signed by a member rather than the owner. */
  readonly bareRekeyRequestAs: (
    member: TestUser,
    containerId: string,
  ) => Promise<ContainerMutationRequest>;
  /** A signed root rekey that carries nothing, for posting raw. */
  readonly bareRootRekeyRequest: () => Promise<ContainerMutationRequest>;
  readonly close: () => void;
  readonly createChild: (parentContainerId: string) => Promise<string>;
  readonly keksOf: (containerId: string) => Promise<readonly PathKek[]>;
  readonly members: readonly TestUser[];
  readonly move: (
    containerId: string,
    destinationParentContainerId: string,
  ) => Promise<readonly string[] | null>;
  readonly organizationId: string;
  readonly owner: TestUser;
  readonly revokeFromRoot: (
    userId: string,
  ) => Promise<readonly string[] | null>;
  readonly rootId: string;
  readonly rotateRoot: () => Promise<readonly string[] | null>;
  readonly share: (containerId: string, userId: string) => Promise<void>;
}

export async function createOwnedTree(
  memberCount: number,
  existingMembers: readonly TestUser[] = [],
): Promise<OwnedContainerTree> {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const members: TestUser[] = [...existingMembers];
  for (let index = 0; index < memberCount; index += 1) {
    const member = createTestUser();
    await registerUser(member);
    await authenticate(member);
    members.push(member);
  }
  const root = await bootstrapRoot(owner);
  const rootId = root.kekState.containerId;
  const organizationId = Reflect.get(root.bundle.state, "organizationId");
  if (typeof organizationId !== "string")
    throw new Error("Expected root organization");
  for (const member of members) {
    await addOrganizationMember({ actor: owner, member, organizationId });
  }
  const context = await createAncestorSdkContext(
    owner,
    organizationId,
    ...members,
  );
  const sdk = {
    ...context.common,
    reportSecurityIncident: async () => undefined,
    resolveTrustedUserIdentity: context.resolveTrustedUserIdentity,
  };
  const carriedIds = (
    result: {
      response: { containerRekeys?: { containerId: string }[] | undefined };
    } | null,
  ) =>
    result &&
    (result.response.containerRekeys ?? []).map((rekey) => rekey.containerId);
  const bareRekeyRequest = async (containerId: string) => {
    const previousProjection =
      await context.common.apiClient.getContainerWriterProjection(containerId);
    if (!previousProjection) throw new Error("Expected a projection");
    const bare = await buildMaterializedContainerRekeyPlan({
      ...context.common,
      persistVerificationCheckpoints: false,
      previousProjection,
    });
    return bare.plan.request;
  };
  const bareRekeyRequestAs = async (member: TestUser, containerId: string) => {
    const memberContext = await createAncestorSdkContext(
      member,
      organizationId,
      owner,
      ...members.filter((other) => other !== member),
    );
    try {
      const previousProjection =
        await memberContext.common.apiClient.getContainerWriterProjection(
          containerId,
        );
      if (!previousProjection) throw new Error("Expected a projection");
      const bare = await buildMaterializedContainerRekeyPlan({
        ...memberContext.common,
        persistVerificationCheckpoints: false,
        previousProjection,
      });
      return bare.plan.request;
    } finally {
      memberContext.close();
    }
  };
  return {
    bareRekeyRequest,
    bareRekeyRequestAs,
    bareRootRekeyRequest: () => bareRekeyRequest(rootId),
    close: context.close,
    createChild: async (parentContainerId) => {
      const child = await createRemoteContainer({
        ...sdk,
        parentContainerId,
        parentSecretKey: owner.kem.secretKey,
      });
      if (!child) throw new Error("Expected child");
      return child.containerId;
    },
    keksOf: async (containerId) =>
      (await context.common.apiClient.getContainerWriterProjection(containerId))
        ?.containerKeks ?? [],
    members,
    move: async (containerId, destinationParentContainerId) =>
      carriedIds(
        await moveRemoteContainer({
          ...sdk,
          containerId,
          destinationParentContainerId,
        }),
      ),
    organizationId,
    owner,
    revokeFromRoot: async (userId) =>
      carriedIds(
        await revokeRemoteContainer({
          ...sdk,
          containerId: rootId,
          revokedSubject: { subjectId: userId, subjectType: "user" },
        }),
      ),
    rootId,
    rotateRoot: async () =>
      carriedIds(await rekeyRemoteContainer({ ...sdk, containerId: rootId })),
    share: async (containerId, userId) => {
      const shared = await shareRemoteContainer({
        ...sdk,
        accessLevel: "write",
        containerId,
        recipientUserId: userId,
      });
      if (!shared) throw new Error("Expected share");
    },
  };
}
