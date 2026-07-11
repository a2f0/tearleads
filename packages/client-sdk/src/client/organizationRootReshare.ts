import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import type { ContainerContents } from "./containerContents";
import { logErrorSafely } from "./logger";

type ContainerTree = ReturnType<ContainerContents["openTree"]>;

export interface PreparedOrganizationRootRewrap {
  hasExpectedGroupPolicyHead(): boolean;
  rewrap(): Promise<void>;
  setExpectedGroupPolicyHead(head: ReferencedPrincipalHead): void;
}

/**
 * A group mutation can commit one or both server writes before its client
 * promise rejects. Reconcile with the captured root key before propagating the
 * original error so an ambiguous response cannot strand a completed rotation.
 */
export async function recoverOrganizationRootRewrapAfterMutationFailure<
  T,
>(input: {
  logError: (message: string | Error, cause?: unknown) => void;
  mutation: Promise<T>;
  prepared: PreparedOrganizationRootRewrap;
}): Promise<T> {
  try {
    return await input.mutation;
  } catch (error) {
    if (!input.prepared.hasExpectedGroupPolicyHead()) {
      throw error;
    }
    try {
      await input.prepared.rewrap();
    } catch (rewrapError) {
      logErrorSafely(
        input.logError,
        "Organization root re-wrap reconciliation failed after a group mutation error",
        rewrapError,
      );
    }
    throw error;
  }
}

async function resolveOrganizationRoot(
  tree: ContainerTree,
  organizationId: string,
) {
  const findRoot = () =>
    tree
      .getSnapshot()
      .nodes.find(
        (candidate) =>
          candidate.organizationId === organizationId &&
          candidate.parentId === null,
      );

  let root = findRoot();
  if (!root) {
    await tree.refresh();
    root = findRoot();
  }
  if (!root) {
    throw new Error(
      `Organization root container is not reachable for organization ${organizationId}`,
    );
  }
  return root;
}

/**
 * Re-wrap the organization's root KEK to the current Admins-group key.
 *
 * Unlike the best-effort metadata re-share, root access is an availability
 * invariant. A caller must observe and handle failure rather than allowing an
 * Admins-group rotation to commit silently with a stale root grant.
 */
export async function reshareOrganizationRootToAdmins(input: {
  adminGroupId: string;
  containerContents: ContainerContents;
  organizationId: string;
}): Promise<void> {
  const tree = input.containerContents.openTree();
  const root = await resolveOrganizationRoot(tree, input.organizationId);

  const reshared = await tree.shareWithGroup(
    root.id,
    input.adminGroupId,
    "admin",
    { requireExistingGrant: true },
  );
  if (!reshared) {
    throw new Error(
      `Organization root re-share to Admins did not apply for organization ${input.organizationId}`,
    );
  }
}

export async function prepareOrganizationRootRewrapToAdmins(input: {
  adminGroupId: string;
  containerContents: ContainerContents;
  organizationId: string;
}): Promise<PreparedOrganizationRootRewrap> {
  const tree = input.containerContents.openTree();
  const root = await resolveOrganizationRoot(tree, input.organizationId);
  const prepared = await tree.prepareGroupRewrap(
    root.id,
    input.adminGroupId,
    "admin",
    { requireExistingGrant: true },
  );
  if (!prepared) {
    throw new Error(
      `Organization root re-wrap could not be prepared for organization ${input.organizationId}`,
    );
  }

  let expectedGroupHead: ReferencedPrincipalHead | null = null;

  return {
    hasExpectedGroupPolicyHead: () => expectedGroupHead !== null,
    async rewrap() {
      if (!expectedGroupHead) {
        throw new Error(
          `Organization root re-wrap has no committed Admins policy head for organization ${input.organizationId}`,
        );
      }
      try {
        if (
          await prepared.isCurrent(
            expectedGroupHead,
            root.id,
            input.organizationId,
          )
        ) {
          return;
        }
      } catch {}
      try {
        if (
          (await prepared.rewrap()) &&
          (await prepared.isCurrent(
            expectedGroupHead,
            root.id,
            input.organizationId,
          ))
        ) {
          return;
        }
      } catch {}

      await tree.refresh();
      try {
        if (
          await prepared.isCurrent(
            expectedGroupHead,
            root.id,
            input.organizationId,
          )
        ) {
          return;
        }
      } catch {}
      if (
        !(await prepared.rewrap()) ||
        !(await prepared.isCurrent(
          expectedGroupHead,
          root.id,
          input.organizationId,
        ))
      ) {
        throw new Error(
          `Organization root re-share to Admins did not apply for organization ${input.organizationId}`,
        );
      }
    },
    setExpectedGroupPolicyHead(head) {
      if (
        head.principalType !== "group" ||
        head.principalId !== input.adminGroupId
      ) {
        throw new Error("Organization root re-wrap Admins policy mismatch");
      }
      expectedGroupHead = head;
    },
  };
}
