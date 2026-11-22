import type { NegativeControl } from "./protocolNegativeControlTypes";

const MODULE = "formal/document-sync/VoidUpdateProgress.tla";
const CONFIG = "formal/document-sync/VoidUpdateProgress.cfg";

export const VOID_UPDATE_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "void-update-refused",
    module: MODULE,
    config: CONFIG,
    constants: { RefuseVoid: "TRUE" },
    expect: { kind: "liveness", name: "DeviceEventuallyCurrent" },
    why: "A false-span update that fails the whole pass keeps every later update from the reader for good (#3135).",
  },
  {
    id: "void-update-imports-carried-ops",
    module: MODULE,
    config: CONFIG,
    constants: { ImportCarriedOps: "TRUE" },
    expect: { kind: "invariant", name: "VoidNeverApplied" },
    why: "Importing what a mismatched payload carries applies an underclaim's hidden operation that no signed span declares (#3135).",
  },
  {
    id: "void-update-pull-ignores-cursor",
    module: MODULE,
    config: CONFIG,
    constants: { PullUsesCursor: "FALSE" },
    expect: { kind: "invariant", name: "ServedOnceAfterProcessed" },
    why: "A pull filtered by frontier alone serves an overclaim on every pass (#3135).",
  },
  {
    id: "void-update-cursor-survives-upgrade",
    module: MODULE,
    config: CONFIG,
    constants: { KeepCursorOnUpgrade: "TRUE" },
    expect: { kind: "invariant", name: "ProcessedDevicesAgree" },
    why: "A cursor kept across a decoder upgrade leaves an honest update the old decoder voided unread for good (#3135).",
  },
  {
    id: "void-update-cursor-outlives-frontier",
    module: MODULE,
    config: CONFIG,
    constants: { IgnoreCursorVersion: "TRUE" },
    expect: { kind: "invariant", name: "ProcessedDevicesAgree" },
    why: "A cursor kept after the local state is replaced by an older copy never pulls what the device lost (#3135).",
  },
  {
    id: "void-update-cursor-ignores-pull-premise",
    module: MODULE,
    config: CONFIG,
    constants: { IgnorePullPremise: "TRUE" },
    expect: { kind: "invariant", name: "ProcessedDevicesAgree" },
    why: "A pull upgraded between its pages, served from a cursor the old decoder stood for, records a cursor past updates the new decoder never judged (#3135).",
  },
  {
    id: "void-update-memoizes-runtime-failure",
    module: MODULE,
    config: CONFIG,
    constants: { MemoizeRuntimeFailure: "TRUE" },
    expect: { kind: "invariant", name: "RuntimeVoidOnlyAfterAttempts" },
    why: "Voiding an update on its first Loro runtime failure loses an honest update that one trap or exhausted allocation hit (#3135).",
  },
  {
    id: "void-update-counts-every-runtime-failure",
    module: MODULE,
    config: CONFIG,
    constants: { CountEveryFailure: "TRUE" },
    expect: { kind: "invariant", name: "AttemptsWithinLifetimes" },
    why: "Counting every runtime failure lets one process a trap left unusable spend every attempt of the updates it reads next (#3135).",
  },
  {
    id: "void-update-cursor-past-unsettled",
    module: MODULE,
    config: CONFIG,
    constants: { CursorPastUnsettled: "TRUE" },
    expect: { kind: "invariant", name: "ProcessedDevicesAgree" },
    why: "A cursor recorded past an update the runtime failed on keeps it from being served again, so the device never holds it (#3135).",
  },
];
