import type { NegativeControl } from "./protocolNegativeControlTypes";

export const ORGANIZATION_DIRECTORY_KEY_NEGATIVE_CONTROLS: readonly NegativeControl[] =
  [
    {
      id: "organization-directory-key-kept-on-shrink",
      module: "formal/container-keying/OrganizationDirectoryKey.tla",
      config: "formal/container-keying/OrganizationDirectoryKey.cfg",
      constants: { RotateOnShrink: "FALSE" },
      expect: { kind: "invariant", name: "RemovedAdminLacksCurrentKey" },
      why: "A directory write that removes an admin must rotate the organization key, or the removed admin still holds the current key (#2903 P18).",
    },
  ];
