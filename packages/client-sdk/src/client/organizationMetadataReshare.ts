import { rethrowKeyingVerificationError } from "../data/keyingProjectionVerification/error";
import { getOrganizationProfileDocumentLocalId } from "../workflows/organizations/organizationProfile";
import { deriveOrganizationMetadataContainerSystemSlot } from "../workflows/organizations/rosterProfileContainer";
import type { ContainerContents } from "./containerContents";

/**
 * Best-effort re-share of the per-org "Organization Metadata" container after
 * a group membership change.
 *
 * The container's KEK is wrapped to the Members group's encapsulation key. An
 * org-admin add or any removal rotates that group (new key epoch + fresh KEM),
 * leaving the wrap pinned to the old epoch so post-rotation members can no
 * longer decrypt the org name. Re-sharing to the Members group re-wraps to the
 * current head. The caller supplies only the mutated group. The signed metadata
 * manifest decides whether that group has the existing read grant, so neither a
 * display projection nor the reserved group name participates in keying.
 *
 * This never mints a NEW grant: the container's system slot is server-supplied,
 * so a compromised server could point it at a container the Members group is not
 * entitled to (e.g. the Admins-only roster container). Passing
 * `requireExistingGrant` verifies the manifest before capturing key material and
 * refuses to create a grant, so an unrelated group or redirected slot cannot
 * leak a foreign container. It also never creates the container itself:
 * resolution is snapshot lookup plus a non-creating refresh. Availability
 * failures are swallowed so they cannot surface into the group mutation that
 * already committed. Identity integrity failures propagate to the coordinator.
 */
export async function reshareOrganizationMetadataAfterGroupChange(input: {
  containerContents: ContainerContents;
  log: (message: string) => void;
  mutatedGroupId: string;
  organizationId: string;
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
      // The container is a granted child of root that may not be hydrated on
      // this admin's device; a full refresh lists it without ever creating one.
      await tree.refresh();
      node = findNode();
    }
    if (!node) {
      input.log(
        `Organizations: org metadata container not reachable for org ${input.organizationId}; skipped best-effort re-share to members`,
      );
      return;
    }

    const prepared = await tree.prepareGroupRewrap(
      node.id,
      input.mutatedGroupId,
      "read",
      { requireExistingGrant: true },
    );
    if (!prepared) {
      input.log(
        `Organizations: org metadata existing-grant re-share was unavailable for org ${input.organizationId}`,
      );
      return;
    }
    if (prepared.status === "not-granted") {
      return;
    }
    if (!(await prepared.rewrap())) {
      input.log(
        `Organizations: org metadata existing-grant re-share did not apply for org ${input.organizationId}`,
      );
      return;
    }

    // Re-sharing only re-wraps the container KEK — it does not upload the org
    // profile document body. The founder authors that body locally at
    // provisioning (keyed under an alias) and enqueues it as a pending update,
    // but nothing pushes it: the document is never opened, and the reconciler
    // only force-syncs a child container on a full manual refresh. Push it here,
    // when members first appear, so the freshly-granted Members can actually pull
    // and decrypt the org display name. Best-effort and idempotent — the sync is
    // a no-op once the body is already on the server.
    input.containerContents.pullDocumentContent({
      containerId: node.id,
      localId: getOrganizationProfileDocumentLocalId({
        organizationId: input.organizationId,
      }),
    });
  } catch (error) {
    rethrowKeyingVerificationError(error);
    input.log(
      `Organizations: best-effort org metadata re-share failed for org ${input.organizationId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
