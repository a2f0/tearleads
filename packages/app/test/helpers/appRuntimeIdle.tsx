import {
  type DomainScope,
  hasDomainSyncCoordinatorPendingWork,
  waitForDomainSyncCoordinatorToSettle,
} from "@tearleads/client-sdk";
import { useEffect } from "react";
import { useTearleadsRuntime } from "../../src/providers/sdk/TearleadsProvider";
import { getProxiedApiNetworkActivitySnapshot } from "./mswServer";

interface AppTestRuntimeSettleOptions {
  apiQuietMs?: number;
  intervalMs?: number;
  syncQuietMs?: number;
  timeoutMs?: number;
}

const DEFAULT_APP_TEST_RUNTIME_API_QUIET_MS = 25;
const DEFAULT_APP_TEST_RUNTIME_INTERVAL_MS = 10;
const DEFAULT_APP_TEST_RUNTIME_SYNC_QUIET_MS = 0;
const DEFAULT_APP_TEST_RUNTIME_TIMEOUT_MS = 500;

const activeDomainScopeMountCounts = new Map<DomainScope, number>();

function remainingTimeoutMs(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasObservedDomainSyncPendingWork(): boolean {
  for (const domainScope of activeDomainScopeMountCounts.keys()) {
    if (hasDomainSyncCoordinatorPendingWork(domainScope)) {
      return true;
    }
  }

  return false;
}

async function waitForObservedDomainSyncScopesToSettle(
  deadline: number,
  options: Required<
    Pick<AppTestRuntimeSettleOptions, "intervalMs" | "syncQuietMs">
  >,
): Promise<boolean> {
  const domainScopes = [...activeDomainScopeMountCounts.keys()];
  if (domainScopes.length === 0) {
    return true;
  }

  const timeoutMs = remainingTimeoutMs(deadline);
  if (timeoutMs <= 0) {
    return false;
  }

  const results = await Promise.all(
    domainScopes.map((domainScope) =>
      waitForDomainSyncCoordinatorToSettle(domainScope, {
        intervalMs: options.intervalMs,
        quietMs: options.syncQuietMs,
        timeoutMs,
      }),
    ),
  );

  return results.every(Boolean);
}

async function waitForAppTestRuntimeFinalDrain(input: {
  deadline: number;
  intervalMs: number;
  quietMs: number;
}): Promise<boolean> {
  const { deadline, intervalMs, quietMs } = input;
  let lastCompletedRequestCount =
    getProxiedApiNetworkActivitySnapshot().completedRequestCount;
  let quietStartedAt = Date.now();

  while (Date.now() <= deadline) {
    const activity = getProxiedApiNetworkActivitySnapshot();
    if (
      activity.activeRequestCount === 0 &&
      activity.completedRequestCount === lastCompletedRequestCount &&
      !hasObservedDomainSyncPendingWork()
    ) {
      if (Date.now() - quietStartedAt >= quietMs) {
        return true;
      }
    } else {
      lastCompletedRequestCount = activity.completedRequestCount;
      quietStartedAt = Date.now();
    }

    await delay(intervalMs);
  }

  return false;
}

export function AppTestRuntimeScopeProbe() {
  const {
    state: { domainScope },
  } = useTearleadsRuntime();

  useEffect(() => {
    activeDomainScopeMountCounts.set(
      domainScope,
      (activeDomainScopeMountCounts.get(domainScope) ?? 0) + 1,
    );
    return () => {
      const nextCount =
        (activeDomainScopeMountCounts.get(domainScope) ?? 1) - 1;
      if (nextCount > 0) {
        activeDomainScopeMountCounts.set(domainScope, nextCount);
      } else {
        activeDomainScopeMountCounts.delete(domainScope);
      }
    };
  }, [domainScope]);

  return null;
}

export async function waitForAppTestRuntimeToSettle(
  options: AppTestRuntimeSettleOptions = {},
): Promise<boolean> {
  const apiQuietMs =
    options.apiQuietMs ?? DEFAULT_APP_TEST_RUNTIME_API_QUIET_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_APP_TEST_RUNTIME_INTERVAL_MS;
  const syncQuietMs =
    options.syncQuietMs ?? DEFAULT_APP_TEST_RUNTIME_SYNC_QUIET_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_APP_TEST_RUNTIME_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const syncOptions = { intervalMs, syncQuietMs };

  if (!(await waitForObservedDomainSyncScopesToSettle(deadline, syncOptions))) {
    return false;
  }

  return waitForAppTestRuntimeFinalDrain({
    deadline,
    intervalMs,
    quietMs: apiQuietMs,
  });
}
