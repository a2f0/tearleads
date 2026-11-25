import type { VerifiedContainerAccessManifest } from "../containerAccess/containerAccessTypes";
import type { VerifiedDocumentLinkSetStateEvidence } from "../documentAccess/documentAccessTypes";
import type {
  AccessManifest,
  AccessManifestCheckpoint,
  VerifiedAccessManifest,
} from "./accessManifestTypes";

const verifiedAccessManifestSnapshotBrand: unique symbol = Symbol(
  "verifiedAccessManifestSnapshot",
);

export interface VerifiedAccessManifestSnapshot {
  readonly checkpoint: AccessManifestCheckpoint;
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
  readonly [verifiedAccessManifestSnapshotBrand]: true;
}

export type VerifiedAccessManifestCheckpointEvidence =
  | VerifiedAccessManifest
  | VerifiedAccessManifestSnapshot
  | VerifiedContainerAccessManifest
  | VerifiedDocumentLinkSetStateEvidence;

export function makeVerifiedAccessManifestSnapshot(
  value: Omit<
    VerifiedAccessManifestSnapshot,
    typeof verifiedAccessManifestSnapshotBrand
  >,
): VerifiedAccessManifestSnapshot {
  return {
    ...value,
    [verifiedAccessManifestSnapshotBrand]: true,
  };
}
