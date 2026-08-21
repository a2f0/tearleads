import { afterEach, expect, test } from "bun:test";
import type { OrganizationDataUsage } from "@symcrypt/client-sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useOrgManagerScopedDataUsage } from "./useOrgManagerScopedDataUsage";

afterEach(() => cleanup());

const USAGE: OrganizationDataUsage = {
  organizationId: "org-1",
  blobs: { blobCount: 1, byteLength: 2 },
  documents: {
    breakdown: [],
    byteLength: 3,
    documentCount: 1,
    updateCount: 1,
  },
  totalByteLength: 5,
};

test("usage is hidden in the committed render when requester scope changes", () => {
  const hook = renderHook(
    ({ scopeKey }) => useOrgManagerScopedDataUsage(scopeKey),
    { initialProps: { scopeKey: "org-1:user-a:db-1" } },
  );
  act(() => hook.result.current.setDataUsage(USAGE));
  expect(hook.result.current.dataUsage).toBe(USAGE);
  expect(hook.result.current.dataUsageRef.current).toBe(USAGE);

  hook.rerender({ scopeKey: "org-1:user-b:db-1" });

  expect(hook.result.current.dataUsage).toBeNull();
  expect(hook.result.current.dataUsageRef.current).toBeNull();
});

test("stale scope setters cannot retag usage into the active requester", () => {
  const hook = renderHook(
    ({ scopeKey }) => useOrgManagerScopedDataUsage(scopeKey),
    { initialProps: { scopeKey: "org-1:user-a:db-1" } },
  );
  const staleSetter = hook.result.current.setDataUsage;
  hook.rerender({ scopeKey: "org-1:user-b:db-1" });

  act(() => hook.result.current.setDataUsage(USAGE));
  expect(hook.result.current.dataUsage).toBe(USAGE);

  act(() => staleSetter(null));

  expect(hook.result.current.dataUsage).toBe(USAGE);
  expect(hook.result.current.dataUsageRef.current).toBe(USAGE);
});
