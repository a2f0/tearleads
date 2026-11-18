import type { ContainerContentsOrganizationHost } from "../container-contents";
import { withMetadataRootReload } from "./groupMetadata/groupMetadataErrors";
import { createRuntimeGroupMetadataAccess } from "./groupMetadata/groupMetadataRuntime";
import { verifyRuntimeGroupMetadataAuthority } from "./groupMetadata/runtimeGroupMetadataAuthority";
import {
  createRuntimeCurrentGroupShare,
  createRuntimeCurrentSharePrincipalPolicy,
} from "./groupShare";
import { beginCommittedReadModel } from "./readModel/committedReadModel";

/**
 * The organization operations the composition root hands container contents.
 * A share's committed read-model lease is bound to the session generation the
 * runtime reads when the share begins.
 */
export function createContainerContentsOrganizationHost(
  readSessionGeneration: () => number,
): ContainerContentsOrganizationHost {
  return {
    ...containerContentsOrganizationHost,
    committedReadModel: (scope) => ({
      begin: () =>
        beginCommittedReadModel({
          ...scope,
          sessionGeneration: readSessionGeneration(),
        }),
    }),
  };
}

/** The host for standalone runtimes, which have one session generation. */
export const containerContentsOrganizationHost: ContainerContentsOrganizationHost =
  {
    committedReadModel: (scope) => ({
      begin: () => beginCommittedReadModel({ ...scope, sessionGeneration: 0 }),
    }),
    createCurrentGroupShare: createRuntimeCurrentGroupShare,
    createCurrentGroupPolicyReader: createRuntimeCurrentSharePrincipalPolicy,
    groupMetadataNameReader: (runtime, organizationId, stillCurrent) =>
      createRuntimeGroupMetadataAccess(runtime, organizationId, stillCurrent)
        .readName,
    verifyGroupMetadataAuthority: verifyRuntimeGroupMetadataAuthority,
    withMetadataRootReload,
  };
