import { KeyingVerificationError } from "@tearleads/crypto";
import type { LocalUserIdentityCandidate } from "../../data/trustedUserIdentity";
import type { Identity, IdentitySnapshot } from "../identity";

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
