import {
  type AnyVerifiedPrincipalPolicy,
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
import { principalPolicyRequestRecord } from "../../../data/containers/shared/principalPolicies";
import type { ContainerMutationAuthor } from "../../../data/containers/shared/types";
import {
  canonicalKeyingJsonString,
  readCanonicalRecord,
} from "../../../data/keyingCanonicalJson";

export function referencedRecitationPolicies(
  path: readonly HeldContainerHead[],
  policies: readonly AnyVerifiedPrincipalPolicy[],
): readonly AnyVerifiedPrincipalPolicy[] {
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
  readonly policies: readonly AnyVerifiedPrincipalPolicy[];
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
    previousManifest: previous.bundle,
    previousContainerPath: input.path.map((head) => head.bundle),
    principalPolicies: referencedRecitationPolicies(
      input.path,
      input.policies,
    ).map((policy) => principalPolicyRequestRecord(policy)),
  };
  return { body, event, eventHash, manifest, manifestHash, state, request };
}

export function assertContainerReciteAcknowledgement(
  plan: Awaited<ReturnType<typeof buildContainerRecitePlan>>,
  response: ContainerReciteResponse,
): void {
  const bundle = response.accessManifest;
  const signedFieldsMatch = [
    [bundle.event.event, plan.event],
    [bundle.event.body, plan.body],
    [bundle.manifest, plan.manifest],
    [bundle.state, plan.state],
  ].every(
    ([actual, expected]) =>
      canonicalKeyingJsonString(actual, "Recitation response") ===
      canonicalKeyingJsonString(expected, "Recitation plan"),
  );
  if (
    response.containerId !== plan.state.containerId ||
    response.organizationId !== plan.state.organizationId ||
    response.parentId !== plan.state.parentContainerId ||
    response.manifestHead.epoch !== plan.state.epoch ||
    response.manifestHead.manifestHash !== plan.manifestHash ||
    bundle.manifestHash !== plan.manifestHash ||
    bundle.event.eventHash !== plan.eventHash ||
    !signedFieldsMatch ||
    canonicalKeyingJsonString(
      response.referencedPrincipalHeads,
      "Recitation references",
    ) !==
      canonicalKeyingJsonString(
        plan.manifest.referencedPrincipalHeads,
        "Recitation planned references",
      )
  )
    throw new KeyingVerificationError(
      "object_mismatch",
      "Container recitation response does not match the signed plan",
    );
}
