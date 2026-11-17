import type { ContainerContentsOrganizationHost } from "../container-contents";
import { withMetadataRootReload } from "./groupMetadata/groupMetadataErrors";
import { createRuntimeGroupMetadataAccess } from "./groupMetadata/groupMetadataRuntime";
import { verifyRuntimeGroupMetadataAuthority } from "./groupMetadata/runtimeGroupMetadataAuthority";
import {
  createRuntimeCurrentGroupShare,
  createRuntimeCurrentSharePrincipalPolicy,
} from "./groupShare";
import { beginCommittedReadModel } from "./readModel/committedReadModel";

/** The organization operations the composition root hands container contents. */
export const containerContentsOrganizationHost: ContainerContentsOrganizationHost =
  {
    committedReadModel: (scope) => ({
      begin: () => beginCommittedReadModel(scope),
    }),
    createCurrentGroupShare: createRuntimeCurrentGroupShare,
    createCurrentGroupPolicyReader: createRuntimeCurrentSharePrincipalPolicy,
    groupMetadataNameReader: (runtime, organizationId, stillCurrent) =>
      createRuntimeGroupMetadataAccess(runtime, organizationId, stillCurrent)
        .readName,
    verifyGroupMetadataAuthority: verifyRuntimeGroupMetadataAuthority,
    withMetadataRootReload,
  };
