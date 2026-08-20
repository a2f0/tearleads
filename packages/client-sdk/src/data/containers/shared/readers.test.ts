import { expect, test } from "bun:test";
import { readContainerAccessManifestState } from "./readers";

test("container state rejects organization principal heads", () => {
  expect(() =>
    readContainerAccessManifestState(
      {
        version: 1,
        containerId: "container-1",
        organizationId: "organization-1",
        epoch: 1,
        previousManifestHash: null,
        eventHash: "event-hash-1",
        parentContainerId: null,
        parentManifestHash: null,
        metadataDocumentId: "metadata-document-1",
        containerKeyEpochId: "container-key-epoch-1",
        directGrants: [
          {
            accessLevel: "read",
            subjectId: "organization-1",
            subjectType: "group",
          },
        ],
        referencedPrincipalHeads: [
          {
            principalType: "organization",
            principalId: "organization-1",
            version: 1,
            keyEpoch: 1,
            stateHash: "state-hash-1",
            keyFingerprint: "key-fingerprint-1",
          },
        ],
      },
      "Container state",
    ),
  ).toThrow(
    "Container state.referencedPrincipalHeads[0].principalType is invalid",
  );
});
