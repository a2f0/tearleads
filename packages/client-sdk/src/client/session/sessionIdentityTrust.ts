import { KeyingVerificationError } from "@tearleads/crypto";
import type { LocalUserIdentityCandidate } from "../../data/trustedUserIdentity";
import type { Identity, IdentitySnapshot } from "../identity";

/** Successful auth and fingerprint-bound host restores establish this binding. */
export class SessionIdentityAcknowledgments {
  private readonly userIdsByFingerprint = new Map<string, string>();

  assertMatches(userId: string, fingerprint: string): void {
    const acknowledgedUserId = this.userIdsByFingerprint.get(fingerprint);
    if (acknowledgedUserId && acknowledgedUserId !== userId) {
      throw new KeyingVerificationError(
        "object_mismatch",
        "Login user ID differs from the acknowledged identity",
      );
    }
  }

  /** True only for a user ID the server acknowledged for this fingerprint. */
  isAcknowledged(
    userId: string | null | undefined,
    fingerprint: string | null,
  ): boolean {
    return (
      !!userId &&
      !!fingerprint &&
      this.userIdsByFingerprint.get(fingerprint) === userId
    );
  }

  remember(
    userId: string | null | undefined,
    fingerprint: string | null,
  ): void {
    if (!userId || !fingerprint) return;
    this.assertMatches(userId, fingerprint);
    this.userIdsByFingerprint.set(fingerprint, userId);
  }
}

export type UserIdentityAvailable = (
  userId: string,
  candidate: LocalUserIdentityCandidate,
) => Promise<void>;

export function requireUserIdentityAvailable(
  onUserIdentityAvailable: UserIdentityAvailable | undefined,
  operation: string,
): UserIdentityAvailable {
  if (!onUserIdentityAvailable) {
    throw new KeyingVerificationError(
      "missing_dependency",
      `${operation} requires the durable local identity trust service`,
    );
  }
  return onUserIdentityAvailable;
}

export function requireRegistrationIdentityPinner(input: {
  readonly identity: Identity;
  readonly identitySnapshot: IdentitySnapshot;
  readonly onUserIdentityAvailable?: UserIdentityAvailable | undefined;
}): UserIdentityAvailable {
  const onUserIdentityAvailable = requireUserIdentityAvailable(
    input.onUserIdentityAvailable,
    "Registration",
  );
  return async (userId, candidate) => {
    await onUserIdentityAvailable(userId, {
      ...candidate,
      signingKeyFingerprint: input.identitySnapshot.signingFingerprint,
    });
    if (input.identity.snapshot !== input.identitySnapshot) {
      throw new KeyingVerificationError(
        "object_mismatch",
        "Local identity changed during registration trust establishment",
      );
    }
  };
}

export type BoundUserIdLookup = (
  signingKeyFingerprint: string,
) => Promise<string | null>;

/**
 * A key this device already binds to a user belongs to that user: the trust
 * store holds one user per key, so a new registration's pin would be refused
 * only after the server had created the account. Registration declines before
 * touching the server instead; like a lost or conflicting registration, the
 * caller then proves ownership by logging in. After an environment reset this
 * requires clearing the device's local data.
 */
export async function registrationKeyAlreadyBound(
  dependencies: {
    readonly boundUserIdForSigningKey?: BoundUserIdLookup | undefined;
    readonly log: (message: string) => void;
  },
  signingFingerprint: string | null,
): Promise<boolean> {
  if (!dependencies.boundUserIdForSigningKey) {
    throw new KeyingVerificationError(
      "missing_dependency",
      "Registration requires the durable local identity trust service",
    );
  }
  if (!signingFingerprint) return false;
  const boundUserId =
    await dependencies.boundUserIdForSigningKey(signingFingerprint);
  if (!boundUserId) return false;
  dependencies.log(
    `Registration skipped: this signing key is already bound to ${boundUserId}`,
  );
  return true;
}
