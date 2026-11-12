import { KeyingVerificationError } from "@tearleads/crypto";
import {
  isTrustedUserIdentity,
  type StagedUserIdentityOptions,
  type StagedUserIdentityResolver,
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
  if (resolver.withPinnedIdentities) {
    const withPinnedIdentities = resolver.withPinnedIdentities;
    Object.assign(adapter, {
      withPinnedIdentities: <T>(
        userIds: readonly string[],
        verify: (resolve: StagedUserIdentityResolver) => Promise<T>,
        options: StagedUserIdentityOptions,
      ) =>
        withPinnedIdentities(
          userIds,
          (staged) =>
            verify(async (userId) => {
              const identity = await staged(userId);
              if (identity && identity.userId !== userId)
                throw new KeyingVerificationError(
                  "object_mismatch",
                  "User identity resolver returned a different user",
                );
              return identity;
            }),
          options,
        ),
    });
  }
  resolverAdaptersByResolver.set(resolver, adapter);
  resolverAdaptersByResolver.set(adapter, adapter);
  return adapter;
}
