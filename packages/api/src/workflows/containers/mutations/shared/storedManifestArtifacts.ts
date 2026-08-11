import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import {
  computeAccessManifestHash,
  deriveContainerAccessManifest,
} from "@tearleads/crypto";
import type { AccessManifestBundleWire } from "@tearleads/validators/request";
import { canonicalJsonEquals } from "../../../../utils/canonicalJson";
import { loadContainerManifestBundleByHash } from "../../writerProjection/accessPaths";
import { verifyStoredContainerManifest } from "../../writerProjection/storedManifestVerification";
import { ContainerWriterProjectionError } from "../../writerProjection/types";
import { ContainerMutationError } from "../errors";
import type { ContainerMutationContext } from "../types";
import { readVerifiedContainerManifest } from "./accessManifestRecords";

async function readConsistentContainerManifestBundle(
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

function containerManifestArtifact(
  manifest: VerifiedContainerAccessManifest,
): Record<string, unknown> {
  return {
    event: {
      body: manifest.event.body,
      event: manifest.event.event,
      eventHash: manifest.event.eventHash,
    },
    manifest: manifest.manifest,
    manifestHash: manifest.manifestHash,
    state: manifest.state,
  };
}

export async function resolveVerifiedStoredContainerManifest(
  context: ContainerMutationContext,
  bundle: AccessManifestBundleWire,
  label: string,
): Promise<VerifiedContainerAccessManifest> {
  const requestManifest = await readConsistentContainerManifestBundle(
    bundle,
    label,
  );
  const batchManifest = context.verifiedManifestByHash.get(
    requestManifest.manifestHash,
  );
  if (batchManifest) {
    if (
      !canonicalJsonEquals(
        containerManifestArtifact(requestManifest),
        containerManifestArtifact(batchManifest),
      )
    ) {
      throw new ContainerMutationError(
        `${label} does not match verified batch manifest`,
        409,
      );
    }
    return batchManifest;
  }
  try {
    const storedBundle = await loadContainerManifestBundleByHash(
      context.writerProjectionContext,
      requestManifest.manifestHash,
    );
    const storedManifest = await verifyStoredContainerManifest({
      bundle: storedBundle,
      context: context.writerProjectionContext,
      loadBundle: (manifestHash) =>
        loadContainerManifestBundleByHash(
          context.writerProjectionContext,
          manifestHash,
        ),
    });
    if (
      !canonicalJsonEquals(
        containerManifestArtifact(requestManifest),
        containerManifestArtifact(storedManifest),
      )
    ) {
      throw new ContainerMutationError(
        `${label} does not match verified stored manifest`,
        409,
      );
    }
    return storedManifest;
  } catch (error) {
    if (error instanceof ContainerMutationError) {
      throw error;
    }
    if (!(error instanceof ContainerWriterProjectionError)) {
      throw error;
    }
    throw new ContainerMutationError(
      `${label} is not a verified stored manifest: ${error.message}`,
      409,
    );
  }
}
