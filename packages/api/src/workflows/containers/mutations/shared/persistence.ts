import type {
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
} from "@tearleads/crypto";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { storeVerifiedAccessManifest } from "../../../../access/write/accessManifestStore";
import { storeVerifiedContainerKekState } from "../../../../access/write/containerKekStore";
import type { DatabaseExecutor } from "../../../../adapters/postgres";
import {
  projectionAccessManifestRecord,
  projectionVerifiedAccessEventRecord,
} from "../../../../keyingProjectionRecords";
import {
  containerMetadataDocuments,
  containers,
  documents,
} from "../../../../schema";
import { ContainerMutationError, runConflictBoundary } from "../errors";
import type {
  ContainerMutationContext,
  StoredContainerRow,
  VerifiedContainerAccessState,
} from "../types";
import {
  containerAccessStateRecord,
  referencedPrincipalHeadRecord,
} from "./accessManifestRecords";
import {
  containerKekRecipientTargetRecord,
  containerKeyEpochRecord,
  containerKeyWrapRecord,
} from "./containerKekRecords";

async function loadContainerRow(
  executor: DatabaseExecutor,
  containerId: string,
): Promise<StoredContainerRow | null> {
  const [row] = await executor
    .select({
      id: containers.id,
      organizationId: containers.organizationId,
      parentId: containers.parentId,
    })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);

  return row ?? null;
}

async function assertMetadataDocumentAvailable(
  executor: DatabaseExecutor,
  metadataDocumentId: string,
): Promise<void> {
  const [existingMetadataDocument] = await executor
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, metadataDocumentId))
    .limit(1);
  if (existingMetadataDocument) {
    throw new ContainerMutationError(
      "Container metadata document already exists",
      409,
    );
  }
}

async function insertContainerMetadataBinding(
  executor: DatabaseExecutor,
  state: VerifiedContainerAccessState,
): Promise<void> {
  const [metadataBinding] = await executor
    .insert(containerMetadataDocuments)
    .values({
      containerId: state.containerId,
      documentId: state.metadataDocumentId,
    })
    .onConflictDoNothing()
    .returning({ containerId: containerMetadataDocuments.containerId });
  if (!metadataBinding) {
    throw new ContainerMutationError(
      "Container metadata binding already exists",
      409,
    );
  }
}

async function persistCreatedContainerStructure(
  executor: DatabaseExecutor,
  state: VerifiedContainerAccessState,
): Promise<void> {
  if (!state.parentContainerId) {
    throw new ContainerMutationError("container create requires a parent", 400);
  }

  const parent = await loadContainerRow(executor, state.parentContainerId);
  if (!parent) {
    throw new ContainerMutationError("Parent container not found", 404);
  }

  if (parent.organizationId !== state.organizationId) {
    throw new ContainerMutationError(
      "Parent container organization mismatch",
      409,
    );
  }

  await assertMetadataDocumentAvailable(executor, state.metadataDocumentId);

  const [inserted] = await executor
    .insert(containers)
    .values({
      id: state.containerId,
      organizationId: state.organizationId,
      parentId: state.parentContainerId,
    })
    .onConflictDoNothing({ target: containers.id })
    .returning({ id: containers.id });

  if (!inserted) {
    throw new ContainerMutationError("Container already exists", 409);
  }

  await insertContainerMetadataBinding(executor, state);
}

async function persistContainerStructure(
  executor: DatabaseExecutor,
  manifest: VerifiedContainerAccessManifest,
): Promise<void> {
  const state = manifest.state;

  if (manifest.event.event.eventType === "container.create") {
    await persistCreatedContainerStructure(executor, state);
    return;
  }

  const container = await loadContainerRow(executor, state.containerId);
  if (!container) {
    throw new ContainerMutationError("Container not found", 404);
  }

  if (container.organizationId !== state.organizationId) {
    throw new ContainerMutationError("Container organization mismatch", 409);
  }

  if (manifest.event.event.eventType !== "container.move") {
    return;
  }

  if (!container.parentId) {
    throw new ContainerMutationError("Root container cannot be moved", 400);
  }

  if (!state.parentContainerId) {
    throw new ContainerMutationError(
      "Destination parent container is required",
      400,
    );
  }

  const destinationParent = await loadContainerRow(
    executor,
    state.parentContainerId,
  );
  if (!destinationParent) {
    throw new ContainerMutationError(
      "Destination parent container not found",
      404,
    );
  }

  if (destinationParent.organizationId !== state.organizationId) {
    throw new ContainerMutationError(
      "Destination parent organization mismatch",
      409,
    );
  }

  await executor
    .update(containers)
    .set({ parentId: state.parentContainerId })
    .where(eq(containers.id, state.containerId));
}

export async function persistVerifiedMutation(
  context: ContainerMutationContext,
  manifest: VerifiedContainerAccessManifest,
  kekState: VerifiedContainerKekState,
): Promise<ContainerMutationResponse> {
  const { executor } = context;

  await persistContainerStructure(executor, manifest);

  const manifestHead = await runConflictBoundary(() =>
    storeVerifiedAccessManifest({ verifiedManifest: manifest }, executor),
  );
  if (manifestHead.manifestHash !== manifest.manifestHash) {
    throw new ContainerMutationError("Container manifest head is stale", 409);
  }
  context.manifestHeadByContainerId.set(
    manifest.state.containerId,
    manifestHead,
  );

  const storedKekState = await runConflictBoundary(() =>
    storeVerifiedContainerKekState({ verifiedState: kekState }, executor),
  );

  return {
    containerId: manifest.state.containerId,
    organizationId: manifest.state.organizationId,
    parentId: manifest.state.parentContainerId,
    manifestHead: {
      epoch: manifestHead.epoch,
      manifestHash: manifestHead.manifestHash,
    },
    accessManifest: {
      event: projectionVerifiedAccessEventRecord(manifest.event),
      manifest: projectionAccessManifestRecord(manifest.manifest),
      manifestHash: manifest.manifestHash,
      state: containerAccessStateRecord(manifest.state),
    },
    containerKek: {
      containerId: storedKekState.containerId,
      accessManifestHash: storedKekState.accessManifestHash,
      containerKeyEpochId: storedKekState.containerKeyEpochId,
      containerKeyEpoch: storedKekState.containerKeyEpoch,
      keyEpoch: containerKeyEpochRecord(storedKekState.keyEpoch),
      keyEpochHash: storedKekState.keyEpochHash,
      keyTargetHash: storedKekState.keyTargetHash,
      parentContainerKeyEpochId: storedKekState.parentContainerKeyEpochId,
      recipientTargets: storedKekState.recipientTargets.map(
        containerKekRecipientTargetRecord,
      ),
      wraps: storedKekState.wraps.map(containerKeyWrapRecord),
    },
    referencedPrincipalHeads: manifest.manifest.referencedPrincipalHeads.map(
      referencedPrincipalHeadRecord,
    ),
  };
}
