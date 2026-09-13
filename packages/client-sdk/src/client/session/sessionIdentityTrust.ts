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
