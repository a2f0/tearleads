import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { computeAccessManifestHash } from "./accessEvent";
import {
  deriveContainerAccessManifest,
  verifyContainerAccessManifest,
} from "./containerAccess";
import {
  createContainerManifestFixture,
  createPrincipalPolicyFixture,
  createVerifiedContainerAccessEvent,
  fixtureHash,
} from "./testFixtures";
import type {
  ContainerAccessEventBody,
  ContainerGrantPrincipalHead,
} from "./types";

for (const eventType of ["container.grant", "container.rekey"] as const) {
  for (const change of [
    "older-version",
    "same-version-fork",
    "older-key",
    "same",
    "newer",
  ] as const) {
    test(`${eventType} principal reference progress: ${change}`, async () => {
      const signer = generateSigningSeedAndKeyPair();
      const current: ContainerGrantPrincipalHead = {
        principalType: "group",
        principalId: "group",
        version: 2,
        keyEpoch: 2,
        stateHash: await fixtureHash("state-2"),
        keyFingerprint: await fixtureHash("key-2"),
      };
      const next = {
        ...current,
        version:
          change === "older-version"
            ? 1
            : change === "older-key" || change === "newer"
              ? 3
              : 2,
        keyEpoch:
          change === "older-version" || change === "older-key"
            ? 1
            : change === "newer"
              ? 3
              : 2,
        stateHash:
          change === "same" ? current.stateHash : await fixtureHash(change),
      };
      const grant = {
        subjectType: "group" as const,
        subjectId: current.principalId,
        accessLevel: "read" as const,
      };
      const previous = await createContainerManifestFixture({
        containerId: "container",
        containerKeyEpochId: "key-2",
        directGrants: [
          grant,
          { subjectType: "user", subjectId: "writer", accessLevel: "admin" },
        ],
        referencedPrincipalHeads: [current],
        signer,
        signerUserId: "writer",
      });
      const containerKeyEpochId =
        eventType === "container.grant"
          ? previous.state.containerKeyEpochId
          : "key-3";
      const body: ContainerAccessEventBody =
        eventType === "container.grant"
          ? {
              eventType,
              containerKeyEpochId,
              grant,
              referencedPrincipalHead: next,
            }
          : {
              eventType,
              containerKeyEpochId: "key-3",
              referencedPrincipalHeads: [next],
              keyringHash: await fixtureHash("keyring"),
              predecessorBridgeHash: await fixtureHash("bridge"),
            };
      const event = await createVerifiedContainerAccessEvent({
        body,
        objectId: previous.state.containerId,
        organizationId: previous.state.organizationId,
        previousManifestHash: previous.manifestHash,
        signer,
        signerUserId: "writer",
      });
      const manifest = await deriveContainerAccessManifest({
        ...previous.state,
        containerKeyEpochId,
        epoch: previous.state.epoch + 1,
        eventHash: event.eventHash,
        previousManifestHash: previous.manifestHash,
        referencedPrincipalHeads: [next],
      });
      const result = await verifyContainerAccessManifest({
        event,
        expectedManifestHash: await computeAccessManifestHash(manifest),
        manifest,
        previousManifest: previous,
        previousContainerPath: [previous],
        principalPolicies: [createPrincipalPolicyFixture(current)],
      });
      if (change === "same" || change === "newer")
        expect(result.ok, result.ok ? "accepted" : result.error.message).toBe(
          true,
        );
      else
        expect(result).toMatchObject({
          ok: false,
          error: {
            code: change === "same-version-fork" ? "equivocation" : "rollback",
          },
        });
    });
  }
}
