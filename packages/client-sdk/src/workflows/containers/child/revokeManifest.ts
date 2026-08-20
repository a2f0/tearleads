import type {
  ContainerAccessManifestState,
  ContainerDirectGrant,
  ContainerGrantPrincipalHead,
} from "@tearleads/crypto";
import {
  computeAccessManifestHash,
  deriveContainerAccessManifest,
} from "@tearleads/crypto";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { readContainerState } from "../../../data/containers/shared/projection";
import type { ContainerRevokePlan } from "../../../data/containers/shared/types";

export type ContainerRevokeSubject = Pick<
  ContainerDirectGrant,
  "subjectId" | "subjectType"
>;

function isSameContainerGrantSubject(
  left: Pick<ContainerDirectGrant, "subjectId" | "subjectType">,
  right: Pick<ContainerDirectGrant, "subjectId" | "subjectType">,
): boolean {
  return (
    left.subjectType === right.subjectType && left.subjectId === right.subjectId
  );
}

function isSameReferencedPrincipalSubject(
  head: ContainerGrantPrincipalHead,
  revokedSubject: ContainerRevokeSubject,
): boolean {
  return (
    head.principalType === revokedSubject.subjectType &&
    head.principalId === revokedSubject.subjectId
  );
}

function removeContainerGrant(
  grants: readonly ContainerDirectGrant[],
  revokedSubject: ContainerRevokeSubject,
): ContainerDirectGrant[] {
  return grants.filter(
    (grant) => !isSameContainerGrantSubject(grant, revokedSubject),
  );
}

function removeReferencedPrincipalHead(
  principalHeads: ContainerGrantPrincipalHead[],
  revokedSubject: ContainerRevokeSubject,
): ContainerGrantPrincipalHead[] {
  if (revokedSubject.subjectType === "user") {
    return principalHeads;
  }

  return principalHeads.filter(
    (head) => !isSameReferencedPrincipalSubject(head, revokedSubject),
  );
}

function requireRevokedGrantExists(input: {
  previousState: ContainerAccessManifestState;
  revokedSubject: ContainerRevokeSubject;
}): void {
  if (
    !input.previousState.directGrants.some((grant) =>
      isSameContainerGrantSubject(grant, input.revokedSubject),
    )
  ) {
    throw new Error("Container grant is not present");
  }
}

export async function deriveContainerRevokeManifest(input: {
  containerKeyEpochId: string;
  eventHash: string;
  previousManifest: ContainerWriterProjectionResponse["path"][number];
  revokedSubject: ContainerRevokeSubject;
}): Promise<Pick<ContainerRevokePlan, "manifest" | "manifestHash" | "state">> {
  const previousState = readContainerState(input.previousManifest);
  requireRevokedGrantExists({
    previousState,
    revokedSubject: input.revokedSubject,
  });

  const state: ContainerAccessManifestState = {
    ...previousState,
    epoch: previousState.epoch + 1,
    previousManifestHash: input.previousManifest.manifestHash,
    eventHash: input.eventHash,
    containerKeyEpochId: input.containerKeyEpochId,
    directGrants: removeContainerGrant(
      previousState.directGrants,
      input.revokedSubject,
    ),
    referencedPrincipalHeads: removeReferencedPrincipalHead(
      previousState.referencedPrincipalHeads,
      input.revokedSubject,
    ),
  };
  const manifest = await deriveContainerAccessManifest(state);

  return {
    manifest,
    manifestHash: await computeAccessManifestHash(manifest),
    state,
  };
}
