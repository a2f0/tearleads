import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useAsyncDerivedState } from "./useAsyncDerivedState";

afterEach(cleanup);

interface Deferred<T> {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const createEmptyValue = () => "empty";
const noopLogError = () => undefined;

describe("useAsyncDerivedState", () => {
  test("derives a source and resets after the source clears", async () => {
    const pending = deferred<string>();
    const view = renderHook(
      ({ source }: { source: string | null }) =>
        useAsyncDerivedState({
          createEmptyValue,
          derive: () => pending.promise,
          errorMessage: "derive failed",
          logError: noopLogError,
          source,
        }),
      { initialProps: { source: "first" as string | null } },
    );

    expect(view.result.current).toBe("empty");
    await act(async () => pending.resolve("derived"));
    expect(view.result.current).toBe("derived");

    view.rerender({ source: null });
    expect(view.result.current).toBe("empty");
  });

  test("keeps the prior value until a replacement source settles", async () => {
    const pendingBySource = new Map<string, Deferred<string>>();
    const derive = (source: string) => {
      const pending = deferred<string>();
      pendingBySource.set(source, pending);
      return pending.promise;
    };
    const view = renderHook(
      ({ source }: { source: string }) =>
        useAsyncDerivedState({
          createEmptyValue,
          derive,
          errorMessage: "derive failed",
          logError: noopLogError,
          source,
        }),
      { initialProps: { source: "first" } },
    );

    await act(async () => pendingBySource.get("first")?.resolve("first value"));
    view.rerender({ source: "second" });
    expect(view.result.current).toBe("first value");

    await act(async () =>
      pendingBySource.get("second")?.resolve("second value"),
    );
    expect(view.result.current).toBe("second value");
  });

  test("ignores stale results and reports only the active source error", async () => {
    const pendingBySource = new Map<string, Deferred<string>>();
    const derive = (source: string) => {
      const pending = deferred<string>();
      pendingBySource.set(source, pending);
      return pending.promise;
    };
    const logged: Array<[string | Error, unknown]> = [];
    const logError = (message: string | Error, cause?: unknown) => {
      logged.push([message, cause]);
    };
    const view = renderHook(
      ({ source }: { source: string }) =>
        useAsyncDerivedState({
          createEmptyValue,
          derive,
          errorMessage: "derive failed",
          logError,
          source,
        }),
      { initialProps: { source: "stale" } },
    );

    view.rerender({ source: "active" });
    await act(async () => pendingBySource.get("stale")?.resolve("stale value"));
    expect(view.result.current).toBe("empty");

    const error = new Error("active failure");
    await act(async () => pendingBySource.get("active")?.reject(error));
    expect(view.result.current).toBe("empty");
    expect(logged).toEqual([["derive failed", error]]);
  });
});
