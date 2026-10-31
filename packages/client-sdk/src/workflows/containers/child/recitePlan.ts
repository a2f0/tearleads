import {
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  KeyingVerificationError,
  MAX_CONTAINER_RECITATION_EPOCH,
  resolveContainerStatePathUserAccessLevel,
} from "@tearleads/crypto";
import type { ContainerReciteRequest } from "@tearleads/validators/request";
import type { ContainerReciteResponse } from "@tearleads/validators/response";
import { signContainerMutationEvent } from "../../../data/containers/shared/events";
import type { HeldContainerHead } from "../../../data/containers/shared/heldContainerHeads";
import { principalPolicyRef } from "../../../data/containers/shared/principalPolicies";
import { containerManifestRef } from "../../../data/containers/shared/projection";
import type { ContainerMutationAuthor } from "../../../data/containers/shared/types";
import { readCanonicalRecord } from "../../../data/keying/canonicalJson";
import type { PrincipalPolicyCheckpointEvidence } from "../../../data/principals/principalPolicyEvidence";

export function referencedRecitationPolicies(
  path: readonly HeldContainerHead[],
  policies: readonly PrincipalPolicyCheckpointEvidence[],
): readonly PrincipalPolicyCheckpointEvidence[] {
  const referencedIds = new Set(
    path.flatMap((head) =>
      head.state.referencedPrincipalHeads.map(
        (ref) => `${ref.principalType}:${ref.principalId}`,
      ),
    ),
  );
  return policies.filter((policy) =>
    referencedIds.has(`${policy.principalType}:${policy.principalId}`),
  );
}

export async function buildContainerRecitePlan(input: {
  readonly author: ContainerMutationAuthor;
  readonly path: readonly HeldContainerHead[];
  readonly policies: readonly PrincipalPolicyCheckpointEvidence[];
}) {
  const previous = input.path.at(-1);
  if (!previous) throw new Error("Recitation requires a held container path");
  if (previous.state.epoch >= MAX_CONTAINER_RECITATION_EPOCH) {
    throw new Error("Container re-citation history budget is exhausted");
  }
  if (
    input.path.some(
      (head) => head.state.organizationId !== input.author.organizationId,
    )
  ) {
    throw new Error("Recitation cannot cross organizations");
  }
  if (
    resolveContainerStatePathUserAccessLevel({
      states: input.path.map((head) => head.state),
      principalPolicies: input.policies,
      userId: input.author.signerUserId,
    }) !== "admin"
  ) {
    throw new KeyingVerificationError(
      "unauthorized",
      "Container re-citation signer lacks admin access on the held path",
    );
  }
  const body = {
    eventType: "container.recite" as const,
    containerKeyEpochId: previous.state.containerKeyEpochId,
    containerKeyPublicKey: previous.state.containerKeyPublicKey,
  };
  const { event, eventHash } = await signContainerMutationEvent({
    author: input.author,
    body,
    containerId: previous.state.containerId,
    dependencyManifestHashes: input.path.map(
      (head) => head.bundle.manifestHash,
    ),
    eventId: crypto.randomUUID(),
    previousManifestHash: previous.bundle.manifestHash,
    signedAt: new Date().toISOString(),
  });
  const state = {
    ...previous.state,
    epoch: previous.state.epoch + 1,
    eventHash,
    previousManifestHash: previous.bundle.manifestHash,
  };
  const manifest = await deriveContainerAccessManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const request: ContainerReciteRequest = {
    body,
    event: readCanonicalRecord(event, "Recitation event"),
    manifest: readCanonicalRecord(manifest, "Recitation manifest"),
    expectedManifestHash: manifestHash,
    previousManifestRef: containerManifestRef(previous.bundle),
    previousContainerPathRefs: input.path.map((head) =>
      containerManifestRef(head.bundle),
    ),
    principalPolicyRefs: referencedRecitationPolicies(
      input.path,
      input.policies,
    ).map(principalPolicyRef),
  };
  return { body, event, eventHash, manifest, manifestHash, state, request };
}

export function assertContainerReciteAcknowledgement(
  plan: Awaited<ReturnType<typeof buildContainerRecitePlan>>,
  response: ContainerReciteResponse,
): void {
  // The manifest hash commits to the signed event, the derived state, and
  // the cited principal heads, so equal hashes acknowledge exactly this plan.
  if (
    response.containerId !== plan.state.containerId ||
    response.organizationId !== plan.state.organizationId ||
    response.parentId !== plan.state.parentContainerId ||
    (response.systemSlot ?? null) !== plan.state.systemSlot ||
    response.manifestHead.epoch !== plan.state.epoch ||
    response.manifestHead.manifestHash !== plan.manifestHash ||
    response.eventHash !== plan.eventHash
  )
    throw new KeyingVerificationError(
      "object_mismatch",
      "Container recitation response does not match the signed plan",
    );
}
