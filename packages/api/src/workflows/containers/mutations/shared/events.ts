import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import type { AccessEventType, VerifiedAccessEvent } from "@tearleads/crypto";
import { verifySignedAccessEvent } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import { readProjectionAccessEvent } from "../../../../keyingProjectionRecords";
import { readKeyingCanonicalJson } from "../../../../utils/canonicalJson";
import { ContainerMutationError, mutationShapeError } from "../errors";
import type { MutateContainerInput } from "../types";

async function loadSignerPublicKey(
  executor: DatabaseTransaction,
  input: {
    readonly fingerprint: string;
    readonly userId: string;
  },
): Promise<Uint8Array> {
  const [user] = await executor
    .select({
      fingerprint: users.fingerprint,
      signingPublicKey: users.signingPublicKey,
    })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!user || user.fingerprint !== input.fingerprint) {
    throw new ContainerMutationError("Forbidden", 403);
  }

  return base64ToBytes(user.signingPublicKey);
}

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
    signerPublicKey: await loadSignerPublicKey(executor, input),
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
