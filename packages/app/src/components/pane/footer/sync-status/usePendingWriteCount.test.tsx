import { afterEach, expect, test } from "bun:test";
import type {
  ContainerDocumentQueries,
  DomainScope,
  PendingWriteQueueItem,
} from "@tearleads/client-sdk";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { usePendingWriteCount } from "./usePendingWriteCount";

afterEach(cleanup);

// A stub exercising only the one method the hook calls; the real coordinator /
// persisted-document subscriptions are harmless in-memory registrations keyed by
// the (opaque) domain scope, so no SDK mocking is needed.
function queriesWithCount(count: number): ContainerDocumentQueries {
  const item: PendingWriteQueueItem = {
    containerId: null,
    createdAt: null,
    localId: "local",
    name: null,
    namespace: null,
    objectKind: "document",
    operations: [
      {
        byteLength: 0,
        count,
        createdAt: null,
        kind: "update",
        lastAttemptedAt: null,
        lastError: null,
        status: "pending",
        targetContainerId: null,
        updatedAt: null,
      },
    ],
    organizationId: null,
    remoteId: null,
    status: "pending",
    updatedAt: null,
  };
  return {
    listPendingWrites: async () => (count > 0 ? [item] : []),
  } as unknown as ContainerDocumentQueries;
}

const scope = {} as DomainScope;

test("stays in the loading state until the db is ready", () => {
  const queries = queriesWithCount(2);
  const { result } = renderHook(() =>
    usePendingWriteCount(queries, scope, false),
  );
  expect(result.current).toEqual({
    loaded: false,
    count: 0,
    failedCount: 0,
    firstError: null,
  });
});

test("populates the count once the first read resolves", async () => {
  const queries = queriesWithCount(2);
  const { result } = renderHook(() =>
    usePendingWriteCount(queries, scope, true),
  );

  expect(result.current.loaded).toBe(false);
  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.count).toBe(2);
});

test("resets to loading when the db goes not-ready", async () => {
  const queries = queriesWithCount(3);
  const { result, rerender } = renderHook(
    ({ ready }: { ready: boolean }) =>
      usePendingWriteCount(queries, scope, ready),
    { initialProps: { ready: true } },
  );

  await waitFor(() => expect(result.current.loaded).toBe(true));
  rerender({ ready: false });
  expect(result.current).toEqual({
    loaded: false,
    count: 0,
    failedCount: 0,
    firstError: null,
  });
});
