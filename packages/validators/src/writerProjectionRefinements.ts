export const containerWriterProjectionPathKekCountRefinement = {
  description:
    "containerKeks must contain exactly one entry for every manifest in path",
  id: "response.container-writer-projection-path-kek-count",
} as const;

export const writerProjectionManifestBundlesRefinement = {
  description:
    "every cited manifest hash names one bundles entry, every bundles key equals its bundle's manifestHash, and every bundle is cited",
  id: "response.writer-projection-manifest-bundles",
} as const;

export const writerProjectionResponseRuntimeRefinements = [
  containerWriterProjectionPathKekCountRefinement,
  organizationProvisioningContainerKeyringRefinement,
  writerProjectionManifestBundlesRefinement,
] as const;

import { organizationProvisioningContainerKeyringRefinement } from "./organizationProvisioningRefinements";
