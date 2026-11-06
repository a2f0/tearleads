import type {
  AccessManifest,
  AccessManifestCheckpoint,
  VerifiedAccessManifest,
} from "./accessManifestTypes";
import type { VerifiedContainerAccessManifest } from "./containerAccessTypes";
import type { VerifiedDocumentLinkSetStateEvidence } from "./documentAccessTypes";

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
