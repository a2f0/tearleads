import type { NegativeControl } from "./protocolNegativeControls";

export const SESSION_RETRY_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "session-retry-blind-token-change",
    module: "formal/local-trust/SessionRetryIdentity.tla",
    config: "formal/local-trust/SessionRetryIdentity.cfg",
    constants: { RequireKnownReplacement: "FALSE", RecheckDispatch: "FALSE" },
    expect: { kind: "invariant", name: "RetryKeepsActor" },
    why: "An expired request must not execute under a replacement identity (#2485 finding 3).",
  },
  {
    id: "session-retry-renewal-switch",
    module: "formal/local-trust/SessionRetryIdentity.tla",
    config: "formal/local-trust/SessionRetryIdentity.cfg",
    constants: { BindRenewalCompletion: "FALSE" },
    expect: { kind: "invariant", name: "RetryKeepsActor" },
    why: "An expired request must not execute under a replacement identity (#2485 finding 3).",
  },
  {
    id: "session-retry-notification-switch",
    module: "formal/local-trust/SessionRetryIdentity.tla",
    config: "formal/local-trust/SessionRetryIdentity.cfg",
    constants: { RecheckDispatch: "FALSE" },
    expect: { kind: "invariant", name: "RetryKeepsActor" },
    why: "An expired request must not execute under a replacement identity (#2485 finding 3).",
  },
];
