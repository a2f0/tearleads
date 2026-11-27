import type { NegativeControl } from "./protocolNegativeControlTypes";

const MODULE = "formal/local-trust/TransactionLease.tla";
const CONFIG = "formal/local-trust/TransactionLease.cfg";

export const TRANSACTION_LEASE_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "transaction-lease-shared-handle",
    module: MODULE,
    config: CONFIG,
    constants: { UseLease: "FALSE" },
    expect: { kind: "invariant", name: "NoForeignStatementInTransaction" },
    why: "Without the lease another tab's statement runs inside a transaction on the shared handle (#3318).",
  },
  {
    id: "transaction-lease-sweep-keeps-dead-holder",
    module: MODULE,
    config: CONFIG,
    constants: { SweepDisconnect: "FALSE" },
    expect: { kind: "liveness", name: "DeadHolderReleased" },
    why: "An owner sweep that only closes its end of the port leaves a dead tab's transaction holding the lease until idle revocation, which needs a waiter (#3318).",
  },
  {
    id: "transaction-lease-frozen-holder-blocks",
    module: MODULE,
    config: CONFIG,
    constants: { IdleRevocation: "FALSE" },
    expect: { kind: "liveness", name: "WaiterRuns" },
    why: "Without idle revocation a frozen tab's open transaction refuses every other tab's statement forever (#3318).",
  },
  {
    id: "transaction-lease-refused-statement-runs",
    module: MODULE,
    config: CONFIG,
    constants: { RefuseDrops: "FALSE" },
    expect: { kind: "invariant", name: "RefusedStatementNeverRuns" },
    why: "A statement answered busy must leave the queue, or it runs after its caller saw it fail (#3318).",
  },
];
