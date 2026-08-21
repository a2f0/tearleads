import {
  type AccessEvent,
  type AttachmentBindAccessEventBody,
  computeAccessEventHash,
  computeBlobContentKeyTargetHash,
  type WriteHeader,
} from "@symcrypt/crypto";
import type { BlobContentKeyBundleRequest } from "@symcrypt/validators/request";
import type {
  BlobAttachmentBindResponse,
  BlobAttachmentDetachResponse,
} from "@symcrypt/validators/response";
import { serializeCanonical, uniqueSortedStrings } from "../../shared/readers";
import {
  contentKeyTargetReference,
  readBlobKekTarget,
  sortBlobTargets,
} from "./readers";
import type { BlobContentKeyTarget, DocumentManifestIdentity } from "./types";

export async function assertBlobContentKeyBundleTargetHash(
  bundle: BlobContentKeyBundleRequest,
): Promise<void> {
  const targetHash = await computeBlobContentKeyTargetHash(
    bundle.targets.map(contentKeyTargetReference),
  );
  if (targetHash !== bundle.targetHash) {
    throw new Error("Blob content-key target hash is not canonical");
  }
}

function normalizedBlobContentKeyBundle(
  bundle: BlobContentKeyBundleRequest,
): BlobContentKeyBundleRequest {
  return {
    contentKeyEpoch: bundle.contentKeyEpoch,
    targetHash: bundle.targetHash,
    targets: sortBlobTargets(bundle.targets),
  };
}

function assertStringSetsEqual(input: {
  actual: readonly string[];
  expected: readonly string[];
  message: string;
}): void {
  const actual = uniqueSortedStrings(input.actual);
  const expected = uniqueSortedStrings(input.expected);
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(input.message);
  }
}

async function assertBlobAttachmentBindResponseTargets(input: {
  bindingId: string;
  blobId: string;
  contentKeyBundle: BlobContentKeyBundleRequest;
  manifestIdentity: DocumentManifestIdentity;
  response: BlobAttachmentBindResponse;
  targetHash: string;
  targets: readonly BlobContentKeyTarget[];
}): Promise<void> {
  if (input.response.contentKeyBundle.blobId !== input.blobId) {
    throw new Error("Blob attachment bind response blob id mismatch");
  }

  const responseContentKeyBundle = normalizedBlobContentKeyBundle({
    contentKeyEpoch: input.response.contentKeyBundle.contentKeyEpoch,
    targetHash: input.response.contentKeyBundle.targetHash,
    targets: input.response.contentKeyBundle.targets,
  });
  await assertBlobContentKeyBundleTargetHash(responseContentKeyBundle);
  if (
    serializeCanonical(
      responseContentKeyBundle,
      "Blob attachment bind response content-key bundle",
    ) !==
    serializeCanonical(
      normalizedBlobContentKeyBundle(input.contentKeyBundle),
      "Blob attachment bind request content-key bundle",
    )
  ) {
    throw new Error(
      "Blob attachment bind response content-key bundle mismatch",
    );
  }

  const responseTargets = sortBlobTargets(
    input.response.blobKekTargets.targets.map((target, index) =>
      readBlobKekTarget(
        target,
        `Blob attachment bind response KEK target[${index}]`,
      ),
    ),
  );
  const expectedTargets = sortBlobTargets(input.targets);
  if (
    serializeCanonical(
      responseTargets,
      "Blob attachment bind response KEK targets",
    ) !==
    serializeCanonical(
      expectedTargets,
      "Blob attachment bind request KEK targets",
    )
  ) {
    throw new Error("Blob attachment bind response KEK targets mismatch");
  }

  if (
    input.response.blobKekTargets.blobId !== input.blobId ||
    input.response.blobKekTargets.organizationId !==
      input.manifestIdentity.organizationId ||
    input.response.blobKekTargets.blobKeyTargetHash !== input.targetHash
  ) {
    throw new Error("Blob attachment bind response KEK summary mismatch");
  }
  assertStringSetsEqual({
    actual: input.response.blobKekTargets.activeBindingIds,
    expected: [input.bindingId],
    message: "Blob attachment bind response active bindings mismatch",
  });
  assertStringSetsEqual({
    actual: input.response.blobKekTargets.documentManifestHashes,
    expected: [input.manifestIdentity.manifestHash],
    message: "Blob attachment bind response document manifests mismatch",
  });
  assertStringSetsEqual({
    actual: input.response.blobKekTargets.linkedContainerManifestHashes,
    expected: expectedTargets.map((target) => target.containerManifestHash),
    message: "Blob attachment bind response container manifests mismatch",
  });
  assertStringSetsEqual({
    actual: input.response.blobKekTargets.linkedContainerKeyEpochIds,
    expected: expectedTargets.map((target) => target.containerKeyEpochId),
    message: "Blob attachment bind response container KEKs mismatch",
  });
}

export async function assertBlobAttachmentBindResponse(input: {
  body: AttachmentBindAccessEventBody;
  bindingId: string;
  blobAccessManifestHash: string;
  blobId: string;
  contentKeyBundle: BlobContentKeyBundleRequest;
  documentId: string;
  event: AccessEvent;
  manifestIdentity: DocumentManifestIdentity;
  response: BlobAttachmentBindResponse;
  slotId: string;
  targetHash: string;
  targets: readonly BlobContentKeyTarget[];
  writeHeader: WriteHeader;
  writeHeaderHash: string;
}): Promise<void> {
  // This boundary is used only by the staged upload workflow: those bytes were
  // written under the same target set the bind response acknowledges. A future
  // SDK re-bind workflow must instead accept the blob's historical write
  // authorization, which can legitimately differ from the new binding set.
  if (
    !input.response.bindingEvent ||
    input.response.documentManifestHash !==
      input.manifestIdentity.manifestHash ||
    input.response.previousBindingId !== input.body.expectedBindingId ||
    serializeCanonical(
      input.response.bindingEvent.body,
      "Blob attachment bind response event body",
    ) !== serializeCanonical(input.body, "Blob attachment bind request body") ||
    serializeCanonical(
      input.response.bindingEvent.event,
      "Blob attachment bind response event",
    ) !==
      serializeCanonical(input.event, "Blob attachment bind request event") ||
    input.response.bindingEvent.eventHash !==
      (await computeAccessEventHash(input.event)) ||
    !input.response.writeHeader ||
    serializeCanonical(
      input.response.writeHeader,
      "Blob attachment bind response write header",
    ) !==
      serializeCanonical(input.writeHeader, "Blob attachment write header") ||
    input.response.blobId !== input.blobId ||
    input.response.bindingId !== input.bindingId ||
    input.response.documentId !== input.documentId ||
    input.response.slotId !== input.slotId ||
    input.response.blobKekTargets.blobAccessManifestHash !==
      input.blobAccessManifestHash ||
    !input.response.writeAuthorization ||
    serializeCanonical(
      input.response.writeAuthorization,
      "Blob attachment bind response write authorization",
    ) !==
      serializeCanonical(
        input.response.blobKekTargets,
        "Blob attachment bind response KEK targets",
      ) ||
    input.response.writeHeaderHash !== input.writeHeaderHash
  ) {
    throw new Error("Blob attachment bind response did not match request");
  }

  await assertBlobAttachmentBindResponseTargets(input);
}

export function assertBlobAttachmentDetachResponse(input: {
  bindingId: string;
  blobId: string;
  documentId: string;
  response: BlobAttachmentDetachResponse;
  slotId: string;
}): void {
  if (
    input.response.bindingId !== input.bindingId ||
    input.response.blobId !== input.blobId ||
    input.response.documentId !== input.documentId ||
    input.response.slotId !== input.slotId
  ) {
    throw new Error("Blob attachment detach response did not match request");
  }
}
