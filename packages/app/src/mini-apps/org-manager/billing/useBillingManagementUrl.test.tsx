import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import {
  createAppHostConfig,
  type OpenSubscriptionManagementFn,
} from "../../../host/AppHostConfig";
import { AppHostConfigProvider } from "../../../providers/host/AppHostConfigProvider";
import * as LogProvider from "../../../providers/logging/LogProvider";
import * as TearleadsProvider from "../../../providers/sdk/TearleadsProvider";
import { ORG_MANAGER_LABELS } from "../labels";
import { useBillingHistory } from "./useBillingHistory";
import {
  useBillingManagementUrl,
  useOpenSubscriptionManagement,
} from "./useBillingManagementUrl";

const spies: { mockRestore: () => void }[] = [];
const originalWindowOpen = window.open;

afterEach(() => {
  cleanup();
  window.open = originalWindowOpen;
  while (spies.length > 0) {
    spies.pop()?.mockRestore();
  }
});

/** Stubs the log actions and records every `logError` call. */
function stubLog() {
  const logged: [string | Error, unknown][] = [];
  spies.push(
    spyOn(LogProvider, "useLog").mockReturnValue({
      log: () => undefined,
      logError: (message, cause) => {
        logged.push([message, cause]);
      },
    }),
  );
  return logged;
}

function stubOrganizations(
  organizations: Record<string, unknown>,
  online = true,
) {
  spies.push(
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
      network: { online },
      organizations,
    } as never),
  );
  return stubLog();
}

function renderOpenManagementHook(
  openSubscriptionManagement?: OpenSubscriptionManagementFn,
) {
  const onNativeManagementClosed = mock(() => undefined);
  const logged = stubLog();
  const hostConfig = createAppHostConfig({
    apiBaseUrl: "http://localhost",
    openSubscriptionManagement,
    wsUrl: "ws://localhost",
  });
  function ManagementWrapper({ children }: PropsWithChildren) {
    return (
      <AppHostConfigProvider value={hostConfig}>
        {children}
      </AppHostConfigProvider>
    );
  }
  const hook = renderHook(
    () => useOpenSubscriptionManagement(onNativeManagementClosed),
    { wrapper: ManagementWrapper },
  );
  return { ...hook, logged, onNativeManagementClosed };
}

test("a managed subscription resolves to its provider URL", async () => {
  stubOrganizations({
    loadBillingManagementUrl: () =>
      Promise.resolve({
        canCancelDirectly: false,
        managementUrl: "https://rc.example/manage",
      }),
  });

  const { result } = renderHook(() => useBillingManagementUrl("org-1", true));

  await waitFor(() =>
    expect(result.current).toEqual({
      managementUrl: "https://rc.example/manage",
    }),
  );
});

test("no managed subscription hides the link rather than erroring", async () => {
  stubOrganizations({
    loadBillingManagementUrl: () =>
      Promise.resolve({
        canCancelDirectly: false,
        managementUrl: null,
      }),
  });

  const { result } = renderHook(() => useBillingManagementUrl("org-1", true));

  await waitFor(() =>
    expect(result.current).toEqual({
      managementUrl: null,
    }),
  );
});

test("a failed lookup degrades to no link and is reported while online", async () => {
  // The manage link is a convenience; a failure must not break the panel.
  const failure = new Error("500");
  const logged = stubOrganizations({
    loadBillingManagementUrl: () => Promise.reject(failure),
  });

  const { result } = renderHook(() => useBillingManagementUrl("org-1", true));

  await waitFor(() =>
    expect(result.current).toEqual({
      managementUrl: null,
    }),
  );
  // The original Error reaches diagnostics; the panel only hides the link.
  expect(logged).toEqual([["Failed to load billing management URL", failure]]);
});

test("a failed lookup while offline is not reported", async () => {
  // Offline, the background read fails on every visit; that is expected.
  const logged = stubOrganizations(
    {
      loadBillingManagementUrl: () =>
        Promise.reject(new TypeError("Failed to fetch")),
    },
    false,
  );

  const { result } = renderHook(() => useBillingManagementUrl("org-1", true));

  await waitFor(() =>
    expect(result.current).toEqual({
      managementUrl: null,
    }),
  );
  expect(logged).toEqual([]);
});

test("a disabled hook never asks", async () => {
  const loadBillingManagementUrl = mock(() =>
    Promise.resolve({
      canCancelDirectly: false,
      managementUrl: "https://rc.example/manage",
    }),
  );
  stubOrganizations({ loadBillingManagementUrl });

  const { result } = renderHook(() => useBillingManagementUrl("org-1", false));

  expect(result.current).toEqual({
    managementUrl: null,
  });
  expect(loadBillingManagementUrl).not.toHaveBeenCalled();
});

test("a URL fetched for a previous org never leaks across a switch", async () => {
  // The scope check is what keeps a stale value from showing under a new org
  // before its own fetch resolves.
  stubOrganizations({
    loadBillingManagementUrl: () =>
      Promise.resolve({
        canCancelDirectly: false,
        managementUrl: "https://rc.example/org-1",
      }),
  });

  const { result, rerender } = renderHook(
    ({ organizationId }) => useBillingManagementUrl(organizationId, true),
    { initialProps: { organizationId: "org-1" } },
  );
  await waitFor(() =>
    expect(result.current).toEqual({
      managementUrl: "https://rc.example/org-1",
    }),
  );

  rerender({ organizationId: "org-2" });
  expect(result.current).toEqual({
    managementUrl: null,
  });
});

test("management opens the provider URL without a native host", () => {
  const opened = mock(() => null);
  window.open = opened as typeof window.open;
  const { result, onNativeManagementClosed } = renderOpenManagementHook();
  const url = "https://apps.apple.com/account/subscriptions";

  act(() => result.current.open(url));

  expect(opened).toHaveBeenCalledWith(url, "_blank", "noopener,noreferrer");
  expect(onNativeManagementClosed).not.toHaveBeenCalled();
});

test("management refreshes after the native sheet closes", async () => {
  const opened = mock(() => null);
  window.open = opened as typeof window.open;
  const openNative = mock(() => Promise.resolve("native-closed" as const));
  const { result, onNativeManagementClosed } =
    renderOpenManagementHook(openNative);
  const url = "https://apps.apple.com/account/subscriptions";

  await act(async () => result.current.open(url));

  expect(openNative).toHaveBeenCalledWith(url);
  await waitFor(() =>
    expect(onNativeManagementClosed).toHaveBeenCalledTimes(1),
  );
  expect(opened).not.toHaveBeenCalled();
});

test("external management does not trigger a billing refresh", async () => {
  const opened = mock(() => null);
  window.open = opened as typeof window.open;
  const openExternal = mock(() => Promise.resolve("external-opened" as const));
  const { result, onNativeManagementClosed } =
    renderOpenManagementHook(openExternal);
  const url = "https://play.google.com/store/account/subscriptions";

  await act(async () => result.current.open(url));

  expect(openExternal).toHaveBeenCalledWith(url);
  expect(onNativeManagementClosed).not.toHaveBeenCalled();
  expect(result.current.error).toBeNull();
});

test("management surfaces a native-sheet failure", async () => {
  const opened = mock(() => null);
  window.open = opened as typeof window.open;
  const nativeError = new Error("StoreKit unavailable");
  const openNative = mock(() => Promise.reject(nativeError));
  const { result, logged, onNativeManagementClosed } =
    renderOpenManagementHook(openNative);
  const url = "https://apps.apple.com/account/subscriptions";

  await act(async () => result.current.open(url));

  await waitFor(() =>
    expect(result.current.error).toBe(
      ORG_MANAGER_LABELS.billingManageSubscriptionFailed,
    ),
  );
  expect(opened).not.toHaveBeenCalled();
  expect(logged).toEqual([
    ["Failed to open subscription management", nativeError],
  ]);
  expect(onNativeManagementClosed).not.toHaveBeenCalled();
});

test("replacing the SDK runtime re-fetches for the same organization", async () => {
  stubOrganizations({
    loadBillingManagementUrl: () =>
      Promise.resolve({
        canCancelDirectly: false,
        managementUrl: "https://rc.example/first",
      }),
  });
  const { rerender, result } = renderHook(() =>
    useBillingManagementUrl("org-1", true),
  );
  await waitFor(() =>
    expect(result.current.managementUrl).toBe("https://rc.example/first"),
  );

  // A runtime replacement (identity switch / SDK re-init) with the same
  // organization and reload token must re-fetch instead of serving the old
  // runtime's state.
  stubOrganizations({
    loadBillingManagementUrl: () =>
      Promise.resolve({
        canCancelDirectly: false,
        managementUrl: "https://rc.example/second",
      }),
  });
  rerender();
  // The old runtime's URL must not be visible even while the new runtime's
  // load is still in flight — its state is scoped out immediately.
  expect(result.current.managementUrl).not.toBe("https://rc.example/first");
  await waitFor(() =>
    expect(result.current.managementUrl).toBe("https://rc.example/second"),
  );
});

// `useBillingHistory` is the sibling scoped load with the same offline gate;
// it shares this harness rather than growing BillingHistory.test.tsx (which
// covers the presentational component) past the file budget.
test("a failed history load surfaces the error and is reported while online", async () => {
  const failure = new Error("500");
  const logged = stubOrganizations({
    loadBillingHistory: () => Promise.reject(failure),
  });

  const { result } = renderHook(() => useBillingHistory("org-1", true));

  await waitFor(() =>
    expect(result.current.error).toBe(
      ORG_MANAGER_LABELS.failedLoadBillingHistory,
    ),
  );
  expect(result.current.entries).toBeNull();
  expect(result.current.loading).toBe(false);
  // The original Error reaches diagnostics alongside the user-facing label.
  expect(logged).toEqual([["Failed to load billing history", failure]]);
});

test("a failed history load while offline is not reported", async () => {
  // Offline, the background read fails on every visit; that is expected.
  const logged = stubOrganizations(
    {
      loadBillingHistory: () =>
        Promise.reject(new TypeError("Failed to fetch")),
    },
    false,
  );

  const { result } = renderHook(() => useBillingHistory("org-1", true));

  await waitFor(() =>
    expect(result.current.error).toBe(
      ORG_MANAGER_LABELS.failedLoadBillingHistory,
    ),
  );
  expect(logged).toEqual([]);
});
