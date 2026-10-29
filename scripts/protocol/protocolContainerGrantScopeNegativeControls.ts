import type { NegativeControl } from "./protocolNegativeControlTypes";

const MODULE = "formal/container-keying/ContainerGrantScope.tla";
const CONFIG = "formal/container-keying/ContainerGrantScope.cfg";

export const CONTAINER_GRANT_SCOPE_NEGATIVE_CONTROLS: readonly NegativeControl[] =
  [
    {
      id: "container-grant-names-organization",
      module: MODULE,
      config: CONFIG,
      constants: { CheckGrantSubjectType: "FALSE" },
      expect: { kind: "invariant", name: "NoOrganizationGrants" },
      why: "An organization principal is a signed policy principal, never a container grant subject.",
    },
    {
      id: "container-grant-names-foreign-group",
      module: MODULE,
      config: CONFIG,
      constants: { CheckGrantOrganization: "FALSE" },
      expect: { kind: "invariant", name: "GrantsStayWithinOrganization" },
      why: "A grant must not name a group from another organization.",
    },
    {
      id: "container-grant-names-inactive-user",
      module: MODULE,
      config: CONFIG,
      constants: { CheckActiveRoster: "FALSE" },
      expect: {
        kind: "invariant",
        name: "DirectUserGrantsRequireActiveRoster",
      },
      why: "A direct grant must name a user active in the container's organization.",
    },
    {
      id: "roster-removal-keeps-direct-grant",
      module: MODULE,
      config: CONFIG,
      constants: { BlockDisableWithGrant: "FALSE" },
      expect: {
        kind: "invariant",
        name: "DirectUserGrantsRequireActiveRoster",
      },
      why: "Removing a member while a direct container grant still names them leaves a grant for a user outside the organization.",
    },
  ];
