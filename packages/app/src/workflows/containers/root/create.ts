import type {
  AccessEvent,
  AccessManifest,
  ContainerCreateAccessEventBody,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
} from "@tearleads/crypto";
import {
  computeAccessManifestHash,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  deriveContainerAccessManifest,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  buildContainerCreateBody,
  buildContainerCreateKeyEpoch,
  deriveContainerCreateManifest,
  resolveContainerKekEpochId,
  signContainerCreateEvent,
} from "../../../data/containers/shared/events";
import { wrapContainerKeyToRootUser } from "../../../data/containers/shared/projection";
import type {
  ContainerCreatePlan,
  ContainerMutationAuthor,
  MaterializedContainerCreatePlan,
} from "../../../data/containers/shared/types";
import {
  readCanonicalRecord,
  readCanonicalRecords,
} from "../../../data/keyingCanonicalJson";

function buildRootContainerCreateBody(input: {
  author: ContainerMutationAuthor;
  containerKeyEpochId: string;
  metadataDocumentId: string;
}): ContainerCreateAccessEventBody {
  return {
    ...buildContainerCreateBody({
      containerKeyEpochId: input.containerKeyEpochId,
      metadataDocumentId: input.metadataDocumentId,
      parentContainerId: null,
      parentManifestHash: null,
    }),
    directGrants: [
      {
        accessLevel: "admin",
        subjectId: input.author.signerUserId,
        subjectType: "user",
      },
    ],
  };
}

async function deriveRootContainerCreateManifest(input: {
  author: ContainerMutationAuthor;
  body: ContainerCreateAccessEventBody;
  containerId: string;
  containerKeyEpochId: string;
  eventHash: string;
  metadataDocumentId: string;
}): Promise<Pick<ContainerCreatePlan, "manifest" | "manifestHash" | "state">> {
  const { state } = await deriveContainerCreateManifest({
    author: input.author,
    containerId: input.containerId,
    containerKeyEpochId: input.containerKeyEpochId,
    eventHash: input.eventHash,
    metadataDocumentId: input.metadataDocumentId,
    parentContainerId: null,
    parentManifestHash: null,
  });
  state.directGrants = input.body.directGrants;
  const manifest = await deriveContainerAccessManifest(state);

  return {
    manifest,
    manifestHash: await computeAccessManifestHash(manifest),
    state,
  };
}

function buildRootContainerCreateRequest(input: {
  body: ContainerCreateAccessEventBody;
  event: AccessEvent;
  keyEpoch: ContainerKeyEpoch;
  manifest: AccessManifest;
  manifestHash: string;
  userRecipientKeys: readonly ContainerUserRecipientKey[];
  wraps: readonly ContainerKeyWrap[];
}): ContainerMutationRequest {
  return {
    event: readCanonicalRecord(input.event, "Container root create event"),
    body: readCanonicalRecord(input.body, "Container root create body"),
    expectedManifestHash: input.manifestHash,
    manifest: readCanonicalRecord(
      input.manifest,
      "Container root create manifest",
    ),
    previousManifest: null,
    parentContainerPath: [],
    principalPolicies: [],
    keyEpoch: readCanonicalRecord(
      input.keyEpoch,
      "Container root create key epoch",
    ),
    wraps: readCanonicalRecords(input.wraps, "Container root create wraps"),
    userRecipientKeys: readCanonicalRecords(
      input.userRecipientKeys,
      "Container root create user recipient keys",
    ),
  };
}

export async function buildRootContainerCreatePlan(input: {
  author: ContainerMutationAuthor;
  containerId: string;
  containerKey?: Uint8Array | undefined;
  containerKeyEpochId?: string | undefined;
  eventId?: string | undefined;
  metadataDocumentId: string;
  recipientEncapsulationPublicKey: Uint8Array;
  signedAt?: string | undefined;
}): Promise<MaterializedContainerCreatePlan> {
  const containerKey =
    input.containerKey ?? crypto.getRandomValues(new Uint8Array(32));
  if (containerKey.byteLength !== 32) {
    throw new Error("Container KEK material must be 32 bytes");
  }

  const containerKeyEpochId = await resolveContainerKekEpochId({
    containerId: input.containerId,
    keyEpoch: 1,
    keyMaterial: containerKey,
    override: input.containerKeyEpochId,
  });
  const body = buildRootContainerCreateBody({
    author: input.author,
    containerKeyEpochId,
    metadataDocumentId: input.metadataDocumentId,
  });
  const { event, eventHash } = await signContainerCreateEvent({
    author: input.author,
    body,
    containerId: input.containerId,
    eventId: input.eventId ?? crypto.randomUUID(),
    parentPath: [],
    signedAt: input.signedAt ?? new Date().toISOString(),
  });
  const { manifest, manifestHash, state } =
    await deriveRootContainerCreateManifest({
      author: input.author,
      body,
      containerId: input.containerId,
      containerKeyEpochId,
      eventHash,
      metadataDocumentId: input.metadataDocumentId,
    });
  const keyEpoch = buildContainerCreateKeyEpoch({
    containerId: input.containerId,
    containerKeyEpochId,
    eventHash,
    manifestHash,
    parentContainerKeyEpochId: null,
  });
  const { recipientTarget, userRecipientKey, wrap } =
    await wrapContainerKeyToRootUser({
      containerKey,
      containerKeyEpochId,
      manifestHash,
      recipientEncapsulationPublicKey: input.recipientEncapsulationPublicKey,
      userId: input.author.signerUserId,
    });
  const recipientTargets = [recipientTarget];
  const keyTargetHash =
    await computeContainerKekRecipientTargetHash(recipientTargets);
  const keyEpochHash = await computeContainerKeyEpochHash(keyEpoch);
  const plan: ContainerCreatePlan = {
    body,
    containerId: input.containerId,
    containerKeyEpochId,
    event,
    eventHash,
    keyEpoch,
    keyEpochHash,
    keyTargetHash,
    manifest,
    manifestHash,
    metadataDocumentId: input.metadataDocumentId,
    parentContainerId: null,
    parentManifestHash: null,
    recipientTargets,
    request: buildRootContainerCreateRequest({
      body,
      event,
      keyEpoch,
      manifest,
      manifestHash,
      userRecipientKeys: [userRecipientKey],
      wraps: [wrap],
    }),
    state,
    wraps: [wrap],
  };

  return { containerKey, plan };
}

export function rootContainerWriterProjectionFromCreatePlan(
  plan: ContainerCreatePlan,
): ContainerWriterProjectionResponse {
  return {
    containerId: plan.containerId,
    organizationId: plan.state.organizationId,
    path: [
      {
        event: {
          event: readCanonicalRecord(plan.event, "Container root event"),
          body: readCanonicalRecord(plan.body, "Container root body"),
          eventHash: plan.eventHash,
        },
        manifest: readCanonicalRecord(plan.manifest, "Container root manifest"),
        manifestHash: plan.manifestHash,
        state: readCanonicalRecord(plan.state, "Container root state"),
      },
    ],
    containerKeks: [
      {
        containerId: plan.containerId,
        accessManifestHash: plan.manifestHash,
        containerKeyEpochId: plan.containerKeyEpochId,
        containerKeyEpoch: plan.keyEpoch.keyEpoch,
        keyEpoch: readCanonicalRecord(
          plan.keyEpoch,
          "Container root key epoch",
        ),
        keyEpochHash: plan.keyEpochHash,
        keyTargetHash: plan.keyTargetHash,
        parentContainerKeyEpochId: null,
        recipientTargets: readCanonicalRecords(
          plan.recipientTargets,
          "Container root recipient targets",
        ),
        wraps: readCanonicalRecords(plan.wraps, "Container root wraps"),
      },
    ],
  };
}
