import type { TransportGate } from "./createTransportGate";

export type TransportFaultAction =
  | { kind: "forward" }
  | { kind: "response"; response: () => Response }
  | { kind: "network-error"; message?: string }
  | { kind: "lost-response"; message?: string };

export interface TransportFaultStep {
  name: string;
  method: string;
  url: string;
  action: TransportFaultAction;
  gate?: TransportGate;
  expectedOutcome?: TransportExpectedOutcome;
}

export type TransportExpectedOutcome =
  | "response"
  | "network-error"
  | "lost-response"
  | "aborted";

export interface TransportAttempt {
  sequence: number;
  step: string | null;
  method: string;
  url: string;
  expectedOutcome: TransportExpectedOutcome | null;
  outcome:
    | "pending"
    | "response"
    | "network-error"
    | "lost-response"
    | "aborted"
    | "delegate-error"
    | "unexpected";
  status: number | null;
  error: string | null;
}

export interface TransportFaultHarness {
  readonly fetch: typeof globalThis.fetch;
  readonly attempts: readonly Readonly<TransportAttempt>[];
  assertComplete(): void;
  /** Serial scope for clients that use global fetch; await every request. */
  run<T>(work: () => T | Promise<T>): Promise<T>;
}
