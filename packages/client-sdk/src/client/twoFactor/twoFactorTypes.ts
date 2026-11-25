/** The signed-in identity's two-factor state as the server reports it. */
export interface TwoFactorStatus {
  readonly enabled: boolean;
  readonly recoveryCodesRemaining: number;
  /**
   * Organizations that refuse this session until it passes a second factor,
   * because each requires one of this member.
   */
  readonly requiredByOrganizationIds: readonly string[];
  /** Whether this session passed a second factor when it signed in. */
  readonly sessionVerified: boolean;
}

/** What an authenticator app needs: a QR code's URI or the typed key. */
export interface TwoFactorSetup {
  readonly otpauthUri: string;
  /** The base32 key for typing into an authenticator by hand. */
  readonly secret: string;
}

/** A code that confirms a change to two-factor settings. */
export interface TwoFactorAnswer {
  readonly code: string;
  readonly method: "recovery_code" | "totp";
}

/**
 * A two-factor request the server refused, or could not be asked. `code` is
 * the server's refusal code (`two_factor_invalid`, `two_factor_locked`, ...),
 * null for a failure without one.
 */
export class TwoFactorRequestError extends Error {
  override readonly name = "TwoFactorRequestError";

  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number | null,
  ) {
    super(message);
  }
}

/** The signed-in identity's own authenticator. */
export interface TwoFactor {
  /**
   * The status this session last learned, from `status()` or a change made
   * through this facade; null before the first, and again once the session
   * token changes.
   */
  readonly snapshot: TwoFactorStatus | null;
  /** Calls `listener` whenever `snapshot` changes. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
  status(): Promise<TwoFactorStatus>;
  /** Starts setup with a new secret, replacing any setup not yet finished. */
  beginSetup(): Promise<TwoFactorSetup>;
  /**
   * Confirms setup with an authenticator code and turns two-factor on. This
   * session stays signed in; the identity's other sessions are signed out.
   * Returns the recovery codes, shown once. With `rememberDevice`, this
   * device signs in without a code for 30 days.
   */
  enable(
    code: string,
    options?: { readonly rememberDevice?: boolean },
  ): Promise<readonly string[]>;
  /** Turns two-factor off; every session, this one too, signs in again. */
  disable(answer: TwoFactorAnswer): Promise<void>;
  /** Replaces the recovery codes; the old ones stop working. */
  regenerateRecoveryCodes(answer: TwoFactorAnswer): Promise<readonly string[]>;
}
