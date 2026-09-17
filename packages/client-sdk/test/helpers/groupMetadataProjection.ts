import {
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  normalizeContainerAccessEventBody,
} from "@tearleads/crypto";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import {
  buildContainerCreateBody,
  buildContainerCreateKeyEpoch,
  deriveContainerCreateManifest,
  resolveContainerKekEpochId,
  signContainerCreateEvent,
} from "../../src/data/containers/shared/events";
import {
  readCanonicalJson,
  readCanonicalRecord,
  readCanonicalRecords,
} from "../../src/data/keyingCanonicalJson";
import type { createParentProjection } from "./containerFixtures";

/** Independently signed root; copying recipient envelopes does not copy ancestry. */
export async function createTestGroupMetadataProjection(
  parent: Awaited<ReturnType<typeof createParentProjection>>,
) {
  const containerId = "organization-metadata-container";
  const organizationId = parent.author.organizationId;
  const keyMaterial = parent.parentContainerKek;
  const containerKeyEpochId = await resolveContainerKekEpochId({
    containerId,
    keyEpoch: 1,
    keyMaterial,
  });
  const source = parent.projection.path[0];
  if (!source) throw new Error("Expected source root");
  const body = {
    ...buildContainerCreateBody({
      containerKeyEpochId,
      metadataDocumentId: containerId,
      parentContainerId: null,
      parentManifestHash: null,
      systemSlot: await deriveOrganizationMetadataContainerSystemSlot({
        organizationId,
      }),
    }),
  };
  // The test root contains only user recipients, with no managed policy heads.
  const grants = parent.parentKekState.recipientTargets.map((target) => ({
    subjectType: "user" as const,
    subjectId: target.recipientId,
    accessLevel:
      target.recipientId === parent.userId
        ? ("admin" as const)
        : ("read" as const),
  }));
  const signedBody = normalizeContainerAccessEventBody(
    readCanonicalJson({ ...body, directGrants: grants }, "Creation body"),
  );
  if (signedBody.eventType !== "container.create")
    throw new Error("Expected creation body");
  const { event, eventHash } = await signContainerCreateEvent({
    author: parent.author,
    body: signedBody,
    containerId,
    eventId: crypto.randomUUID(),
    organizationId,
    parentPath: [],
    signedAt: new Date().toISOString(),
  });
  const { eventType: _eventType, ...fields } = signedBody;
  const { manifest, manifestHash, state } = await deriveContainerCreateManifest(
    { ...fields, containerKeyEpochId, containerId, eventHash, organizationId },
  );
  const keyEpoch = buildContainerCreateKeyEpoch({
    containerId,
    containerKeyEpochId,
    eventHash,
    manifestHash,
    parentContainerKeyEpochId: null,
  });
  const wraps = parent.parentKekState.wraps.map((wrap) => ({
    ...wrap,
    containerKeyEpochId,
    wrapManifestHash: manifestHash,
  }));
  return {
    key: { organizationId, containerId, containerKeyEpochId, keyMaterial },
    projection: {
      organizationId,
      containerId,
      path: [
        {
          event: {
            event: readCanonicalRecord(event, "event"),
            body: readCanonicalRecord(signedBody, "body"),
            eventHash,
          },
          manifest: readCanonicalRecord(manifest, "manifest"),
          manifestHash,
          state: readCanonicalRecord(state, "state"),
        },
      ],
      containerKeks: [
        {
          containerId,
          accessManifestHash: manifestHash,
          containerKeyEpochId,
          containerKeyEpoch: 1,
          keyEpoch: readCanonicalRecord(keyEpoch, "epoch"),
          keyEpochHash: await computeContainerKeyEpochHash(keyEpoch),
          keyTargetHash: await computeContainerKekRecipientTargetHash(
            parent.parentKekState.recipientTargets,
          ),
          containerManifestHistory: [],
          parentContainerKeyEpochId: null,
          keyring: null,
          recipientTargets: readCanonicalRecords(
            parent.parentKekState.recipientTargets,
            "targets",
          ),
          wraps: readCanonicalRecords(wraps, "wraps"),
        },
      ],
    },
  };
}
