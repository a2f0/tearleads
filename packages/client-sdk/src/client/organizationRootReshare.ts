import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import { rethrowKeyingVerificationError } from "../data/keyingProjectionVerification/error";
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
    rethrowKeyingVerificationError(error);
    if (!input.prepared.hasExpectedGroupPolicyHead()) {
      throw error;
    }
    try {
      await input.prepared.rewrap();
    } catch (rewrapError) {
      rethrowKeyingVerificationError(rewrapError);
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

export async function prepareOrganizationRootRewrapForGroup(input: {
  containerContents: ContainerContents;
  groupId: string;
  organizationId: string;
}): Promise<PreparedOrganizationRootRewrap | null> {
  const tree = input.containerContents.openTree();
  const root = await resolveOrganizationRoot(tree, input.organizationId);
  const prepared = await tree.prepareGroupRewrap(
    root.id,
    input.groupId,
    "admin",
    { requireExistingGrant: true },
  );
  if (!prepared) {
    throw new Error(
      `Organization root re-wrap could not be prepared for organization ${input.organizationId}`,
    );
  }
  if (prepared.status === "not-granted") {
    return null;
  }

  let expectedGroupHead: ReferencedPrincipalHead | null = null;

  return {
    hasExpectedGroupPolicyHead: () => expectedGroupHead !== null,
    async rewrap() {
      if (!expectedGroupHead) {
        throw new Error(
          `Organization root re-wrap has no committed group policy head for organization ${input.organizationId}`,
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
      } catch (error) {
        rethrowKeyingVerificationError(error);
      }
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
      } catch (error) {
        rethrowKeyingVerificationError(error);
      }

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
      } catch (error) {
        rethrowKeyingVerificationError(error);
      }
      if (
        !(await prepared.rewrap()) ||
        !(await prepared.isCurrent(
          expectedGroupHead,
          root.id,
          input.organizationId,
        ))
      ) {
        throw new Error(
          `Organization root admin re-wrap did not apply for organization ${input.organizationId}`,
        );
      }
    },
    setExpectedGroupPolicyHead(head) {
      if (
        head.principalType !== "group" ||
        head.principalId !== input.groupId
      ) {
        throw new Error("Organization root re-wrap group policy mismatch");
      }
      expectedGroupHead = head;
    },
  };
}
