import type { NegativeControl } from "./protocolNegativeControls";

export const SYSTEM_DESTINATION_NEGATIVE_CONTROLS: readonly NegativeControl[] =
  [
    {
      id: "system-slot-crosses-organization",
      module: "formal/local-trust/SystemDestination.tla",
      config: "formal/local-trust/SystemDestination.cfg",
      constants: { RequireSystemScope: "FALSE" },
      expect: { kind: "invariant", name: "SystemWritesStayInOrganization" },
      why: "A missing local root row cannot select another organization's same-slot system container (#2266).",
    },
    {
      id: "session-root-from-view",
      module: "formal/local-trust/SystemDestination.tla",
      config: "formal/local-trust/SystemDestination.cfg",
      constants: { PreserveSessionAcknowledgment: "FALSE" },
      expect: { kind: "invariant", name: "OnlyServerRootsAcknowledged" },
      why: "Restoring or switching a local view cannot acknowledge a server root (#2266).",
    },
    {
      id: "shared-system-refused",
      module: "formal/local-trust/SystemDestination.tla",
      config: "formal/local-trust/SystemDestination.cfg",
      constants: { RejectSharedSystem: "TRUE" },
      expect: { kind: "invariant", name: "SharedSystemRemainsUsable" },
      why: "Extra recipients must not make a signed system destination unusable (#2266).",
    },
    {
      id: "cached-destination-can-move",
      module: "formal/local-trust/SystemDestination.tla",
      config: "formal/local-trust/SystemDestination.cfg",
      constants: { PreserveDestinationIdentity: "FALSE" },
      expect: { kind: "invariant", name: "CachedDestinationsNeverMove" },
      why: "Cached root and system roles require immutable signed parent identities (#2266).",
    },
    {
      id: "system-destination-trusts-listing",
      module: "formal/local-trust/SystemDestination.tla",
      config: "formal/local-trust/SystemDestination.cfg",
      constants: { VerifyDestination: "FALSE" },
      expect: { kind: "invariant", name: "OnlySignedSlotReceivesSystemWrites" },
      why: "A forged unsigned slot must not redirect private system writes.",
    },
    {
      id: "root-destination-ignores-session",
      module: "formal/local-trust/SystemDestination.tla",
      config: "formal/local-trust/SystemDestination.cfg",
      constants: { RequireSessionRoot: "FALSE" },
      expect: { kind: "invariant", name: "OnlyOwnRootReceivesLocalContent" },
      why: "A different signed root must not adopt the session pre-login content.",
    },
    {
      id: "system-slot-created-by-writer",
      module: "formal/local-trust/SystemDestination.tla",
      config: "formal/local-trust/SystemDestination.cfg",
      constants: { RequireSystemAdministrator: "FALSE" },
      expect: { kind: "invariant", name: "OnlyAdministratorsCreateSlots" },
      why: "A root writer must not mint a system-slot decoy.",
    },
  ];
