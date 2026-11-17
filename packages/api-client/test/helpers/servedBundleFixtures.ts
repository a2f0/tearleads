import { reconstructServedAccessManifestStates } from "@tearleads/crypto";
import { containerWrappingPublicKeyForTest } from "@tearleads/crypto/container-wrapping-test-fixtures";

const ORGANIZATION_ID = "organization-1";

function hex(seed: string): string {
  return seed.padEnd(64, "0");
}

function signedEvent(input: {
  readonly eventType: "container.create" | "document.link";
  readonly objectId: string;
}): Record<string, unknown> {
  return {
    version: 1,
    eventId: `event-${input.objectId}`,
    eventType: input.eventType,
    objectKind:
      input.eventType === "container.create" ? "container" : "document",
    objectId: input.objectId,
    organizationId: ORGANIZATION_ID,
    previousManifestHash: null,
    dependencyManifestHashes: [],
    bodyHash: hex("b"),
    signerUserId: "user-1",
    signerDeviceId: "device-1",
    signerKeyFingerprint: hex("f"),
    signedAt: "2026-05-06T18:00:00.000Z",
    signature: "signature",
  };
}

/** The state decoding rebuilds for a served genesis bundle. */
function withRebuiltState<
  T extends { readonly event: unknown; readonly manifestHash: string },
>(bundle: T): T & { state: Record<string, unknown> } {
  const state = reconstructServedAccessManifestStates(
    new Map([[bundle.manifestHash, bundle]]),
  ).get(bundle.manifestHash);
  if (!state) throw new Error("fixture bundle does not rebuild");
  return { ...bundle, state: { ...state } };
}

/** A well-formed container genesis whose served form decodes to itself. */
export function servedContainerGenesis(containerId: string) {
  return withRebuiltState({
    event: {
      event: signedEvent({
        eventType: "container.create",
        objectId: containerId,
      }),
      body: {
        eventType: "container.create",
        parentContainerId: null,
        parentManifestHash: null,
        metadataDocumentId: `${containerId}-metadata`,
        systemSlot: null,
        containerKeyEpochId: "container-key-epoch-id",
        containerKeyPublicKey: containerWrappingPublicKeyForTest(
          "container-key-epoch-id",
        ),
        directGrants: [
          { accessLevel: "admin", subjectId: "user-1", subjectType: "user" },
        ],
        referencedPrincipalHeads: [],
      },
      eventHash: hex("ec"),
    },
    manifest: { objectId: containerId, objectKind: "container" },
    manifestHash: "container-manifest-hash",
  });
}

/** A well-formed initial document link whose served form decodes to itself. */
export function servedDocumentGenesis(documentId: string) {
  return withRebuiltState({
    event: {
      event: signedEvent({ eventType: "document.link", objectId: documentId }),
      body: {
        eventType: "document.link",
        blobRewraps: [],
        containerId: "container-1",
        containerManifestHash: hex("c"),
      },
      eventHash: hex("ed"),
    },
    manifest: { objectId: documentId, objectKind: "document" },
    manifestHash: "document-manifest-hash",
  });
}
