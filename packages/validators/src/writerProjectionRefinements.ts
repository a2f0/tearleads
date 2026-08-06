export const containerWriterProjectionPathKekCountRefinement = {
  description:
    "containerKeks must contain exactly one entry for every manifest in path",
  id: "response.container-writer-projection-path-kek-count",
} as const;

export const writerProjectionResponseRuntimeRefinements = [
  containerWriterProjectionPathKekCountRefinement,
  organizationProvisioningContainerKeyringRefinement,
] as const;

import { organizationProvisioningContainerKeyringRefinement } from "./organizationProvisioningRefinements";
