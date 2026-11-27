import { transitionCreateIntentHold } from "../../../../data/containers/shared/createIntentHoldMachine";
import { localChildPathFits } from "../localPathDepth";
import type { ContainerCreateIntentSyncInput } from "../types";

/** Record the depth hold once; the intent then waits for a local move. */
async function recordTooDeepCreate(
  input: ContainerCreateIntentSyncInput,
): Promise<void> {
  const { intent, state } = input;
  if (intent.hold.status === "pathTooDeep") return;
  const nextHold = transitionCreateIntentHold(intent.hold, {
    type: "pathTooDeep",
  });
  if (nextHold.status === "none") return;
  await state.persistence.recordCreateIntentRevisionHold(
    state.runtime.infra.execSql,
    {
      containerId: intent.containerId,
      expectedIntentId: intent.id,
      expectedUpdatedAt: intent.updatedAt,
      hold: nextHold,
      stillCurrent: input.isCurrent,
    },
  );
}

/**
 * A create already refused for path length, or whose path is too deep here,
 * can never succeed, so waiting costs no request. Re-queuing the folder under
 * another parent (a local move) clears the recorded hold and re-arms it.
 * Returns whether the create was deferred.
 */
export async function deferTooDeepCreate(
  input: ContainerCreateIntentSyncInput,
): Promise<boolean> {
  const { intent, state } = input;
  if (
    intent.hold.status !== "pathTooDeep" &&
    localChildPathFits(state.containersById, intent.parentContainerId)
  ) {
    return false;
  }
  await recordTooDeepCreate(input);
  return true;
}

/** Record a refusal from the verified plan or the API; it is final too. */
export async function recordRefusedTooDeepCreate(
  input: ContainerCreateIntentSyncInput,
): Promise<"parked"> {
  await recordTooDeepCreate(input);
  return "parked";
}
