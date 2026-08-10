import type {
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  verifyContainerAccessManifest,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import { getCurrentAccessManifestHead } from "../../../../access/read/accessManifestStore";
import { readProjectionAccessManifest } from "../../../../keyingProjectionRecords";
import { canonicalJsonEquals } from "../../../../utils/canonicalJson";
import { loadContainerManifestBundleByHash } from "../../writerProjection/accessPaths";
import { verifyStoredContainerManifest } from "../../writerProjection/storedManifestVerification";
import { ContainerWriterProjectionError } from "../../writerProjection/types";
import { ContainerMutationError, mutationShapeError } from "../errors";
import type { ContainerMutationContext } from "../types";
import { readVerifiedContainerManifest } from "./accessManifestRecords";

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

export async function assertContainerManifestBundleConsistent(
  bundle: AccessManifestBundleWire,
  label: string,
): Promise<VerifiedContainerAccessManifest> {
  const verified = readVerifiedContainerManifest(bundle, label);
  const derivedManifest = await deriveContainerAccessManifest(verified.state);
  const derivedManifestHash = await computeAccessManifestHash(derivedManifest);
  const suppliedManifestHash = await computeAccessManifestHash(
    verified.manifest,
  );

  if (
    verified.manifestHash !== derivedManifestHash ||
    verified.manifestHash !== suppliedManifestHash ||
    !canonicalJsonEquals(derivedManifest, verified.manifest)
  ) {
    throw new ContainerMutationError(
      `${label} manifest bundle is not self-consistent`,
      409,
    );
  }

  if (
    verified.manifest.objectKind !== "container" ||
    verified.manifest.objectId !== verified.state.containerId ||
    verified.manifest.organizationId !== verified.state.organizationId ||
    verified.manifest.epoch !== verified.state.epoch ||
    verified.manifest.previousManifestHash !==
      verified.state.previousManifestHash ||
    verified.manifest.eventHash !== verified.state.eventHash ||
    verified.event.eventHash !== verified.state.eventHash ||
    verified.event.event.objectId !== verified.state.containerId ||
    verified.event.event.organizationId !== verified.state.organizationId
  ) {
    throw new ContainerMutationError(
      `${label} manifest bundle has inconsistent domains`,
      409,
    );
  }

  return verified;
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
    throw new ContainerMutationError(`${label} manifest head is stale`, 409);
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
    const manifest = await assertContainerManifestBundleConsistent(
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
    await assertContainerManifestBundleConsistent(
      bundle,
      `containerManifestHistory[${index}]`,
    );
    try {
      const storedBundle = await loadContainerManifestBundleByHash(
        context.writerProjectionContext,
        bundle.manifestHash,
      );
      // The request bundle was already verified against its manifest hash.
      // Resolve that hash from storage and verify the authoritative stored
      // artifact; wrapper-level optional field presence is not cryptographic
      // evidence and must not make an equivalent wire bundle conflict.
      manifests.push(
        await verifyStoredContainerManifest({
          bundle: storedBundle,
          context: context.writerProjectionContext,
          loadBundle: (manifestHash) =>
            loadContainerManifestBundleByHash(
              context.writerProjectionContext,
              manifestHash,
            ),
        }),
      );
    } catch (error) {
      if (error instanceof ContainerMutationError) {
        throw error;
      }
      if (!(error instanceof ContainerWriterProjectionError)) {
        throw error;
      }
      throw new ContainerMutationError(
        `containerManifestHistory[${index}] is not a verified stored manifest: ${error.message}`,
        409,
      );
    }
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
    throw new ContainerMutationError("Container manifest head is stale", 409);
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
