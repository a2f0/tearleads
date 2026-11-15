import type { CurrentSelfContactIdentity } from "./currentSelfContactIdentity";

export interface SelfContactIdentitySource {
  /** `unavailable`: no ready database. `absent`: a ready database without a
   * signing identity, so there is no canonical Me for any document to be.
   * `available`: Me is read with `load`. */
  readonly availability: "unavailable" | "absent" | "available";
  readonly isCurrent: () => boolean;
  readonly load: () => Promise<CurrentSelfContactIdentity>;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface SelfContactIdentityRequest {
  readonly source: SelfContactIdentitySource;
  /** 0 for a notification-driven read; n for the nth automatic retry. */
  readonly attempt: number;
}

/** Delays before each automatic retry of a failed read. Once spent, the view
 * stays `failed` until the next identity notification starts a fresh read. */
export const SELF_CONTACT_IDENTITY_RETRY_DELAYS_MS: readonly number[] = [
  250, 1_000, 4_000,
];

export function selfContactIdentityRetryDelay(
  request: SelfContactIdentityRequest,
): number | null {
  return SELF_CONTACT_IDENTITY_RETRY_DELAYS_MS[request.attempt] ?? null;
}

/** Admission for work that must never touch the current canonical Me. Keep
 * display authority across equivalent refreshes, but do not admit a
 * destructive effect until the latest metadata read has completed. */
export interface SelfContactIdentityAdmission {
  readonly isCurrent: () => boolean;
  readonly runWhenCurrent: <T>(work: () => T | Promise<T>) => Promise<T | null>;
}

export interface SelfContactIdentityAuthority
  extends SelfContactIdentityAdmission {
  readonly identity: CurrentSelfContactIdentity;
}

export type SelfContactIdentityView =
  | { readonly status: "pending" }
  | { readonly status: "failed"; readonly error: unknown }
  // No signing identity: no document can be Me, so admission only binds the
  // documents authority generation the view was read under.
  | ({ readonly status: "absent" } & SelfContactIdentityAdmission)
  | ({ readonly status: "ready" } & SelfContactIdentityAuthority);

/** Admission for a mutation that must spare current Me, or null while the
 * view cannot yet tell which document that is. */
export function selfContactIdentityAdmission(
  view: SelfContactIdentityView,
): SelfContactIdentityAdmission | null {
  return (view.status === "ready" || view.status === "absent") &&
    view.isCurrent()
    ? view
    : null;
}

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
    }
  | {
      readonly type: "absent";
      readonly request: SelfContactIdentityRequest;
      readonly admission: SelfContactIdentityAdmission;
    };

export function transitionSelfContactIdentity(
  state: SelfContactIdentityState,
  event: SelfContactIdentityEvent,
): SelfContactIdentityState {
  if (event.type === "absent") {
    return { status: "absent", request: event.request, ...event.admission };
  }
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
