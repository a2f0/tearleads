import type { NegativeControl } from "./protocolNegativeControls";

export const HISTORICAL_POLICY_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "deleted-authority-proof-withheld",
    module: "formal/container-keying/NoBrickedDevice.tla",
    config: "formal/container-keying/NoBrickedDevice.cfg",
    constants: { ServeDeletedAuthority: "FALSE" },
    expect: { kind: "invariant", name: "HonestServerNeverRefused" },
    why: "A fresh device must receive public authority evidence after group deletion.",
  },
  {
    id: "history-only-authority-proof-withheld",
    module: "formal/container-keying/NoBrickedDevice.tla",
    config: "formal/container-keying/NoBrickedDevice.cfg",
    constants: { ServeHistoryOnlyAuthority: "FALSE" },
    expect: { kind: "liveness", name: "DeviceEventuallyCurrent" },
    why: "Current grants cannot gate proof delivery for citations in served history.",
  },
];
