import type { NegativeControl } from "./protocolNegativeControls";

const MODULE = "formal/local-trust/ContainerCreateAdoption.tla";
const CONFIG = "formal/local-trust/ContainerCreateAdoption.cfg";

export const CONTAINER_ADOPTION_NEGATIVE_CONTROLS: readonly NegativeControl[] =
  [
    {
      id: "listing-adopts-container-create",
      module: MODULE,
      config: CONFIG,
      constants: { VerifyContainerAdoption: "FALSE" },
      expect: { kind: "invariant", name: "ContainerAdoptionHasVerifiedScope" },
      why: "A listing row must not settle a pending container create without its signed epoch-1 create (#2365 finding 26).",
    },
    {
      id: "owed-container-move-cites-created-parent",
      module: MODULE,
      config: CONFIG,
      constants: { CiteVerifiedHead: "FALSE" },
      expect: { kind: "invariant", name: "OwedMoveCitesCurrentParent" },
      why: "An owed move that cites the create's parent is stale once another writer moved the folder (#2420).",
    },
    {
      id: "owed-container-move-overwrites-queued-move",
      module: MODULE,
      config: CONFIG,
      constants: { KeepQueuedMove: "FALSE" },
      expect: { kind: "invariant", name: "OwedMoveCitesCurrentParent" },
      why: "Settling the create must not take over a move the user queued after the listing arrived, nor leave it citing a parent that never committed (#2420).",
    },
    {
      id: "refused-container-adoption-halts-lane",
      module: MODULE,
      config: CONFIG,
      constants: { ParkForeignCreates: "FALSE" },
      expect: { kind: "liveness", name: "SiblingEventuallySyncs" },
      why: "A refused adoption that is re-verified and rethrown on every pass stops the lane's other intents for good (#2420).",
    },
    {
      id: "pending-container-create-takes-writes",
      module: MODULE,
      config: CONFIG,
      constants: { HoldPendingWrites: "FALSE" },
      expect: { kind: "invariant", name: "NoWriteIntoUnadoptedFolder" },
      why: "A move or metadata edit replayed into a folder whose create is pending reaches a listed identity adoption has not verified, or has refused (#2420).",
    },
  ];
