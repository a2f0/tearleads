import { expect, test } from "bun:test";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import {
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  verifyContainerAccessManifest,
} from "./index";
import {
  createContainerManifestFixture,
  createVerifiedContainerAccessEvent,
} from "./testFixtures";

test.each(["independent", "child", "foreign-slot"] as const)(
  "organization metadata topology: %s",
  async (kind) => {
    const signer = generateSigningSeedAndKeyPair();
    const parent = await createContainerManifestFixture({
      containerId: "parent",
      signer,
      signerUserId: "owner",
      directGrants: [
        { subjectType: "user", subjectId: "owner", accessLevel: "admin" },
      ],
    });
    const body = {
      eventType: "container.create" as const,
      systemSlot: await deriveOrganizationMetadataContainerSystemSlot({
        organizationId:
          kind === "foreign-slot"
            ? "other-organization"
            : parent.state.organizationId,
      }),
      containerKeyEpochId: "metadata-key",
      metadataDocumentId: "metadata",
      parentContainerId: kind === "child" ? parent.state.containerId : null,
      parentManifestHash: kind === "child" ? parent.manifestHash : null,
      directGrants: [
        {
          subjectType: "user" as const,
          subjectId: "owner",
          accessLevel: "admin" as const,
        },
      ],
      referencedPrincipalHeads: [],
    };
    const event = await createVerifiedContainerAccessEvent({
      body,
      objectId: "metadata-root",
      organizationId: parent.state.organizationId,
      previousManifestHash: null,
      signer,
      signerUserId: "owner",
    });
    const { eventType: _eventType, ...fields } = body;
    const manifest = await deriveContainerAccessManifest({
      ...fields,
      version: 1,
      containerId: "metadata-root",
      organizationId: parent.state.organizationId,
      epoch: 1,
      previousManifestHash: null,
      eventHash: event.eventHash,
    });
    const result = await verifyContainerAccessManifest({
      event,
      manifest,
      expectedManifestHash: await computeAccessManifestHash(manifest),
      parentContainerPath: kind === "child" ? [parent] : [],
    });
    expect(result.ok).toBe(kind === "independent");
    if (!result.ok) expect(result.error.code).toBe("invalid_shape");
  },
);
