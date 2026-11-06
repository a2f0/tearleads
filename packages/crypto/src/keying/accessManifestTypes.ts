import type { AccessObjectKind, VerifiedAccessEvent } from "./accessEventTypes";
import { verifiedBrandValue } from "./keyingVerifiedBrand";
import type { ReferencedPrincipalHead } from "./principalPolicyTypes";

export interface AccessManifest {
  version: 1;
  objectKind: AccessObjectKind;
  objectId: string;
  organizationId: string;
  epoch: number;
  previousManifestHash: string | null;
  eventHash: string;
  structuralHash: string;
  grantRoot: string;
  referencedPrincipalHeads: ReferencedPrincipalHead[];
  keyTargetHash: string;
}

const verifiedAccessManifestBrand: unique symbol = Symbol(
  "verifiedAccessManifest",
);

export interface VerifiedAccessManifest {
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly checkpoint: AccessManifestCheckpoint;
  readonly [verifiedAccessManifestBrand]: true;
}

export function makeVerifiedAccessManifest(
  value: Omit<VerifiedAccessManifest, typeof verifiedAccessManifestBrand>,
): VerifiedAccessManifest {
  return {
    ...value,
    [verifiedAccessManifestBrand]: verifiedBrandValue,
  };
}

export interface AccessManifestCheckpoint {
  readonly objectKind: AccessObjectKind;
  readonly objectId: string;
  readonly organizationId: string;
  readonly epoch: number;
  readonly manifestHash: string;
}
