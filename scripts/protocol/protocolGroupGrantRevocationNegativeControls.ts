import type { NegativeControl } from "./protocolNegativeControls";

const GROUP_GRANT_MODULE = "formal/container-keying/GroupGrantRevocation.tla";
const GROUP_GRANT_CONFIG = "formal/container-keying/GroupGrantRevocation.cfg";

export const GROUP_GRANT_REVOCATION_NEGATIVE_CONTROLS: readonly NegativeControl[] =
  [
    {
      id: "group-grant-shrink-keeps-key",
      module: GROUP_GRANT_MODULE,
      config: GROUP_GRANT_CONFIG,
      constants: { RotateGroupOnGrantRemoval: "FALSE" },
      expect: {
        kind: "invariant",
        name: "RevokedGrantUnreadableByLaterMembers",
      },
      why: "A group that drops a container grant without rotating its key hands a later joiner the key its retained container wraps are sealed to (#2365 finding 20).",
    },
    {
      id: "group-rotation-skips-granted-container",
      module: GROUP_GRANT_MODULE,
      config: GROUP_GRANT_CONFIG,
      constants: { RequireEveryRematerialization: "FALSE" },
      expect: { kind: "invariant", name: "LiveGrantsOpenToCurrentGroupKey" },
      why: "A group rotation whose batch omits a granted container leaves it sealed only to group keys a joiner never receives.",
    },
    {
      id: "group-batch-overwrites-direct-share",
      module: GROUP_GRANT_MODULE,
      config: GROUP_GRANT_CONFIG,
      constants: { RefuseStaleHead: "FALSE" },
      expect: { kind: "invariant", name: "DirectSharesSurvive" },
      why: "A batch entry planned before another device's direct share replaces the head that share advanced.",
    },
    {
      id: "group-change-fails-on-one-race",
      module: GROUP_GRANT_MODULE,
      config: GROUP_GRANT_CONFIG,
      constants: { ReplanOnStale: "FALSE" },
      expect: { kind: "invariant", name: "FailureNeedsRepeatedRaces" },
      why: "Without replanning from fresh heads, one concurrent direct share leaves a group change unapplied (#2654).",
    },
    {
      id: "group-batch-cites-pre-batch-parent",
      module: GROUP_GRANT_MODULE,
      config: GROUP_GRANT_CONFIG,
      constants: { CiteAuthoredParentHead: "FALSE" },
      expect: { kind: "invariant", name: "FailureNeedsRepeatedRaces" },
      why: "A child entry citing the parent head from before the batch is refused once the parent's own entry applies, so a group granted at both levels can never change (#2651).",
    },
  ];
