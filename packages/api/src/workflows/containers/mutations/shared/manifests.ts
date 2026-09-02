import type {
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { verifyContainerAccessManifest } from "@tearleads/crypto";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import { getCurrentAccessManifestHead } from "../../../../access/read/accessManifestStore";
import { readProjectionAccessManifest } from "../../../../keyingProjectionRecords";
import {
  ContainerMutationError,
  mutationShapeError,
  mutationStateStale,
} from "../errors";
import type { ContainerMutationContext } from "../types";
import { resolveVerifiedStoredContainerManifest } from "./storedManifestArtifacts";

interface VerifyContainerManifestFromRequestArtifacts {
  readonly destinationParentContainerPath?:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly parentContainerPath?:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly previousContainerPath?:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly previousManifest: VerifiedContainerAccessManifest | null;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}

async function getCachedCurrentAccessManifestHead(
  context: ContainerMutationContext,
  containerId: string,
) {
  if (context.manifestHeadByContainerId.has(containerId)) {
    return context.manifestHeadByContainerId.get(containerId) ?? null;
  }

  const head = await getCurrentAccessManifestHead(
    "container",
    containerId,
    context.executor,
  );
  context.manifestHeadByContainerId.set(containerId, head);
  return head;
}

export async function assertManifestHeadCurrent(
  context: ContainerMutationContext,
  manifest: VerifiedContainerAccessManifest,
  label: string,
): Promise<void> {
  const head = await getCachedCurrentAccessManifestHead(
    context,
    manifest.state.containerId,
  );

  if (!head) {
    throw new ContainerMutationError(`${label} manifest head missing`, 404);
  }

  if (head.manifestHash !== manifest.manifestHash) {
    throw mutationStateStale(`${label} manifest head is stale`);
  }
}

function assertContainerPathEdges(
  path: readonly VerifiedContainerAccessManifest[],
  label: string,
): void {
  for (let index = 1; index < path.length; index += 1) {
    const parent = path[index - 1];
    const child = path[index];

    if (!parent || !child) {
      continue;
    }

    if (
      child.state.parentContainerId !== parent.state.containerId ||
      child.state.parentManifestHash !== parent.manifestHash
    ) {
      throw new ContainerMutationError(
        `${label} does not match container parent edges`,
        409,
      );
    }
  }
}

export async function assertCurrentContainerPath(
  context: ContainerMutationContext,
  bundles: readonly AccessManifestBundleWire[] | undefined,
  label: string,
): Promise<VerifiedContainerAccessManifest[] | undefined> {
  if (bundles === undefined) {
    return;
  }

  const path: VerifiedContainerAccessManifest[] = [];
  for (const [index, bundle] of bundles.entries()) {
    const manifest = await resolveVerifiedStoredContainerManifest(
      context,
      bundle,
      `${label}[${index}]`,
    );
    await assertManifestHeadCurrent(context, manifest, `${label}[${index}]`);
    path.push(manifest);
  }

  assertContainerPathEdges(path, label);
  return path;
}

export async function assertHistoricalContainerManifestsConsistent(
  context: ContainerMutationContext,
  bundles: readonly AccessManifestBundleWire[] | undefined,
): Promise<VerifiedContainerAccessManifest[] | undefined> {
  if (bundles === undefined) {
    return;
  }

  const manifests: VerifiedContainerAccessManifest[] = [];
  for (const [index, bundle] of bundles.entries()) {
    manifests.push(
      await resolveVerifiedStoredContainerManifest(
        context,
        bundle,
        `containerManifestHistory[${index}]`,
      ),
    );
  }
  return manifests;
}

export async function assertMutationHeadCanAdvance(
  context: ContainerMutationContext,
  manifest: VerifiedContainerAccessManifest,
): Promise<void> {
  const currentHead = await getCachedCurrentAccessManifestHead(
    context,
    manifest.state.containerId,
  );

  if (manifest.event.event.eventType === "container.create") {
    if (currentHead) {
      throw new ContainerMutationError(
        "Container manifest already exists",
        409,
      );
    }
    return;
  }

  if (!currentHead) {
    throw new ContainerMutationError("Container manifest head missing", 404);
  }

  if (currentHead.manifestHash !== manifest.state.previousManifestHash) {
    throw mutationStateStale("Container manifest head is stale");
  }
}

export async function verifyContainerManifestFromRequest(
  request: ContainerMutationRequest,
  event: VerifiedAccessEvent,
  artifacts: VerifyContainerManifestFromRequestArtifacts,
): Promise<VerifiedContainerAccessManifest> {
  const result = await verifyContainerAccessManifest({
    event,
    expectedManifestHash: request.expectedManifestHash,
    manifest: readProjectionAccessManifest(
      request.manifest,
      "Container mutation manifest",
      mutationShapeError,
    ),
    previousManifest: artifacts.previousManifest,
    principalPolicies: artifacts.principalPolicies,
    ...(artifacts.destinationParentContainerPath !== undefined
      ? {
          destinationParentContainerPath:
            artifacts.destinationParentContainerPath,
        }
      : {}),
    ...(artifacts.parentContainerPath !== undefined
      ? { parentContainerPath: artifacts.parentContainerPath }
      : {}),
    ...(artifacts.previousContainerPath !== undefined
      ? { previousContainerPath: artifacts.previousContainerPath }
      : {}),
  });

  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}
