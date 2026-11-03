import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from "react";
import { useTearleads, useTearleadsRuntime } from "../sdk/TearleadsProvider";
import { useIdentityLinks } from "./useIdentityLinks";

/**
 * Resolves another user's identity link for display surfaces. A new value is
 * provided whenever the signed-in identity or the active database changes, so
 * consumers can key their requests by it.
 */
export interface IdentityLinkResolver {
  readonly createLinkFor: (userId: string) => Promise<string | null>;
  /** False once the database this resolver was created for is replaced. */
  readonly isCurrent: () => boolean;
}

export const IdentityLinkResolverContext =
  createContext<IdentityLinkResolver | null>(null);

export function IdentityLinkResolverProvider({ children }: PropsWithChildren) {
  const sdk = useTearleads();
  const runtime = useTearleadsRuntime();
  const { createLinkFor } = useIdentityLinks();
  const domainScope = sdk.domainScope;
  const authUserId = runtime.auth.userId;
  const signingFingerprint = runtime.crypto.signingFingerprint;
  const value = useMemo<IdentityLinkResolver>(
    () => ({
      createLinkFor,
      isCurrent: () => {
        const current = sdk.runtime.input();
        return (
          sdk.domainScope === domainScope &&
          current.auth.userId === authUserId &&
          current.crypto.signingFingerprint === signingFingerprint
        );
      },
    }),
    [authUserId, createLinkFor, domainScope, sdk, signingFingerprint],
  );

  return (
    <IdentityLinkResolverContext.Provider value={value}>
      {children}
    </IdentityLinkResolverContext.Provider>
  );
}

export function useIdentityLinkResolver(): IdentityLinkResolver {
  const resolver = useContext(IdentityLinkResolverContext);
  if (!resolver) {
    throw new Error(
      "useIdentityLinkResolver must be used within an IdentityLinkResolverProvider.",
    );
  }
  return resolver;
}
