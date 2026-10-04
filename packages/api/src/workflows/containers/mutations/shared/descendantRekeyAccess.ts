import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { resolveContainerAccessProjectionBatch } from "../../writerProjection";
import { ContainerMutationError } from "../errors";

/** A self-revoke may remove the authority needed to sign its carried rekeys. */
export async function assertDescendantRekeysWritable(input: {
  readonly executor: DatabaseTransaction;
  readonly requiredContainerIds: readonly string[];
  readonly userId: string;
}): Promise<void> {
  // Resolve against persisted post-rotation heads in this transaction, with a
  // fresh context: a pre-rotation cache would still authorize the removed grant.
  const access = await resolveContainerAccessProjectionBatch({
    containerIds: input.requiredContainerIds,
    executor: input.executor,
    minimumAccessLevel: "write",
    userId: input.userId,
  });
  const inaccessible: string[] = [];
  for (const containerId of input.requiredContainerIds) {
    const result = access.get(containerId);
    if (!result) throw new Error("Missing descendant access projection");
    if (result.status === "fulfilled") continue;
    if (result.reason.status !== 403) throw result.reason;
    inaccessible.push(containerId);
  }
  if (inaccessible.length === 0) return;
  const message =
    "Revoking this grant would remove your ability to repair shared descendants. Ask an administrator or another writer with access to complete the revoke.";
  throw new ContainerMutationError(message, 409, {
    code: CONTAINER_MUTATION_ERROR_CODES.descendantRekeysInaccessible,
    error: message,
    requiredContainerIds: inaccessible,
  });
}
