/**
 * Whether the current identity's registration waits for the person to agree
 * to the legal terms. Registration records the agreed revision, so a new
 * account needs it. An identity that already has one does not: one this
 * device already binds to an account (say, its session was never stored
 * before a reload) only signs back in. Neither does one recovered from its
 * passphrase, which the autopilot only signs in, though a manual Register
 * asks it (see `useRegisterCurrentIdentity`), since it may never have had one.
 */
export type LegalTermsRequirement =
  /** Registration waits for the agreement, which the person is asked for. */
  | "required"
  /** Neither asked for nor registering until the device's binding is read. */
  | "checking"
  /** Agreed, or nothing the autopilot runs would record an agreement. */
  | "not-required";

/**
 * What this device knows of whether a restored key is bound to an account,
 * read from its local trust store. Each lookup is tagged so only the latest
 * one settles it.
 */
export type IdentityAccountBinding =
  | { readonly status: "unknown" }
  | {
      readonly fingerprint: string;
      readonly request: symbol;
      readonly status: "checking";
    }
  | {
      readonly bound: boolean;
      readonly fingerprint: string;
      readonly status: "known";
    };

export type IdentityAccountBindingEvent =
  | {
      readonly fingerprint: string;
      readonly request: symbol;
      readonly type: "check-started";
    }
  | {
      readonly bound: boolean;
      readonly request: symbol;
      readonly type: "check-settled";
    };

export const IDENTITY_ACCOUNT_BINDING_UNKNOWN: IdentityAccountBinding = {
  status: "unknown",
};

export function transitionIdentityAccountBinding(
  state: IdentityAccountBinding,
  event: IdentityAccountBindingEvent,
): IdentityAccountBinding {
  switch (event.type) {
    case "check-started":
      return {
        fingerprint: event.fingerprint,
        request: event.request,
        status: "checking",
      };
    case "check-settled":
      return state.status === "checking" && state.request === event.request
        ? {
            bound: event.bound,
            fingerprint: state.fingerprint,
            status: "known",
          }
        : state;
  }
}

export interface LegalTermsRequirementInput {
  readonly agreed: boolean;
  readonly binding: IdentityAccountBinding;
  /** The current key came from this device's storage, not this page. */
  readonly identityRestored: boolean;
  readonly recovered: boolean;
  readonly signingFingerprint: string | null;
}

export function legalTermsRequirement(
  input: LegalTermsRequirementInput,
): LegalTermsRequirement {
  if (input.agreed || input.recovered) return "not-required";
  // A key made on this page has never been bound to an account.
  if (!input.identityRestored) return "required";
  const { binding } = input;
  if (
    binding.status !== "known" ||
    binding.fingerprint !== input.signingFingerprint
  ) {
    return "checking";
  }
  return binding.bound ? "not-required" : "required";
}
