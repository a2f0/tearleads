import { expect, test } from "bun:test";
import {
  computeDocumentContentKeyTargetHash,
  KeyingVerificationError,
} from "@symcrypt/crypto";
import type { DocumentContentKeyBundleResponse } from "@symcrypt/validators/response";
import {
  ContainerKekHistoryUnavailableError,
  DocumentHistoryUnavailableError,
  unwrapDocumentContentKeyFromBundle,
} from "../../data/documents/shared/projection";
import { targetEnvelopeReference } from "../../data/documents/shared/readers";

const availabilityTarget = {
  containerId: "availability-container",
  containerKeyEpoch: 2,
  containerKeyEpochId: "availability-epoch",
  containerManifestHash: "a".repeat(64),
  wrappedKey: "unused",
  wrappingMetadata: {},
};
const integrityTarget = {
  ...availabilityTarget,
  containerId: "integrity-container",
  containerKeyEpochId: "integrity-epoch",
  containerManifestHash: "b".repeat(64),
};

async function bundleWithTargets(
  targets: DocumentContentKeyBundleResponse["targets"],
): Promise<DocumentContentKeyBundleResponse> {
  return {
    contentKeyEpoch: 1,
    documentId: "document-id",
    linkSetManifestHash: "link-set-manifest",
    targetHash: await computeDocumentContentKeyTargetHash(
      targets.map(targetEnvelopeReference),
    ),
    targets,
  };
}

test.each([
  [availabilityTarget, integrityTarget],
  [integrityTarget, availabilityTarget],
])("integrity failure outranks missing predecessor history in either target order", async (firstTarget, secondTarget) => {
  const unavailable = new ContainerKekHistoryUnavailableError(
    "Unavailable container",
  );
  const integrity = new KeyingVerificationError(
    "missing_dependency",
    "Verified predecessor history is corrupt",
  );
  const error = await unwrapDocumentContentKeyFromBundle(
    await bundleWithTargets([firstTarget, secondTarget]),
    new Map(),
    new Map([
      [availabilityTarget.containerKeyEpochId, unavailable],
      [integrityTarget.containerKeyEpochId, integrity],
    ]),
  ).then(
    () => null,
    (thrown: unknown) => thrown,
  );

  expect(error).toBeInstanceOf(DocumentHistoryUnavailableError);
  expect((error as DocumentHistoryUnavailableError).historyCause).toBe(
    integrity,
  );
});
