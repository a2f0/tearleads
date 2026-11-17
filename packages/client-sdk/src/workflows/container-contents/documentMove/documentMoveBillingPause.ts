import type { DocumentMoveIntentRecord } from "../../../data/persistence/container-contents/documentMoveIntentPersistence";
import type { ContainerState } from "../remoteHydration";

/**
 * Whether a destination's organization is billing-gated. The preflight asks
 * before the request, but the gate learns of a block only from a 402, so a
 * refused link or unlink may itself be the first one. Asked again before a
 * refusal or a partial move is recorded, it holds the intent with no error as
 * the preflight would (sync-edge-cases row 19): a recorded error would replace
 * the queue's "billing paused" note and outlive the pause.
 */
export function isMoveDestinationSyncBlocked(input: {
  containersById: ReadonlyMap<string, ContainerState>;
  intent: DocumentMoveIntentRecord;
  isRemoteSyncBlocked: (organizationId: string) => boolean;
}): boolean {
  return [
    input.intent.targetContainerId,
    ...(input.intent.additionalLinkContainerIds ?? []),
  ].some((targetId) => {
    const target = input.containersById.get(targetId);
    return (
      target !== undefined &&
      input.isRemoteSyncBlocked(target.container.organizationId)
    );
  });
}
