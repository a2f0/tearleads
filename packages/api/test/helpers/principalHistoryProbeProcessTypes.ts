import type { startPrincipalHistoryHttpProbe } from "./principalHistoryHttpProbe";

export type PrincipalHistoryHttpMetrics = ReturnType<
  typeof startPrincipalHistoryHttpProbe
>["metrics"];

export interface PrincipalHistoryServerMemory {
  readonly initialRssBytes: number;
  readonly initialHeapUsedBytes: number;
  readonly retainedRssBytes: number;
  readonly retainedHeapUsedBytes: number;
}

export type PrincipalHistoryProbeMessage =
  | { readonly type: "ready"; readonly url: string; readonly token: string }
  | {
      readonly type: "stopped";
      readonly metrics: PrincipalHistoryHttpMetrics;
      readonly memory: PrincipalHistoryServerMemory;
    };
