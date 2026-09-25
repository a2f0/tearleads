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
  const requested = [
    ...new Set([
      intent.targetContainerId,
      ...(intent.additionalLinkContainerIds ?? []),
    ]),
  ];
  const available = requested.filter(hasContainer);
  const targetContainerId = available[0];
  if (!targetContainerId || available.length === requested.length)
    return { intent, deferred: false };
  // Defer every removal until all requested additions are available. The
  // original durable intent is used for partial settlement and later retries.
  return {
    deferred: true,
    intent: {
      ...intent,
      targetContainerId,
      additionalLinkContainerIds: (
        intent.additionalLinkContainerIds ?? []
      ).filter(hasContainer),
      removedLinkContainerIds: [],
      replaceLinkedContainers: false,
    },
  };
}
