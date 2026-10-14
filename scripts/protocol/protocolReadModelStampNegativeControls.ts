import type { NegativeControl } from "./protocolNegativeControls";

export const READ_MODEL_STAMP_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "read-model-cursor-allocated-outside-head-lock",
    module: "formal/realtime/OrganizationReadModelStamps.tla",
    config: "formal/realtime/OrganizationReadModelStamps.cfg",
    constants: { SerializeAllocation: "FALSE" },
    expect: { kind: "invariant", name: "CursorCoversChanges" },
    why: "Cursor allocation must be serialized under the head row lock so a later cursor cannot commit before an earlier one (#2522).",
  },
  {
    id: "read-model-group-stamp-outside-head-lock",
    module: "formal/realtime/OrganizationReadModelStamps.tla",
    config: "formal/realtime/OrganizationReadModelStamps.cfg",
    constants: { StampUnderHeadLock: "FALSE" },
    expect: { kind: "invariant", name: "CursorCoversChanges" },
    why: "A group membership stamp must use the cursor allocated under the head row lock, not a head read taken before it (#2522).",
  },
  {
    id: "read-model-held-hint-dropped-uncovered",
    module: "formal/realtime/OrganizationReadModelStamps.tla",
    config: "formal/realtime/OrganizationReadModelStamps.cfg",
    constants: { ReleaseChecksCoverage: "FALSE" },
    expect: { kind: "invariant", name: "BehindClientHasTrigger" },
    why: "Releasing a held hint may skip the feed only when a completed pass covers it; the hint may come from a sibling client of the session (#2522).",
  },
  {
    id: "read-model-held-hint-covered-from-response",
    module: "formal/realtime/OrganizationReadModelStamps.tla",
    config: "formal/realtime/OrganizationReadModelStamps.cfg",
    constants: { CoverFromSend: "FALSE" },
    expect: { kind: "invariant", name: "BehindClientHasTrigger" },
    why: "A pass covers only hints received before its request was sent; its server read may predate a hint that arrives while it is in flight (#2522).",
  },
];
