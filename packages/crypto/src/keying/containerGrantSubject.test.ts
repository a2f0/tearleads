import { expect, test } from "bun:test";
import type { ContainerAccessManifestState } from "./index";
import { deriveContainerAccessManifest } from "./index";

test("container manifests reject organization grant subjects", async () => {
  await expect(
    deriveContainerAccessManifest({
      version: 1,
      containerId: "container-1",
      organizationId: "organization-1",
      epoch: 1,
      previousManifestHash: null,
      eventHash: "0".repeat(64),
      parentContainerId: null,
      parentManifestHash: null,
      metadataDocumentId: "metadata-1",
      containerKeyEpochId: "container-key-epoch-1",
      directGrants: [
        {
          subjectType: "organization",
          subjectId: "organization-1",
          accessLevel: "read",
        },
      ],
      referencedPrincipalHeads: [],
    } as unknown as ContainerAccessManifestState),
  ).rejects.toThrow("container direct grant.subjectType is unsupported");
});
