import { KeyingVerificationError } from "@tearleads/crypto";
import {
  isTrustedUserIdentity,
  type TrustedUserIdentityResolver,
} from "./types";

const resolverAdaptersByResolver = new WeakMap<
  TrustedUserIdentityResolver,
  TrustedUserIdentityResolver
>();

/** Normalize an adapter without weakening call sites or churning its identity. */
export function requireTrustedUserIdentityResolver(
  resolver: TrustedUserIdentityResolver,
): TrustedUserIdentityResolver {
  const existingAdapter = resolverAdaptersByResolver.get(resolver);
  if (existingAdapter) {
    return existingAdapter;
  }

  const adapter: TrustedUserIdentityResolver = async (userId) => {
    const identity = await resolver(userId);
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
  resolverAdaptersByResolver.set(resolver, adapter);
  resolverAdaptersByResolver.set(adapter, adapter);
  return adapter;
}
