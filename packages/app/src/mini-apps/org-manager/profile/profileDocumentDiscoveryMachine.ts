import type { DocumentSummary } from "@tearleads/client-sdk";

/** Whether a persisted-document notification may reveal a profile whose
 * remote identity is not yet held by any local row. Ready bindings and other
 * refusals stay `idle`, so ordinary content saves never re-resolve them. */
export type ProfileDocumentDiscoveryState =
  | { readonly status: "idle" }
  // A target persisted mid-lookup may be missed by the lookup's reads.
  // `documentId` is null until the target is known; any notification counts.
  | {
      readonly status: "resolving";
      readonly documentId: string | null;
      readonly notified: boolean;
    }
  | {
      readonly status: "awaiting";
      readonly containerId: string;
      readonly documentId: string;
    }
  | { readonly status: "rediscovered" };

interface PersistedEvent {
  readonly type: "persisted";
  readonly document: DocumentSummary;
  readonly placementChanged: boolean;
}

export type ProfileDocumentDiscoveryEvent =
  | { readonly type: "resolving"; readonly documentId: string | null }
  | {
      readonly type: "missing";
      readonly containerId: string;
      readonly documentId: string;
    }
  | { readonly type: "settled" }
  | PersistedEvent;

function transitionOnPersisted(
  state: ProfileDocumentDiscoveryState,
  { document, placementChanged }: PersistedEvent,
): ProfileDocumentDiscoveryState {
  if (state.status === "resolving") {
    const mayBeTarget =
      state.documentId === null ||
      placementChanged ||
      document.documentId === state.documentId;
    return mayBeTarget && !state.notified
      ? { ...state, notified: true }
      : state;
  }
  // Births and relinks change placement; recovery aliases carry no remote id,
  // so a placement in the profile container also qualifies.
  return state.status === "awaiting" &&
    (document.documentId === state.documentId ||
      (placementChanged && document.containerId === state.containerId))
    ? { status: "rediscovered" }
    : state;
}

export function transitionProfileDocumentDiscovery(
  state: ProfileDocumentDiscoveryState,
  event: ProfileDocumentDiscoveryEvent,
): ProfileDocumentDiscoveryState {
  switch (event.type) {
    case "resolving":
      return {
        status: "resolving",
        documentId: event.documentId,
        notified: false,
      };
    case "missing":
      return state.status === "resolving" && state.notified
        ? { status: "rediscovered" }
        : {
            status: "awaiting",
            containerId: event.containerId,
            documentId: event.documentId,
          };
    case "settled":
      return { status: "idle" };
    case "persisted":
      return transitionOnPersisted(state, event);
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
