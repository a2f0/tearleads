import type { PersistedAccountNaming } from "../providers/identity/accountNamingPersistence";

/**
 * Naming the identity the boot-time autopilot generated. Its first
 * registration waits for the user to say what to call them; the name titles
 * the personal organization and becomes the self contact's nickname.
 *
 * Only an identity the autopilot generated on this device is prompted for. An
 * imported or restored-from-backup identity may already have an account, so
 * it registers (or signs in) under the SDK's default organization name.
 * `awaiting` and `named` survive a restart through
 * {@link PersistedAccountNaming} until the account exists and the self
 * contact's nickname is saved.
 *
 * - `idle`: nothing to name.
 * - `awaiting`: registration of `fingerprint` waits for a name; `error`
 *   says why an earlier answer was not kept.
 * - `named`: the user answered. `sealed` records that the name is stored, so
 *   registration, which waits for it, never outruns a name a restart would
 *   lose; `contactNamed` records that the self contact's nickname is saved,
 *   so the writer can stop.
 */
export type AccountNamingState =
  | { readonly status: "idle" }
  | {
      readonly error?: string;
      readonly fingerprint: string;
      readonly status: "awaiting";
    }
  | {
      readonly contactNamed: boolean;
      readonly fingerprint: string;
      readonly name: string;
      readonly sealed: boolean;
      readonly status: "named";
    };

export type AccountNamingEvent =
  | { readonly fingerprint: string; readonly type: "identity-generated" }
  | {
      readonly fingerprint: string;
      readonly name: string;
      readonly type: "name-submitted";
    }
  | { readonly fingerprint: string; readonly type: "contact-named" }
  | {
      readonly fingerprint: string;
      readonly name: string;
      readonly type: "name-sealed" | "seal-failed";
    }
  | {
      readonly fingerprint: string;
      readonly naming: PersistedAccountNaming;
      readonly type: "restored";
    };

export const ACCOUNT_NAMING_IDLE: AccountNamingState = { status: "idle" };

export const ACCOUNT_NAME_SEAL_FAILED_MESSAGE =
  "Could not save your name. Try again.";

/** Trims the answer and folds inner whitespace; null when nothing is left. */
export function normalizeAccountName(name: string): string | null {
  const normalized = name.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

/** The personal organization's name for an account named `accountName`. */
export function personalOrganizationName(accountName: string): string {
  return `${accountName}'s Org`;
}

/**
 * Whether the name was stored. One that could not be is asked for again
 * rather than registered under, since a restart would lose it.
 */
function settleSeal(
  state: AccountNamingState,
  event: Extract<AccountNamingEvent, { type: "name-sealed" | "seal-failed" }>,
): AccountNamingState {
  if (
    state.status !== "named" ||
    state.sealed ||
    state.fingerprint !== event.fingerprint ||
    state.name !== event.name
  ) {
    return state;
  }
  return event.type === "name-sealed"
    ? { ...state, sealed: true }
    : {
        error: ACCOUNT_NAME_SEAL_FAILED_MESSAGE,
        fingerprint: state.fingerprint,
        status: "awaiting",
      };
}

export function transitionAccountNaming(
  state: AccountNamingState,
  event: AccountNamingEvent,
): AccountNamingState {
  switch (event.type) {
    case "identity-generated":
      return { fingerprint: event.fingerprint, status: "awaiting" };
    case "name-submitted": {
      const name = normalizeAccountName(event.name);
      return state.status === "awaiting" &&
        state.fingerprint === event.fingerprint &&
        name !== null
        ? {
            contactNamed: false,
            fingerprint: event.fingerprint,
            name,
            sealed: false,
            status: "named",
          }
        : state;
    }
    case "contact-named":
      return state.status === "named" &&
        state.fingerprint === event.fingerprint &&
        !state.contactNamed
        ? { ...state, contactNamed: true }
        : state;
    case "name-sealed":
    case "seal-failed":
      return settleSeal(state, event);
    case "restored":
      // What this page already knows about the identity outranks a record a
      // slower read brought back.
      if (state.status !== "idle" && state.fingerprint === event.fingerprint) {
        return state;
      }
      return event.naming.status === "named"
        ? {
            contactNamed: false,
            fingerprint: event.fingerprint,
            name: event.naming.name,
            sealed: true,
            status: "named",
          }
        : { fingerprint: event.fingerprint, status: "awaiting" };
  }
}

/** The naming state as it applies to `fingerprint`; another identity's is idle. */
export function accountNamingFor(
  state: AccountNamingState,
  fingerprint: string | null,
): AccountNamingState {
  return state.status !== "idle" && state.fingerprint === fingerprint
    ? state
    : ACCOUNT_NAMING_IDLE;
}

/**
 * What the identity's sealed record should become: the naming to seal, or
 * `null` to remove it. A name outlives the account's creation until the self
 * contact's nickname is saved, so a restart before then, or a save that
 * failed, still names the contact. `undefined` leaves the record as it is.
 */
export function sealedAccountNaming(
  state: AccountNamingState,
  accountExists: boolean,
): PersistedAccountNaming | null | undefined {
  switch (state.status) {
    case "named":
      if (!accountExists) {
        return state.sealed ? undefined : { name: state.name, status: "named" };
      }
      return state.contactNamed ? null : undefined;
    case "awaiting":
      return accountExists ? null : { status: "awaiting" };
    case "idle":
      return accountExists ? null : undefined;
  }
}
