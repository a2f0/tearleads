import { act } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { useMemo } from "react";
import {
  type IdentityLinkResolver,
  IdentityLinkResolverContext,
} from "../../src/providers/identity-links/IdentityLinkResolverProvider";

const NO_LINKS: Readonly<Record<string, string>> = {};

/**
 * Stands in for the SDK's `createLinkFor`: only users in `links` (the ones a
 * verified link pinned) resolve; every other user has no identity link.
 */
export function TestIdentityLinkResolver({
  children,
  links = NO_LINKS,
}: PropsWithChildren<{
  links?: Readonly<Record<string, string>> | undefined;
}>) {
  const value = useMemo<IdentityLinkResolver>(
    () => ({
      createLinkFor: async (userId) => links[userId] ?? null,
      isCurrent: () => true,
    }),
    [links],
  );
  return (
    <IdentityLinkResolverContext.Provider value={value}>
      {children}
    </IdentityLinkResolverContext.Provider>
  );
}

/** Lets a test resolver's pending lookups settle before asserting absence. */
export async function flushIdentityLinkResolution(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Records clipboard writes; call the returned restore in `afterEach`. */
export function mockClipboardWrites(): {
  restore: () => void;
  writes: string[];
} {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const writes: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        writes.push(value);
      },
    },
  });
  return {
    restore: () => {
      if (original) {
        Object.defineProperty(navigator, "clipboard", original);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    },
    writes,
  };
}
