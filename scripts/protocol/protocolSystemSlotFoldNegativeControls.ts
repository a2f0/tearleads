import type { NegativeControl } from "./protocolNegativeControlTypes";

const MODULE = "formal/local-trust/SystemSlotFold.tla";
const CONFIG = "formal/local-trust/SystemSlotFold.cfg";

export const SYSTEM_SLOT_FOLD_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "root-fold-posts-system-create-before-listing",
    module: MODULE,
    config: CONFIG,
    constants: { HoldOnFold: "FALSE" },
    expect: { kind: "invariant", name: "NoPostBeforeFoldingListing" },
    why: "A system-slot create re-homed onto the account root must wait for that root's listing, which folds the local copy, before it posts (#3290).",
  },
  {
    id: "slot-taken-create-retried-as-stale",
    module: MODULE,
    config: CONFIG,
    constants: { TypedSlotConflict: "FALSE" },
    expect: { kind: "invariant", name: "AtMostOnePost" },
    why: "A create refused for a taken system slot must not be retried as a stale parent (#3290).",
  },
  {
    id: "refused-create-reposted-in-same-pass",
    module: MODULE,
    config: CONFIG,
    constants: { ParkRefused: "FALSE" },
    expect: { kind: "invariant", name: "AtMostOnePost" },
    why: "A create pass reruns the intents it first listed, so a create refused for a taken slot must leave the pass, or a sibling that settles sends it again (#3290).",
  },
  {
    id: "system-create-hold-without-bound",
    module: MODULE,
    config: CONFIG,
    constants: { HoldBound: "FALSE" },
    expect: { kind: "liveness", name: "CreateSettles" },
    why: "A held create must post once its hold expires, or a device whose listings never complete waits forever (no-brick).",
  },
];
