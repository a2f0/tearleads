import { errorMessage } from "../data/errorMessage";
import { getOrganizationProfileDocumentLocalId } from "../workflows/organizations/organizationProfile";
import { deriveOrganizationMetadataContainerSystemSlot } from "../workflows/organizations/rosterProfileContainer";
import type { ContainerContents } from "./containerContents";

/**
 * Push the locally-authored organization profile after Members changes. Key
 * rematerialization is already part of the policy transaction; this is only an
 * idempotent content sync and never creates or changes a grant.
 */
export async function syncOrganizationMetadataProfile(input: {
  readonly containerContents: ContainerContents;
  readonly log: (message: string) => void;
  readonly organizationId: string;
}): Promise<void> {
  try {
    const systemSlot = await deriveOrganizationMetadataContainerSystemSlot({
      organizationId: input.organizationId,
    });
    const tree = input.containerContents.openTree();
    const findNode = () =>
      tree
        .getSnapshot()
        .nodes.find((candidate) => candidate.systemSlot === systemSlot);
    let node = findNode();
    if (!node) {
      await tree.refresh();
      node = findNode();
    }
    if (!node) {
      input.log(
        `Organizations: org metadata container not reachable for org ${input.organizationId}; skipped profile sync`,
      );
      return;
    }

    input.containerContents.pullDocumentContent({
      containerId: node.id,
      localId: getOrganizationProfileDocumentLocalId({
        organizationId: input.organizationId,
      }),
    });
  } catch (error) {
    input.log(
      `Organizations: best-effort org metadata profile sync failed for org ${input.organizationId}: ${errorMessage(error)}`,
    );
  }
}
