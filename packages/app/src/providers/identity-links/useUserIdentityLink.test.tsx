import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import {
  type IdentityLinkResolver,
  IdentityLinkResolverContext,
} from "./IdentityLinkResolverProvider";
import { useUserIdentityLink } from "./useUserIdentityLink";

afterEach(cleanup);

function deferredResolver() {
  const pending = new Map<string, (link: string | null) => void>();
  let current = true;
  const resolver: IdentityLinkResolver = {
    createLinkFor: (userId) =>
      new Promise((resolve) => {
        pending.set(userId, resolve);
      }),
    isCurrent: () => current,
  };
  return {
    resolve: async (userId: string, link: string | null) => {
      await act(async () => {
        pending.get(userId)?.(link);
      });
    },
    resolver,
    retire: () => {
      current = false;
    },
  };
}

function wrapperFor(resolver: IdentityLinkResolver) {
  return ({ children }: PropsWithChildren) => (
    <IdentityLinkResolverContext.Provider value={resolver}>
      {children}
    </IdentityLinkResolverContext.Provider>
  );
}

test("a link for a previous user never shows for the current one", async () => {
  const deferred = deferredResolver();
  const initialProps: { userId: string | null } = { userId: "ada" };
  const { rerender, result } = renderHook(
    ({ userId }: { userId: string | null }) => useUserIdentityLink(userId),
    {
      initialProps,
      wrapper: wrapperFor(deferred.resolver),
    },
  );
  expect(result.current).toEqual({ error: null, link: null, pending: true });

  rerender({ userId: "grace" });
  await deferred.resolve("ada", "https://app.example.test/ada");
  expect(result.current).toEqual({ error: null, link: null, pending: true });

  await deferred.resolve("grace", "https://app.example.test/grace");
  expect(result.current).toEqual({
    error: null,
    link: "https://app.example.test/grace",
    pending: false,
  });

  rerender({ userId: null });
  expect(result.current).toEqual({ error: null, link: null, pending: false });
});

test("a link resolved after the database changed is dropped", async () => {
  const deferred = deferredResolver();
  const { result } = renderHook(() => useUserIdentityLink("ada"), {
    wrapper: wrapperFor(deferred.resolver),
  });

  deferred.retire();
  await deferred.resolve("ada", "https://app.example.test/ada");
  expect(result.current).toEqual({ error: null, link: null, pending: true });
});

test("a failed lookup reports its message", async () => {
  const resolver: IdentityLinkResolver = {
    createLinkFor: async () => {
      throw new Error("Configure the web app URL");
    },
    isCurrent: () => true,
  };
  const { result } = renderHook(() => useUserIdentityLink("ada"), {
    wrapper: wrapperFor(resolver),
  });

  await act(async () => {});
  expect(result.current).toEqual({
    error: "Configure the web app URL",
    link: null,
    pending: false,
  });
});

test("useUserIdentityLink requires its resolver provider", () => {
  expect(() => renderHook(() => useUserIdentityLink("ada"))).toThrow(
    "useIdentityLinkResolver must be used within an IdentityLinkResolverProvider.",
  );
});
