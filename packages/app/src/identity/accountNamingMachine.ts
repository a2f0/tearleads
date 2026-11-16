/**
 * Naming the identity the boot-time autopilot just generated. Its first
 * registration waits for the user to say what to call them; the name titles
 * the personal organization and becomes the self contact's nickname.
 *
 * Only an identity the autopilot generated this session is prompted for. A
 * restored, imported, or switched-to identity may already have an account, so
 * it registers (or signs in) under the SDK's default organization name.
 *
 * - `idle`: nothing to name.
 * - `awaiting`: registration of `fingerprint` waits for a name.
 * - `named`: the user answered; `contactNamed` records that the self contact
 *   carries the name, so the writer can stop.
 */
export type AccountNamingState =
  | { readonly status: "idle" }
  | { readonly fingerprint: string; readonly status: "awaiting" }
  | {
      readonly contactNamed: boolean;
      readonly fingerprint: string;
      readonly name: string;
      readonly status: "named";
    };

export type AccountNamingEvent =
  | { readonly fingerprint: string; readonly type: "identity-generated" }
  | {
      readonly fingerprint: string;
      readonly name: string;
      readonly type: "name-submitted";
    }
  | { readonly fingerprint: string; readonly type: "contact-named" };

export const ACCOUNT_NAMING_IDLE: AccountNamingState = { status: "idle" };

/** Trims the answer and folds inner whitespace; null when nothing is left. */
export function normalizeAccountName(name: string): string | null {
  const normalized = name.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

/** The personal organization's name for an account named `accountName`. */
export function personalOrganizationName(accountName: string): string {
  return `${accountName}'s Org`;
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
