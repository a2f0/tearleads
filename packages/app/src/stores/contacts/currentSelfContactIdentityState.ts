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

export interface SelfContactIdentityAuthority {
  readonly identity: CurrentSelfContactIdentity;
  readonly isCurrent: () => boolean;
  // Keep display authority across equivalent refreshes, but do not admit a
  // destructive effect until the latest metadata read has completed.
  readonly runWhenCurrent: <T>(work: () => T | Promise<T>) => Promise<T | null>;
}

export type SelfContactIdentityView =
  | { readonly status: "pending" }
  | { readonly status: "failed"; readonly error: unknown }
  | ({ readonly status: "ready" } & SelfContactIdentityAuthority);

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

export type SelfContactIdentityState = (
  | SelfContactIdentityView
  | ({ readonly status: "refreshing" } & SelfContactIdentityAuthority)
) & { readonly request: SelfContactIdentityRequest };

type SelfContactIdentityEvent =
  | {
      readonly type: "started";
      readonly request: SelfContactIdentityRequest;
      readonly preserve: boolean;
    }
  | {
      readonly type: "resolved";
      readonly request: SelfContactIdentityRequest;
      readonly authority: SelfContactIdentityAuthority;
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
    if (
      (state.status === "ready" || state.status === "refreshing") &&
      state.request.source === event.request.source &&
      event.preserve
    ) {
      return { ...state, status: "refreshing", request: event.request };
    }
    return { status: "pending", request: event.request };
  }
  if (
    (state.status !== "pending" && state.status !== "refreshing") ||
    state.request !== event.request
  )
    return state;
  switch (event.type) {
    case "resolved":
      return {
        status: "ready",
        request: event.request,
        ...event.authority,
      };
    case "failed":
      return { status: "failed", request: event.request, error: event.error };
  }
}
