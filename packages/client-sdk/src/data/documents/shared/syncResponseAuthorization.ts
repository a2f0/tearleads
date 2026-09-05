import {
  computeDocumentContentKeyTargetHash,
  type DocumentContentKeyTarget,
  makeVerifiedDocumentKekTargets,
} from "@tearleads/crypto";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { sortDocumentTargets, targetEnvelopeReference } from "./readers";
import type { DocumentSyncPlan } from "./types";

export async function documentWriteAuthorizationForHeader(input: {
  readonly allowMissingAuthorization: boolean;
  readonly authorizationTargets?:
    | readonly DocumentContentKeyTarget[]
    | undefined;
  readonly contentKeyBundle: DocumentSyncResponse["contentKeyBundle"];
  readonly manifestHash: string;
  readonly plan: Pick<
    DocumentSyncPlan,
    "documentId" | "organizationId" | "documentWriterAuthorization"
  >;
  readonly targetHash: string;
}) {
  const source = input.plan.documentWriterAuthorization;
  if (!source) {
    if (input.allowMissingAuthorization) {
      return null;
    }
    throw new Error(
      "Document sync response lacks verified writer-authorization material",
    );
  }
  const documentManifest = source.documentManifestByHash.get(
    input.manifestHash,
  );
  if (!documentManifest) {
    throw new Error(
      "Document sync response write manifest is not in verified history",
    );
  }
  if (input.contentKeyBundle.documentId !== input.plan.documentId) {
    throw new Error(
      "Document sync response content-key bundle belongs to another document",
    );
  }

  const contentBundleTargets = input.contentKeyBundle.targets.map(
    targetEnvelopeReference,
  );
  const targets = sortDocumentTargets(
    input.authorizationTargets ?? contentBundleTargets,
  );
  // Legacy rows can be proven only while their still-served bundle exactly
  // matches the header. Once targets advance, accepting reconstructed current
  // evidence would authorize a historical write by server assertion, so the
  // compatibility path deliberately fails closed.
  if (
    (await computeDocumentContentKeyTargetHash(targets)) !== input.targetHash
  ) {
    throw new Error(
      input.authorizationTargets
        ? "Document sync response write targets are not canonical"
        : "Document sync response lacks exact historical writer-authorization targets",
    );
  }
  const linkedContainerIds = new Set(documentManifest.state.linkedContainerIds);
  if (
    targets.length !== linkedContainerIds.size ||
    targets.some((target) => !linkedContainerIds.has(target.containerId))
  ) {
    throw new Error(
      "Document sync response write targets do not match the signed link set",
    );
  }

  const authorizingContainerPaths = targets.map((target) => {
    const path = source.containerPathByManifestHash.get(
      target.containerManifestHash,
    );
    const leaf = path?.at(-1);
    if (
      !path ||
      !leaf ||
      leaf.state.containerId !== target.containerId ||
      leaf.state.organizationId !== input.plan.organizationId ||
      leaf.state.containerKeyEpochId !== target.containerKeyEpochId
    ) {
      throw new Error(
        "Document sync response write target lacks a verified container path",
      );
    }
    return path;
  });
  const documentKekTargets = makeVerifiedDocumentKekTargets({
    documentId: input.contentKeyBundle.documentId,
    documentKeyTargetHash: input.targetHash,
    linkedContainerKeyEpochIds: targets.map(
      (target) => target.containerKeyEpochId,
    ),
    linkedContainerManifestHashes: targets.map(
      (target) => target.containerManifestHash,
    ),
    linkSetManifestHash: input.manifestHash,
    targets,
  });
  return {
    authorizingContainerPaths,
    documentKekTargets,
    documentManifest,
    principalPolicies: source.principalPolicies,
  };
}
