import { expect, mock, test } from "bun:test";
import type { DataUsageRefreshOptions } from "../refresh";
import {
  refreshDataUsageOnEntry,
  shouldRefreshDataUsageAfterSync,
} from "./useOrgManagerDataUsageRefresh";

test("usage entry paints local data before reconciling once", async () => {
  let resolveLocal = () => {};
  const local = new Promise<void>((resolve) => {
    resolveLocal = resolve;
  });
  const refreshDataUsage = mock(async (options = {}) => {
    if (Reflect.get(options, "localOnly") === true) {
      await local;
    }
  });

  const entry = refreshDataUsageOnEntry({
    cancelled: () => false,
    readPending: () => false,
    refreshDataUsage,
  });
  await Promise.resolve();
  expect(refreshDataUsage).toHaveBeenCalledTimes(1);
  expect(refreshDataUsage.mock.calls[0]?.[0]).toEqual({
    clearError: false,
    localOnly: true,
    manageLoading: false,
  });

  resolveLocal();
  await entry;
  expect(refreshDataUsage).toHaveBeenCalledTimes(2);
  expect(refreshDataUsage.mock.calls[1]?.[0]).toEqual({
    clearError: true,
    manageLoading: false,
  });
});

test("usage entry does not reconcile after the view leaves", async () => {
  let cancelled = false;
  const refreshDataUsage = mock(async () => {
    cancelled = true;
  });

  await refreshDataUsageOnEntry({
    cancelled: () => cancelled,
    readPending: () => false,
    refreshDataUsage,
  });

  expect(refreshDataUsage).toHaveBeenCalledTimes(1);
});

test("usage entry lets pending sync own the remote reconcile", async () => {
  const refreshDataUsage = mock(
    async (_options?: DataUsageRefreshOptions) => {},
  );

  await refreshDataUsageOnEntry({
    cancelled: () => false,
    readPending: () => true,
    refreshDataUsage,
  });

  expect(refreshDataUsage).toHaveBeenCalledTimes(1);
  expect(refreshDataUsage.mock.calls[0]?.[0]).toEqual({
    clearError: false,
    localOnly: true,
    manageLoading: false,
  });
});

test("usage entry rechecks pending sync after painting local data", async () => {
  let pending = false;
  let resolveLocal = () => {};
  const local = new Promise<void>((resolve) => {
    resolveLocal = resolve;
  });
  const refreshDataUsage = mock(async (options = {}) => {
    if (Reflect.get(options, "localOnly") === true) {
      await local;
    }
  });

  const entry = refreshDataUsageOnEntry({
    cancelled: () => false,
    readPending: () => pending,
    refreshDataUsage,
  });
  await Promise.resolve();
  pending = true;
  resolveLocal();
  await entry;

  expect(refreshDataUsage).toHaveBeenCalledTimes(1);
});

test("usage refresh waits for visible sync work to settle", () => {
  expect(
    shouldRefreshDataUsageAfterSync({
      enabled: true,
      pending: false,
      previouslyPending: true,
      visible: true,
    }),
  ).toBe(true);
  expect(
    shouldRefreshDataUsageAfterSync({
      enabled: true,
      pending: true,
      previouslyPending: false,
      visible: true,
    }),
  ).toBe(false);
  expect(
    shouldRefreshDataUsageAfterSync({
      enabled: true,
      pending: false,
      previouslyPending: true,
      visible: false,
    }),
  ).toBe(false);
  expect(
    shouldRefreshDataUsageAfterSync({
      enabled: false,
      pending: false,
      previouslyPending: true,
      visible: true,
    }),
  ).toBe(false);
});
