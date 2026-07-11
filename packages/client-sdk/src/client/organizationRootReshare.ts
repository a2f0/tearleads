import type { ContainerContents } from "./containerContents";

type ContainerTree = ReturnType<ContainerContents["openTree"]>;

export interface PreparedOrganizationRootRewrap {
  rewrap(): Promise<void>;
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

  return {
    async rewrap() {
      try {
        if (await prepared.rewrap()) {
          return;
        }
      } catch {}

      await tree.refresh();
      if (!(await prepared.rewrap())) {
        throw new Error(
          `Organization root re-share to Admins did not apply for organization ${input.organizationId}`,
        );
      }
    },
  };
}
