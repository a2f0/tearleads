import { expect, test } from "bun:test";
import type {
  ContainerAccessManifestState,
  ContainerRekeyAccessEventBody,
  ReferencedPrincipalHead,
} from "@tearleads/crypto";
import { rekeyReferencedPrincipalHeads } from "./createContainerMutationResponseFromRequest";

function head(principalId: string): ReferencedPrincipalHead {
  return {
    principalType: "group",
    principalId,
    version: 1,
    keyEpoch: 1,
    stateHash: `state-${principalId}`,
    keyFingerprint: `fingerprint-${principalId}`,
  };
}

function rekeyBody(
  referencedPrincipalHeads?: ReferencedPrincipalHead[],
): ContainerRekeyAccessEventBody {
  return {
    eventType: "container.rekey",
    containerKeyEpochId: "epoch-2",
    keyringHash: "keyring-hash",
    predecessorBridgeHash: "bridge-hash",
    ...(referencedPrincipalHeads ? { referencedPrincipalHeads } : {}),
  };
}

function previousState(
  referencedPrincipalHeads: ReferencedPrincipalHead[],
): ContainerAccessManifestState {
  return {
    version: 1,
    containerId: "container-1",
    organizationId: "organization-1",
    epoch: 3,
    previousManifestHash: "previous-hash",
    eventHash: "event-hash",
    containerKeyEpochId: "epoch-1",
    metadataDocumentId: "metadata-1",
    parentContainerId: null,
    parentManifestHash: null,
    directGrants: [],
    referencedPrincipalHeads,
  };
}

test("a rekey without heads carries the previous heads forward", () => {
  const previousHeads = [head("group-a"), head("group-b")];

  const resolved = rekeyReferencedPrincipalHeads(
    rekeyBody(),
    previousState(previousHeads),
  );

  expect(resolved).toEqual(previousHeads);
});

test("an explicit empty head list is authoritative", () => {
  const resolved = rekeyReferencedPrincipalHeads(
    rekeyBody([]),
    previousState([head("group-a")]),
  );

  expect(resolved).toEqual([]);
});

test("provided heads replace the previous heads", () => {
  const providedHeads = [head("group-c")];

  const resolved = rekeyReferencedPrincipalHeads(
    rekeyBody(providedHeads),
    previousState([head("group-a")]),
  );

  expect(resolved).toEqual(providedHeads);
});
