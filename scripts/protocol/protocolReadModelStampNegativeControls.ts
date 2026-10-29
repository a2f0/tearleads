import type { NegativeControl } from "./protocolNegativeControlTypes";

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
    id: "read-model-admins-change-skips-directory",
    module: "formal/realtime/OrganizationReadModelStamps.tla",
    config: "formal/realtime/OrganizationReadModelStamps.cfg",
    constants: { StampDirectoryOnAdminsChange: "FALSE" },
    expect: { kind: "invariant", name: "CaughtUpDirectoryMatchesRole" },
    why: "The directory's content depends on the reader's role, so a change to Admins must stamp it or a new administrator never receives pending leave requests (#2666).",
  },
];
