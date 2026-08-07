import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type { AccessEventType, VerifiedAccessEvent } from "@tearleads/crypto";
import { verifySignedAccessEvent } from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import { readProjectionAccessEvent } from "../../../../keyingProjectionRecords";
import { readKeyingCanonicalJson } from "../../../../utils/canonicalJson";
import { loadSignerPublicKey } from "../../../signerPublicKey";
import { ContainerMutationError, mutationShapeError } from "../errors";
import type { MutateContainerInput } from "../types";

export async function verifyMutationEvent(
  executor: DatabaseTransaction,
  input: MutateContainerInput,
): Promise<VerifiedAccessEvent> {
  const event = readProjectionAccessEvent(
    input.request.event,
    "Container mutation event",
    mutationShapeError,
  );

  if (
    event.signerUserId !== input.userId ||
    event.signerKeyFingerprint !== input.fingerprint
  ) {
    throw new ContainerMutationError("Forbidden", 403);
  }

  if (event.eventType !== input.expectedEventType) {
    throw new ContainerMutationError("Unexpected container event type", 400);
  }

  if (
    input.expectedContainerId !== undefined &&
    event.objectId !== input.expectedContainerId
  ) {
    throw new ContainerMutationError("Container id mismatch", 400);
  }

  const verifiedEvent = await verifySignedAccessEvent({
    body: readKeyingCanonicalJson(
      input.request.body,
      "Container mutation event body",
    ),
    event,
    signerPublicKey: await loadSignerPublicKey(executor, {
      ...input,
      error: (message, status) => new ContainerMutationError(message, status),
    }),
  });

  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }

  return verifiedEvent.value;
}

function appendPathManifestHashes(
  hashes: string[],
  path: readonly { readonly manifestHash: string }[] | undefined,
): void {
  if (!path) {
    return;
  }

  for (const manifest of path) {
    hashes.push(manifest.manifestHash);
  }
}

function expectedAccessEventDependencyHashes(
  request: ContainerMutationRequest,
  eventType: AccessEventType,
): string[] {
  const hashes: string[] = [];

  if (eventType === "container.create") {
    appendPathManifestHashes(hashes, request.parentContainerPath);
  } else {
    if (request.previousManifest) {
      hashes.push(request.previousManifest.manifestHash);
    }
    appendPathManifestHashes(hashes, request.previousContainerPath);

    if (eventType === "container.move") {
      appendPathManifestHashes(hashes, request.destinationParentContainerPath);
    }
  }

  return [...new Set(hashes)].sort();
}

export function assertAccessEventDependenciesMatchRequest(
  request: ContainerMutationRequest,
  event: VerifiedAccessEvent,
): void {
  const expected = expectedAccessEventDependencyHashes(
    request,
    event.event.eventType,
  );
  const actual = [...event.event.dependencyManifestHashes].sort();

  if (
    expected.length !== actual.length ||
    expected.some((dependencyHash, index) => dependencyHash !== actual[index])
  ) {
    throw new ContainerMutationError(
      "Access event dependency hashes do not match supplied manifests",
      409,
    );
  }
}
