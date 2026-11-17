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
    {
      id: "organization-directory-key-always-rotates",
      module: "formal/container-keying/OrganizationDirectoryKey.tla",
      config: "formal/container-keying/OrganizationDirectoryKey.cfg",
      constants: { KeepWhenVerifiable: "FALSE" },
      expect: { kind: "action", name: "EpochHeldUnlessShrink" },
      why: "A directory write that removes no admin keeps the key epoch while the writer can verify the held key; a builder that always rotates loses that (#2903 P18).",
    },
  ];
