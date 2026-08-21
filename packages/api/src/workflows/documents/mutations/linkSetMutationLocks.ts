import type { DatabaseTransaction } from "@symcrypt/api-shared/postgres";
import type { DocumentLinkSetMutationRequest } from "@symcrypt/validators/request";
import { isUuidV4String } from "@symcrypt/validators/util";
import {
  lockAccessManifestHeadsForShare,
  lockAccessManifestHeadsForUpdate,
} from "../../../access/read/accessManifestStore";
import { uniqueSortedStrings } from "../../../utils/array";
import { DocumentMutationError } from "./errors";

type DocumentLinkSetMutationLockStep =
  | {
      readonly mode: "share";
      readonly objectIds: readonly string[];
      readonly objectKind: "container";
    }
  | {
      readonly mode: "update";
      readonly objectIds: readonly string[];
      readonly objectKind: "document";
    };

export function uniqueSortedContainerIds(
  containerIds: readonly string[],
): string[] {
  if (containerIds.some((containerId) => !isUuidV4String(containerId))) {
    throw new DocumentMutationError("Document container id is invalid", 400);
  }
  return uniqueSortedStrings(containerIds);
}

/**
 * Plan the global container->document lock order for a link-set mutation.
 * Lock every path head verified later, plus the prior and requested linked
 * targets, so neither authorization nor wrapping material can change between
 * verification and commit.
 */
export function createDocumentLinkSetMutationLockPlan(input: {
  readonly documentId: string;
  readonly previousLinkedContainerIds: readonly string[];
  readonly request: DocumentLinkSetMutationRequest;
}): readonly DocumentLinkSetMutationLockStep[] {
  const containerIds = uniqueSortedContainerIds([
    ...input.previousLinkedContainerIds,
    ...input.request.contentKeyBundle.targets.map(
      (target) => target.containerId,
    ),
    ...input.request.targetContainerPathRefs.map((ref) => ref.containerId),
    ...input.request.authorizingContainerPathRefs.flatMap((path) =>
      path.map((ref) => ref.containerId),
    ),
  ]);
  return [
    { mode: "share", objectIds: containerIds, objectKind: "container" },
    {
      mode: "update",
      objectIds: [input.documentId],
      objectKind: "document",
    },
  ];
}

export async function executeDocumentLinkSetMutationLockPlan(
  plan: readonly DocumentLinkSetMutationLockStep[],
  lockStep: (step: DocumentLinkSetMutationLockStep) => Promise<void>,
): Promise<void> {
  for (const step of plan) {
    await lockStep(step);
  }
}

export async function lockDocumentLinkSetMutationHeads(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly previousLinkedContainerIds: readonly string[];
  readonly request: DocumentLinkSetMutationRequest;
}): Promise<void> {
  await executeDocumentLinkSetMutationLockPlan(
    createDocumentLinkSetMutationLockPlan(input),
    async (step) => {
      if (step.mode === "share") {
        await lockAccessManifestHeadsForShare(
          step.objectKind,
          step.objectIds,
          input.executor,
        );
      } else {
        await lockAccessManifestHeadsForUpdate(
          step.objectKind,
          step.objectIds,
          input.executor,
        );
      }
    },
  );
}
