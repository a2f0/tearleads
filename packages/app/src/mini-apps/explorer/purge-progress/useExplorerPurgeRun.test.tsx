import { afterEach, expect, mock, test } from "bun:test";
import type { PurgeOptions } from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useExplorerPurgeRun } from "./useExplorerPurgeRun";

afterEach(() => cleanup());

function renderPurgeRun(
  overrides: Partial<Parameters<typeof useExplorerPurgeRun>[0]> = {},
) {
  const params = {
    emptyTrash: async () => true,
    logError: mock(() => {}),
    online: true,
    onSettled: () => {},
    purgeContainer: async () => true,
    ...overrides,
  };
  return { params, ...renderHook(() => useExplorerPurgeRun(params)) };
}

test("a Stop that surfaces as an AbortError rejection settles as cancelled", async () => {
  // The purge rejects once its signal aborts — modeling an aborted fetch/DB
  // transaction. classification must key off signal.aborted, not the .catch.
  const purgeContainer = (_id: string, options?: PurgeOptions) =>
    new Promise<boolean>((_, reject) => {
      options?.signal?.addEventListener("abort", () =>
        reject(new Error("aborted")),
      );
    });
  const { params, result } = renderPurgeRun({ purgeContainer });

  act(() => result.current.startContainerPurge("c1", "Folder"));
  expect(result.current.run?.status).toBe("running");

  act(() => result.current.cancel());

  await waitFor(() => expect(result.current.run?.status).toBe("cancelled"));
  expect(result.current.run?.error).toBeNull();
  // A user-initiated cancel is not an error, so it must not be logged.
  expect(params.logError).not.toHaveBeenCalled();
});

test("a non-abort rejection settles as failed and is logged", async () => {
  const purgeContainer = async () => {
    throw new Error("boom");
  };
  const { params, result } = renderPurgeRun({ purgeContainer });

  act(() => result.current.startContainerPurge("c1", "Folder"));

  await waitFor(() => expect(result.current.run?.status).toBe("failed"));
  expect(params.logError).toHaveBeenCalledTimes(1);
});

test("unmounting mid-run aborts the in-flight purge", () => {
  let capturedSignal: AbortSignal | undefined;
  const purgeContainer = (_id: string, options?: PurgeOptions) => {
    capturedSignal = options?.signal;
    // Never settles: the run stays active until the hook unmounts.
    return new Promise<boolean>(() => {});
  };
  const { result, unmount } = renderPurgeRun({ purgeContainer });

  act(() => result.current.startContainerPurge("c1", "Folder"));
  expect(capturedSignal?.aborted).toBe(false);

  unmount();

  expect(capturedSignal?.aborted).toBe(true);
});
