import { KeyingVerificationError } from "@tearleads/crypto";
import {
  isTrustedUserIdentity,
  type TrustedUserIdentityResolver,
} from "./types";

const unavailableTrustedUserIdentityResolver: TrustedUserIdentityResolver =
  async () => {
    throw new KeyingVerificationError(
      "missing_dependency",
      "Trusted user identity resolution is unavailable in this runtime",
    );
  };

/** Normalize an adapter input without weakening cryptographic call sites. */
export function requireTrustedUserIdentityResolver(
  resolver: TrustedUserIdentityResolver | null | undefined,
): TrustedUserIdentityResolver {
  const requiredResolver = resolver ?? unavailableTrustedUserIdentityResolver;
  return async (userId) => {
    const identity = await requiredResolver(userId);
    if (!identity) {
      return null;
    }
    if (!isTrustedUserIdentity(identity)) {
      throw new KeyingVerificationError(
        "invalid_shape",
        "User identity resolver returned an untrusted identity value",
      );
    }
    if (identity.userId !== userId) {
      throw new KeyingVerificationError(
        "object_mismatch",
        "User identity resolver returned a different user",
      );
    }
    return identity;
  };
}
