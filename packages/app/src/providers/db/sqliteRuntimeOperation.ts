import type { SQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import type { RefObject } from "react";

export interface SQLiteRuntimeOperation {
  readonly kind: "close" | "delete" | "purge" | "release";
  readonly promise: Promise<void>;
  readonly runtime: SQLiteRuntime | null;
}

export interface RuntimeRefs {
  readonly bootGenerationRef: RefObject<number>;
  readonly bootingRef: RefObject<boolean>;
  readonly currentDbNameRef: RefObject<string | null>;
  readonly runtimeOperationRef: RefObject<SQLiteRuntimeOperation | null>;
  readonly runtimeRef: RefObject<SQLiteRuntime | null>;
}

export function trackRuntimeOperation(
  refs: RuntimeRefs,
  runtime: SQLiteRuntime | null,
  result: Promise<void>,
  kind: SQLiteRuntimeOperation["kind"],
): Promise<void> {
  let operation!: SQLiteRuntimeOperation;
  // A close can overlap a named OPFS purge, but neither may release the boot
  // gate before the other settles. Callers still receive their own result/error.
  const settled = Promise.allSettled([
    refs.runtimeOperationRef.current?.promise,
    result,
  ]).then(() => {});
  operation = {
    kind,
    promise: settled.finally(() => {
      if (refs.runtimeOperationRef.current === operation) {
        refs.runtimeOperationRef.current = null;
      }
    }),
    runtime,
  };
  refs.runtimeOperationRef.current = operation;
  return result;
}
