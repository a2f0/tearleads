import { type DependencyList, useMemo } from "react";
import { useTearleadsRuntime } from "./TearleadsProvider";

/**
 * Memoizes an SDK handle until an explicit input changes or any SDK runtime
 * version notification rotates the runtime snapshot identity.
 *
 * Pass a fixed-length dependency array literal. Keep a narrower `useMemo` when
 * rotating a handle would trigger an immediate or user-visible side effect.
 */
export function useRuntimeScopedMemo<T>(
  factory: () => T,
  dependencies: DependencyList,
): T {
  const runtime = useTearleadsRuntime();

  return useMemo(factory, [runtime, ...dependencies]);
}
