import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { createVerifiedContainerAccessEvent } from "./accessEvent.testFixtures";
import { containerWrappingPublicKeyForTest } from "./containerWrapping.testFixtures";
import type {
  ContainerAccessManifestState,
  ContainerCreateAccessEventBody,
  ContainerDirectGrant,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedPrincipalPolicy,
} from "./index";
import {
  computeAccessManifestHash,
  deriveContainerAccessManifest,
} from "./index";

export const PREDECESSOR_BRIDGE_HASH = "0".repeat(64);
export const KEYRING_HASH = "1".repeat(64);

export async function createContainerManifestFixture(input: {
  readonly containerId: string;
  readonly containerKeyEpochId?: string | null;
  readonly containerKeyPublicKey?: string | null;
  readonly directGrants: readonly ContainerDirectGrant[];
  readonly epoch?: number;
  readonly event?: VerifiedAccessEvent;
  readonly metadataDocumentId?: string;
  readonly organizationId?: string;
  readonly parentContainerId?: string | null;
  readonly parentManifestHash?: string | null;
  readonly previousManifestHash?: string | null;
  readonly referencedPrincipalHeads?: ContainerAccessManifestState["referencedPrincipalHeads"];
  readonly signer?: ReturnType<typeof generateSigningSeedAndKeyPair>;
  readonly signerUserId?: string;
}): Promise<VerifiedContainerAccessManifest> {
  const organizationId = input.organizationId ?? "organization-1";
  const signer = input.signer ?? generateSigningSeedAndKeyPair();
  const metadataDocumentId =
    input.metadataDocumentId ?? `${input.containerId}-metadata-document`;
  const containerKeyEpochId = input.containerKeyEpochId ?? null;
  const parentManifestHash = input.parentManifestHash ?? null;
  const body: ContainerCreateAccessEventBody = {
    containerKeyPublicKey:
      input.containerKeyPublicKey ??
      containerWrappingPublicKeyForTest(containerKeyEpochId),
    systemSlot: null,
    eventType: "container.create",
    parentContainerId: input.parentContainerId ?? null,
    parentManifestHash,
    metadataDocumentId,
    containerKeyEpochId,
    directGrants: [...input.directGrants],
    referencedPrincipalHeads: input.referencedPrincipalHeads ?? [],
  };
  const event =
    input.event ??
    (await createVerifiedContainerAccessEvent({
      body,
      dependencyManifestHashes: parentManifestHash ? [parentManifestHash] : [],
      objectId: input.containerId,
      organizationId,
      previousManifestHash: input.previousManifestHash ?? null,
      signer,
      signerUserId: input.signerUserId ?? "fixture-signer",
    }));
  const state: ContainerAccessManifestState = {
    containerKeyPublicKey: body.containerKeyPublicKey,
    systemSlot: null,
    version: 1,
    containerId: input.containerId,
    organizationId,
    epoch: input.epoch ?? 1,
    previousManifestHash: input.previousManifestHash ?? null,
    eventHash: event.eventHash,
    parentContainerId: input.parentContainerId ?? null,
    parentManifestHash,
    metadataDocumentId,
    containerKeyEpochId,
    directGrants: [...input.directGrants],
    referencedPrincipalHeads: input.referencedPrincipalHeads ?? [],
  };
  const manifest = await deriveContainerAccessManifest(state);

  return {
    manifest,
    manifestHash: await computeAccessManifestHash(manifest),
    event,
    state,
  } as VerifiedContainerAccessManifest;
}

export function createPrincipalPolicyFixture(
  principalHead: ContainerAccessManifestState["referencedPrincipalHeads"][number],
): VerifiedPrincipalPolicy {
  return {
    principalType: principalHead.principalType,
    principalId: principalHead.principalId,
    version: principalHead.version,
    keyEpoch: principalHead.keyEpoch,
    stateHash: principalHead.stateHash,
    state: {
      keyFingerprint: principalHead.keyFingerprint,
    },
    projection: [],
    checkpoint: {
      principalType: principalHead.principalType,
      principalId: principalHead.principalId,
      version: principalHead.version,
      stateHash: principalHead.stateHash,
    },
  } as unknown as VerifiedPrincipalPolicy;
}
