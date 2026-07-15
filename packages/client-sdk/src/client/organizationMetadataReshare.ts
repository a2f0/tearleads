import { rethrowKeyingVerificationError } from "../data/keyingProjectionVerification/error";
import { getOrganizationProfileDocumentLocalId } from "../workflows/organizations/organizationProfile";
import { deriveOrganizationMetadataContainerSystemSlot } from "../workflows/organizations/rosterProfileContainer";
import type { ContainerContents } from "./containerContents";

/**
 * Best-effort re-share of the per-org "Organization Metadata" container to the
 * reserved Members group after a Members-group membership change.
 *
 * The container's KEK is wrapped to the Members group's encapsulation key. An
 * org-admin add or any removal rotates that group (new key epoch + fresh KEM),
 * leaving the wrap pinned to the old epoch so post-rotation members can no
 * longer decrypt the org name. Re-sharing to the Members group re-wraps to the
 * current head. The container-share dedup is epoch-aware, so this is idempotent
 * — a no-op unless the epoch actually advanced — which is why we do not attempt
 * to detect rotation here and simply re-share after every Members-group change.
 *
 * This never mints a NEW grant: the container's system slot is server-supplied,
 * so a compromised server could point it at a container the Members group is not
 * entitled to (e.g. the Admins-only roster container). Passing
 * `requireExistingGrant` makes the re-share re-wrap only a container that already
 * grants the Members group — refusing to create one — so a redirected slot can
 * never leak a foreign container. It also never creates the container itself:
 * resolution is snapshot lookup plus a non-creating refresh. Availability
 * failures are swallowed so they cannot surface into the group mutation that
 * already committed. Identity integrity failures propagate to the coordinator,
 * which records a terminal stop without creating an unhandled rejection.
 */
export async function reshareOrganizationMetadataToMembers(input: {
  containerContents: ContainerContents;
  log: (message: string) => void;
  memberGroupId: string;
  mutatedGroupId: string;
  organizationId: string;
}): Promise<void> {
  if (input.mutatedGroupId !== input.memberGroupId) {
    return;
  }

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

    const reshared = await tree.shareWithGroup(
      node.id,
      input.memberGroupId,
      "read",
      { requireExistingGrant: true },
    );
    if (!reshared) {
      // shareWithGroup returns false (never throws) when the store is offline or
      // not ready, or when the re-wrap was refused for lacking an existing
      // grant. Log for observability; the epoch-aware dedup re-wraps on the next
      // successful Members-group change.
      input.log(
        `Organizations: org metadata re-share to members did not apply for org ${input.organizationId}`,
      );
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
