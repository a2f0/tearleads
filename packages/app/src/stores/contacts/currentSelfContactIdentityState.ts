import type { CurrentSelfContactIdentity } from "./currentSelfContactIdentity";

export interface SelfContactIdentitySource {
  readonly enabled: boolean;
  readonly isCurrent: () => boolean;
  readonly load: () => Promise<CurrentSelfContactIdentity>;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface SelfContactIdentityRequest {
  readonly source: SelfContactIdentitySource;
}

export type SelfContactIdentityView =
  | { readonly status: "pending" }
  | { readonly status: "failed"; readonly error: unknown }
  | {
      readonly status: "ready";
      readonly identity: CurrentSelfContactIdentity;
      readonly isCurrent: () => boolean;
    };

export function matchesSelfContactIdentity(
  identity: CurrentSelfContactIdentity,
  document: {
    readonly id: string;
    readonly documentId?: string | null | undefined;
  },
): boolean {
  // A bound identity outranks a local alias. Reset aliases without a current
  // documentId are covered by the reader's persisted recovery-identity set.
  return document.documentId != null
    ? document.documentId === identity.documentId
    : identity.localIds.has(document.id);
}

export type SelfContactIdentityState = SelfContactIdentityView & {
  readonly request: SelfContactIdentityRequest;
};

type SelfContactIdentityEvent =
  | { readonly type: "started"; readonly request: SelfContactIdentityRequest }
  | {
      readonly type: "resolved";
      readonly request: SelfContactIdentityRequest;
      readonly identity: CurrentSelfContactIdentity;
      readonly isCurrent: () => boolean;
    }
  | {
      readonly type: "failed";
      readonly request: SelfContactIdentityRequest;
      readonly error: unknown;
    };

export function transitionSelfContactIdentity(
  state: SelfContactIdentityState,
  event: SelfContactIdentityEvent,
): SelfContactIdentityState {
  if (event.type === "started") {
    return { status: "pending", request: event.request };
  }
  if (state.status !== "pending" || state.request !== event.request)
    return state;
  switch (event.type) {
    case "resolved":
      return {
        status: "ready",
        request: event.request,
        identity: event.identity,
        isCurrent: event.isCurrent,
      };
    case "failed":
      return { status: "failed", request: event.request, error: event.error };
  }
}
