import {
  computeAccessManifestHash,
  verifyAccessManifest,
} from "../access/accessEvent";
import type { VerifyContainerAccessManifestInput } from "../access/accessManifestVerificationTypes";
import { runVerifier, throwVerification } from "../core/shared";
import type { KeyingVerificationResult } from "../core/verificationError";
import { normalizeContainerAccessEventBody } from "./containerAccessBodies";
import { deriveContainerAccessManifest } from "./containerAccessState";
import { deriveContainerAccessManifestStateFromEvent } from "./containerAccessTransitions";
import type { VerifiedContainerAccessManifest } from "./containerAccessTypes";
import { makeVerifiedContainerAccessManifest } from "./containerAccessTypes";
import { assertContainerPrincipalReferencesProgress } from "./containerPrincipalReferences";
import { assertContainerSystemTopology } from "./containerSystemTopology";

export { normalizeContainerAccessEventBody } from "./containerAccessBodies";
export {
  computeContainerAccessKeyTargetHash,
  computeContainerAccessStructuralHash,
  computeContainerDirectGrantRoot,
  deriveContainerAccessManifest,
} from "./containerAccessState";
export { requireContainerPathLast } from "./containerParentAuthority";
export {
  containerAccessLevelRank,
  principalPolicyMatchesReference,
  requireContainerPathUserAccess,
  resolveContainerPathUserAccessLevel,
  resolveHistoricalContainerPathUserAccessLevel,
} from "./containerPathAccess";
export async function verifyContainerAccessManifest({
  authorizationMembership = "current",
  checkpointPredecessors,
  destinationParentContainerPath,
  event,
  expectedManifestHash,
  localCheckpoint,
  manifest,
  parentContainerPath,
  previousContainerPath,
  previousManifest = null,
  principalPolicies = [],
}: VerifyContainerAccessManifestInput): Promise<
  KeyingVerificationResult<VerifiedContainerAccessManifest>
> {
  return runVerifier(async () => {
    const body = normalizeContainerAccessEventBody(event.body);
    if (body.eventType === "container.create")
      await assertContainerSystemTopology(body, event.event.organizationId);
    const state = deriveContainerAccessManifestStateFromEvent({
      authorizationMembership,
      body,
      destinationParentContainerPath,
      event,
      parentContainerPath,
      previousContainerPath,
      previousManifest,
      principalPolicies,
    });
    assertContainerPrincipalReferencesProgress(
      previousManifest?.state.referencedPrincipalHeads ?? [],
      state.referencedPrincipalHeads,
    );
    const derivedManifest = await deriveContainerAccessManifest(state);
    const derivedManifestHash =
      await computeAccessManifestHash(derivedManifest);

    if (derivedManifestHash !== expectedManifestHash) {
      throwVerification(
        "hash_mismatch",
        "container access manifest hash does not match derived state",
      );
    }

    const verifiedManifest = await verifyAccessManifest({
      manifest: manifest ?? derivedManifest,
      expectedManifestHash,
      event,
      expectedObject: {
        objectKind: "container",
        objectId: state.containerId,
      },
      expectedPreviousManifestHash: state.previousManifestHash,
      localCheckpoint,
      checkpointPredecessors,
    });

    if (!verifiedManifest.ok) {
      throw verifiedManifest.error;
    }

    return makeVerifiedContainerAccessManifest({
      manifest: derivedManifest,
      manifestHash: verifiedManifest.value.manifestHash,
      event,
      state,
      checkpoint: verifiedManifest.value.checkpoint,
    });
  });
}
