import {
  requireWriteAccessThroughCommittedBlobTarget,
  requireWriteAccessThroughCommittedDocumentTarget,
} from "./documentAccess";
import { throwVerification } from "./shared";
import type { VerifyWriteHeaderInput, WriteHeader } from "./types";

function assertDocumentWriteHeaderAuthorization(input: {
  readonly authorization: NonNullable<
    VerifyWriteHeaderInput["documentAuthorization"]
  >;
  readonly header: WriteHeader;
}): void {
  const { authorization, header } = input;
  const { documentKekTargets, documentManifest } = authorization;

  if (header.objectKind !== "document") {
    throwVerification(
      "object_mismatch",
      "document write authorization requires a document write header",
    );
  }

  if (
    documentManifest.state.documentId !== header.objectId ||
    documentManifest.state.organizationId !== header.organizationId ||
    documentManifest.manifestHash !== header.accessManifestHash
  ) {
    throwVerification(
      "object_mismatch",
      "write header does not match the committed document access manifest",
    );
  }

  if (
    documentKekTargets.documentId !== header.objectId ||
    documentKekTargets.linkSetManifestHash !== documentManifest.manifestHash ||
    documentKekTargets.documentKeyTargetHash !== header.targetHash
  ) {
    throwVerification(
      "hash_mismatch",
      "write header target hash does not match the verified document KEK targets",
    );
  }

  const linkedContainerIds = new Set(documentManifest.state.linkedContainerIds);
  if (
    documentKekTargets.targets.length !== linkedContainerIds.size ||
    documentKekTargets.targets.some(
      (target) => !linkedContainerIds.has(target.containerId),
    )
  ) {
    throwVerification(
      "hash_mismatch",
      "verified document KEK targets do not cover the committed linked containers",
    );
  }

  requireWriteAccessThroughCommittedDocumentTarget({
    documentKekTargets,
    documentManifest,
    label: "write header",
    paths: authorization.authorizingContainerPaths,
    principalPolicies: authorization.principalPolicies ?? [],
    userId: header.writerUserId,
  });
}

function assertBlobWriteHeaderAuthorization(input: {
  readonly authorization: NonNullable<
    VerifyWriteHeaderInput["blobAuthorization"]
  >;
  readonly header: WriteHeader;
}): void {
  const { authorization, header } = input;
  const { blobKekTargets } = authorization;

  if (header.objectKind !== "blob") {
    throwVerification(
      "object_mismatch",
      "blob write authorization requires a blob write header",
    );
  }

  if (
    blobKekTargets.blobId !== header.objectId ||
    blobKekTargets.organizationId !== header.organizationId ||
    blobKekTargets.blobAccessManifestHash !== header.accessManifestHash
  ) {
    throwVerification(
      "object_mismatch",
      "write header does not match the committed blob access manifest",
    );
  }

  if (blobKekTargets.blobKeyTargetHash !== header.targetHash) {
    throwVerification(
      "hash_mismatch",
      "write header target hash does not match the verified blob KEK targets",
    );
  }

  if (
    blobKekTargets.activeBindingIds.length === 0 ||
    blobKekTargets.targets.length === 0
  ) {
    throwVerification(
      "missing_dependency",
      "verified blob KEK targets do not cover an active attachment binding",
    );
  }

  requireWriteAccessThroughCommittedBlobTarget({
    blobKekTargets,
    header,
    label: "write header",
    paths: authorization.authorizingContainerPaths,
    principalPolicies: authorization.principalPolicies ?? [],
  });
}

export function assertWriteHeaderAuthorizations(input: {
  readonly blobAuthorization: VerifyWriteHeaderInput["blobAuthorization"];
  readonly documentAuthorization: VerifyWriteHeaderInput["documentAuthorization"];
  readonly header: WriteHeader;
}): void {
  if (input.documentAuthorization) {
    assertDocumentWriteHeaderAuthorization({
      authorization: input.documentAuthorization,
      header: input.header,
    });
  }

  if (input.blobAuthorization) {
    assertBlobWriteHeaderAuthorization({
      authorization: input.blobAuthorization,
      header: input.header,
    });
  }
}
