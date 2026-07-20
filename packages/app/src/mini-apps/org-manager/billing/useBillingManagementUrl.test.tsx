import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import * as TearleadsProvider from "../../../providers/sdk/TearleadsProvider";
import { useBillingManagementUrl } from "./useBillingManagementUrl";

const spies: { mockRestore: () => void }[] = [];

afterEach(() => {
  cleanup();
  while (spies.length > 0) {
    spies.pop()?.mockRestore();
  }
});

function stubOrganizations(organizations: Record<string, unknown>) {
  spies.push(
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
      organizations,
    } as never),
  );
}

test("a managed subscription resolves to its provider URL", async () => {
  stubOrganizations({
    loadBillingManagementUrl: () =>
      Promise.resolve({ managementUrl: "https://rc.example/manage" }),
  });

  const { result } = renderHook(() => useBillingManagementUrl("org-1", true));

  await waitFor(() => expect(result.current).toBe("https://rc.example/manage"));
});

test("no managed subscription hides the link rather than erroring", async () => {
  stubOrganizations({
    loadBillingManagementUrl: () => Promise.resolve({ managementUrl: null }),
  });

  const { result } = renderHook(() => useBillingManagementUrl("org-1", true));

  await waitFor(() => expect(result.current).toBeNull());
});

test("a failed lookup degrades to no link", async () => {
  // The manage link is a convenience; a failure must not break the panel.
  stubOrganizations({
    loadBillingManagementUrl: () => Promise.reject(new Error("500")),
  });

  const { result } = renderHook(() => useBillingManagementUrl("org-1", true));

  await waitFor(() => expect(result.current).toBeNull());
});

test("a disabled hook never asks", async () => {
  const loadBillingManagementUrl = mock(() =>
    Promise.resolve({ managementUrl: "https://rc.example/manage" }),
  );
  stubOrganizations({ loadBillingManagementUrl });

  const { result } = renderHook(() => useBillingManagementUrl("org-1", false));

  expect(result.current).toBeNull();
  expect(loadBillingManagementUrl).not.toHaveBeenCalled();
});

test("a URL fetched for a previous org never leaks across a switch", async () => {
  // The scope check is what keeps a stale value from showing under a new org
  // before its own fetch resolves.
  stubOrganizations({
    loadBillingManagementUrl: () =>
      Promise.resolve({ managementUrl: "https://rc.example/org-1" }),
  });

  const { result, rerender } = renderHook(
    ({ organizationId }) => useBillingManagementUrl(organizationId, true),
    { initialProps: { organizationId: "org-1" } },
  );
  await waitFor(() => expect(result.current).toBe("https://rc.example/org-1"));

  rerender({ organizationId: "org-2" });
  expect(result.current).toBeNull();
});
