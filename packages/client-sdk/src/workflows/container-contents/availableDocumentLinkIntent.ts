import {
  DOCUMENT_LINK_INTENT_TYPE,
  type DocumentMoveIntentRecord,
} from "../../data/persistence/container-contents/documentMoveIntentPersistence";

/** Plan available additions without forgetting any part of the durable intent. */
export function availableDocumentLinkIntent(
  intent: DocumentMoveIntentRecord,
  hasContainer: (id: string) => boolean,
): { intent: DocumentMoveIntentRecord; deferred: boolean } {
  if (intent.intentType !== DOCUMENT_LINK_INTENT_TYPE)
    return { intent, deferred: false };
  // For link intents the primary target is a routing hint, often the old source.
  // Only explicit additions can defer the requested removals.
  const requested = [...new Set(intent.additionalLinkContainerIds ?? [])];
  const available = requested.filter(hasContainer);
  const deferred = available.length !== requested.length;
  const targetContainerId = hasContainer(intent.targetContainerId)
    ? intent.targetContainerId
    : (available[0] ??
      (intent.sourceContainerId && hasContainer(intent.sourceContainerId)
        ? intent.sourceContainerId
        : undefined));
  if (
    !targetContainerId ||
    (!deferred && targetContainerId === intent.targetContainerId)
  )
    return { intent, deferred };
  return {
    deferred,
    intent: {
      ...intent,
      targetContainerId,
      additionalLinkContainerIds: available,
      ...(deferred
        ? { removedLinkContainerIds: [], replaceLinkedContainers: false }
        : {}),
    },
  };
}
