import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { readProjectionAccessManifest } from "../../keyingProjectionRecords";
import { PrincipalPolicyError } from "./shared";

export function projectionPolicyReferences(
  bundles: readonly AccessManifestBundleWireResponse[],
  organizationId: string,
): ReferencedPrincipalHead[] {
  const references: ReferencedPrincipalHead[] = [];
  for (const bundle of bundles) {
    const manifest = readProjectionAccessManifest(
      bundle.manifest,
      "Projection policy evidence manifest",
      (message) => new PrincipalPolicyError(message, 409),
    );
    if (manifest.organizationId !== organizationId)
      throw new PrincipalPolicyError(
        "Projection policy organization mismatch",
        409,
      );
    references.push(...manifest.referencedPrincipalHeads);
  }
  return references;
}
