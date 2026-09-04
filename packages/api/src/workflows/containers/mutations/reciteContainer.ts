import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import type { ContainerReciteRequest } from "@tearleads/validators/request";
import type { ContainerReciteResponse } from "@tearleads/validators/response";
import { storeVerifiedAccessManifestInTransaction } from "../../../access/write/accessManifestStore";
import {
  containerAccessManifestStateRecord,
  projectionAccessManifestRecord,
  projectionReferencedPrincipalHeadRecord,
  projectionVerifiedAccessEventRecord,
} from "../../../keyingProjectionRecords";
import { assertOrganizationCanSync } from "../../billing/organizationSyncEligibility";
import {
  appendOrganizationReadModelChangeInTransaction,
  lockOrganizationReadModelHeadForUpdateInTransaction,
} from "../../organizations/readModelChanges";
import { createContainerWriterProjectionContext } from "../writerProjection";
import {
  mutationStateStale,
  runConflictBoundary,
  toMutationError,
} from "./errors";
import {
  assertAccessEventDependenciesMatchRequest,
  verifyMutationEvent,
} from "./shared/events";
import { assertVerifiedContainerGrantReferencesValid } from "./shared/groupReferences";
import {
  assertCurrentContainerPath,
  assertManifestHeadCurrent,
  assertMutationHeadCanAdvance,
  verifyContainerManifestFromRequest,
} from "./shared/manifests";
import { persistContainerStructure } from "./shared/persistence";
import { assertPrincipalPoliciesCurrent } from "./shared/principalPolicies";
import { principalPoliciesFromRequest } from "./shared/principalPolicyRecords";
import { resolveVerifiedStoredContainerManifest } from "./shared/storedManifestArtifacts";
import type { ContainerMutationContext } from "./types";

export interface ReciteContainerInput {
  readonly expectedContainerId: string;
  readonly fingerprint: string;
  readonly request: ContainerReciteRequest;
  readonly userId: string;
}

async function verifyRecitation(
  context: ContainerMutationContext,
  input: ReciteContainerInput,
): Promise<VerifiedContainerAccessManifest> {
  const previousContainerPath = await assertCurrentContainerPath(
    context,
    input.request.previousContainerPath,
    "previousContainerPath",
  );
  const previousManifest = await resolveVerifiedStoredContainerManifest(
    context,
    input.request.previousManifest,
    "previousManifest",
  );
  await assertManifestHeadCurrent(
    context,
    previousManifest,
    "previousManifest",
  );
  const principalPolicies = await assertPrincipalPoliciesCurrent(
    context.executor,
    principalPoliciesFromRequest(input.request),
    {
      referencedPrincipalHeads: (previousContainerPath ?? []).flatMap(
        (manifest) => manifest.state.referencedPrincipalHeads,
      ),
    },
  );
  const event = await verifyMutationEvent(context.executor, {
    ...input,
    expectedEventType: "container.recite",
  });
  assertAccessEventDependenciesMatchRequest(input.request, event);
  return verifyContainerManifestFromRequest(input.request, event, {
    previousContainerPath,
    previousManifest,
    principalPolicies,
  });
}

async function persistRecitation(
  context: ContainerMutationContext,
  manifest: VerifiedContainerAccessManifest,
): Promise<ContainerReciteResponse> {
  const container = await persistContainerStructure(
    context.executor,
    manifest,
    new Date(),
  );
  const manifestHead = await runConflictBoundary(() =>
    storeVerifiedAccessManifestInTransaction(
      { verifiedManifest: manifest },
      context.executor,
    ),
  );
  if (manifestHead.manifestHash !== manifest.manifestHash)
    throw mutationStateStale("Container manifest head is stale");
  // No KEK, wrap, grant, parent edge, or tombstone changes accompany a re-cite.
  await appendOrganizationReadModelChangeInTransaction(context.executor, {
    organizationId: manifest.state.organizationId,
    lane: "grants",
    entityId: manifest.state.organizationId,
    operation: "replace",
  });
  return {
    containerId: manifest.state.containerId,
    organizationId: manifest.state.organizationId,
    parentId: manifest.state.parentContainerId,
    createdAt: container.createdAt.toISOString(),
    updatedAt: container.updatedAt.toISOString(),
    manifestHead: {
      epoch: manifestHead.epoch,
      manifestHash: manifestHead.manifestHash,
    },
    accessManifest: {
      event: projectionVerifiedAccessEventRecord(manifest.event),
      manifest: projectionAccessManifestRecord(manifest.manifest),
      manifestHash: manifest.manifestHash,
      state: containerAccessManifestStateRecord(manifest.state),
    },
    referencedPrincipalHeads: manifest.state.referencedPrincipalHeads.map(
      projectionReferencedPrincipalHeadRecord,
    ),
  };
}

export async function runReciteContainerWorkflow(
  db: ApiDatabase,
  input: ReciteContainerInput,
): Promise<ContainerReciteResponse> {
  try {
    return await db.transaction(async (executor) => {
      const context: ContainerMutationContext = {
        executor,
        manifestHeadByContainerId: new Map(),
        verifiedManifestByHash: new Map(),
        writerProjectionContext:
          createContainerWriterProjectionContext(executor),
      };
      const initial = await verifyRecitation(context, input);
      await assertVerifiedContainerGrantReferencesValid({
        executor,
        manifest: initial,
      });
      if (
        !(await lockOrganizationReadModelHeadForUpdateInTransaction(
          executor,
          initial.state.organizationId,
        ))
      ) {
        throw new Error("Organization read-model cursor head is missing");
      }
      // Match other container mutations: verify mutable heads and authority
      // again after acquiring the group -> organization mutation lock scope.
      context.manifestHeadByContainerId.clear();
      const manifest = await verifyRecitation(context, input);
      if (manifest.state.organizationId !== initial.state.organizationId)
        throw mutationStateStale("Container organization changed");
      await assertVerifiedContainerGrantReferencesValid({ executor, manifest });
      await assertMutationHeadCanAdvance(context, manifest);
      await assertOrganizationCanSync(
        executor,
        manifest.state.organizationId,
        input.userId,
      );
      return persistRecitation(context, manifest);
    });
  } catch (error) {
    throw toMutationError(error) ?? error;
  }
}
