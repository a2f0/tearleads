import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@symcrypt/crypto";
import type { DocumentContentKeyBundleResponse } from "@symcrypt/validators/response";
import {
  ContainerKekHistoryUnavailableError,
  DocumentHistoryUnavailableError,
  unwrapDocumentContentKeyFromBundle,
} from "../../data/documents/shared/projection";

const availabilityTarget = {
  containerId: "availability-container",
  containerKeyEpoch: 2,
  containerKeyEpochId: "availability-epoch",
  containerManifestHash: "availability-manifest",
  wrappedKey: "unused",
  wrappingMetadata: {},
};
const integrityTarget = {
  ...availabilityTarget,
  containerId: "integrity-container",
  containerKeyEpochId: "integrity-epoch",
  containerManifestHash: "integrity-manifest",
};

function bundleWithTargets(
  targets: DocumentContentKeyBundleResponse["targets"],
): DocumentContentKeyBundleResponse {
  return {
    contentKeyEpoch: 1,
    documentId: "document-id",
    linkSetManifestHash: "link-set-manifest",
    targetHash: "target-hash",
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
    bundleWithTargets([firstTarget, secondTarget]),
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
