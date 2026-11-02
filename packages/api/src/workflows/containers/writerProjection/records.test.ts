import { describe, expect, test } from "bun:test";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { toVerifiedContainerManifest } from "./records";
import { ContainerWriterProjectionError } from "./types";

function rejection(read: () => unknown): { message: string; status: number } {
  try {
    read();
  } catch (error) {
    if (error instanceof ContainerWriterProjectionError) {
      return { message: error.message, status: error.status };
    }
    throw error;
  }
  throw new Error("expected the container manifest bundle to be rejected");
}

function groupHead(): Record<string, unknown> {
  return {
    principalType: "group",
    principalId: "group-id",
    version: 2,
    keyEpoch: 3,
    stateHash: "state-hash",
    keyFingerprint: "key-fingerprint",
  };
}

function manifest(): Record<string, unknown> {
  return {
    version: 1,
    objectKind: "container",
    objectId: "container-id",
    organizationId: "organization-id",
    epoch: 4,
    previousManifestHash: null,
    eventHash: "event-hash",
    structuralHash: "structural-hash",
    grantRoot: "grant-root",
    referencedPrincipalHeads: [groupHead()],
    keyTargetHash: "key-target-hash",
  };
}

function directGrant(): Record<string, unknown> {
  return { accessLevel: "write", subjectId: "user-id", subjectType: "user" };
}

function state(): Record<string, unknown> {
  return {
    systemSlot: null,
    version: 1,
    containerId: "container-id",
    organizationId: "organization-id",
    epoch: 4,
    previousManifestHash: null,
    eventHash: "event-hash",
    parentContainerId: null,
    parentManifestHash: null,
    metadataDocumentId: "metadata-document-id",
    containerKeyEpochId: "key-epoch-id",
    containerKeyPublicKey: "public-key",
    directGrants: [directGrant()],
    referencedPrincipalHeads: [groupHead()],
  };
}

function eventBundle(): Record<string, unknown> {
  return {
    event: {
      version: 1,
      eventId: "event-id",
      eventType: "container.grant",
      objectKind: "container",
      objectId: "container-id",
      organizationId: "organization-id",
      previousManifestHash: null,
      dependencyManifestHashes: [],
      bodyHash: "body-hash",
      signerUserId: "signer-user",
      signerDeviceId: "signer-device",
      signerKeyFingerprint: "signer-fingerprint",
      signedAt: "2026-01-01T00:00:00.000Z",
      signature: "signature",
    },
    body: { eventType: "container.grant" },
    eventHash: "event-hash",
  };
}

function bundle(
  overrides: Partial<Record<"event" | "manifest" | "state", unknown>> = {},
): AccessManifestBundleWireResponse {
  const value: Record<string, unknown> = {
    event: eventBundle(),
    manifest: manifest(),
    manifestHash: "manifest-hash",
    state: state(),
    ...overrides,
  };
  // The wire type only promises plain objects; the readers must not trust it.
  return Object.assign(Object.create(null), value);
}

const without = (base: Record<string, unknown>, key: string) => {
  const copy = { ...base };
  Reflect.deleteProperty(copy, key);
  return copy;
};

describe("toVerifiedContainerManifest", () => {
  const cases: [string, AccessManifestBundleWireResponse, string][] = [
    [
      "a non-object manifest",
      bundle({ manifest: [] }),
      "Container manifest is invalid",
    ],
    [
      "a document manifest",
      bundle({ manifest: { ...manifest(), objectKind: "document" } }),
      "Container manifest.objectKind must be container",
    ],
    [
      "an invalid manifest kind",
      bundle({ manifest: { ...manifest(), objectKind: "group" } }),
      "Container manifest.objectKind is invalid",
    ],
    [
      "a malformed document manifest",
      bundle({ manifest: { ...manifest(), objectKind: "document", epoch: 0 } }),
      "Container manifest.epoch is invalid",
    ],
    [
      "an organization head",
      bundle({
        manifest: {
          ...manifest(),
          referencedPrincipalHeads: [
            groupHead(),
            { ...groupHead(), principalType: "organization" },
          ],
        },
      }),
      "Container manifest.referencedPrincipalHeads may reference only group principals",
    ],
    [
      "a document manifest with organization heads",
      bundle({
        manifest: {
          ...manifest(),
          objectKind: "document",
          referencedPrincipalHeads: [
            { ...groupHead(), principalType: "organization" },
          ],
        },
      }),
      "Container manifest.objectKind must be container",
    ],
    [
      "a malformed manifest head",
      bundle({
        manifest: {
          ...manifest(),
          referencedPrincipalHeads: [{ ...groupHead(), principalType: "user" }],
        },
      }),
      "Container manifest.referencedPrincipalHeads[0].principalType is invalid",
    ],
    [
      "a non-object event bundle",
      bundle({ event: "event" }),
      "Container access event bundle is invalid",
    ],
    [
      "a malformed event",
      bundle({ event: { ...eventBundle(), event: { version: 1 } } }),
      "Container access event bundle.event.eventType is invalid",
    ],
    [
      "a non-object event",
      bundle({ event: { ...eventBundle(), event: null } }),
      "Container access event bundle.event is invalid",
    ],
    [
      "a non-canonical body",
      bundle({ event: { ...eventBundle(), body: { value: Number.NaN } } }),
      "Container access event bundle.body is invalid",
    ],
    [
      "a missing body",
      bundle({ event: without(eventBundle(), "body") }),
      "Container access event bundle.body is invalid",
    ],
    [
      "an empty event hash",
      bundle({ event: { ...eventBundle(), eventHash: "" } }),
      "Container access event bundle.eventHash is invalid",
    ],
    [
      "a bad body and event hash",
      bundle({ event: { ...eventBundle(), body: undefined, eventHash: "" } }),
      "Container access event bundle.body is invalid",
    ],
    [
      "a bad event and body",
      bundle({ event: { ...eventBundle(), event: [], body: undefined } }),
      "Container access event bundle.event is invalid",
    ],
    [
      "a non-object state",
      bundle({ state: null }),
      "Container manifest state is invalid",
    ],
    [
      "a state version 2",
      bundle({ state: { ...state(), version: 2 } }),
      "Container manifest state.version is invalid",
    ],
    [
      "a missing system slot",
      bundle({ state: without(state(), "systemSlot") }),
      "Container manifest state.systemSlot is invalid",
    ],
    [
      "a bad version and system slot",
      bundle({ state: { ...state(), version: 0, systemSlot: 1 } }),
      "Container manifest state.version is invalid",
    ],
    [
      "an empty container id",
      bundle({ state: { ...state(), containerId: "" } }),
      "Container manifest state.containerId is invalid",
    ],
    [
      "a zero state epoch",
      bundle({ state: { ...state(), epoch: 0 } }),
      "Container manifest state.epoch is invalid",
    ],
    [
      "a numeric parent",
      bundle({ state: { ...state(), parentContainerId: 1 } }),
      "Container manifest state.parentContainerId is invalid",
    ],
    [
      "a missing parent manifest hash",
      bundle({ state: without(state(), "parentManifestHash") }),
      "Container manifest state.parentManifestHash is invalid",
    ],
    [
      "an empty public key",
      bundle({ state: { ...state(), containerKeyPublicKey: "" } }),
      "Container manifest state.containerKeyPublicKey is invalid",
    ],
    [
      "object direct grants",
      bundle({ state: { ...state(), directGrants: {} } }),
      "Container manifest state.directGrants is invalid",
    ],
    [
      "a null direct grant",
      bundle({ state: { ...state(), directGrants: [directGrant(), null] } }),
      "Container manifest state.directGrants[1] is invalid",
    ],
    [
      "a bad access level",
      bundle({
        state: {
          ...state(),
          directGrants: [{ ...directGrant(), accessLevel: "owner" }],
        },
      }),
      "Container manifest state.directGrants[0].accessLevel is invalid",
    ],
    [
      "a bad subject type",
      bundle({
        state: {
          ...state(),
          directGrants: [{ ...directGrant(), subjectType: "device" }],
        },
      }),
      "Container manifest state.directGrants[0].subjectType is invalid",
    ],
    [
      "an empty subject id",
      bundle({
        state: {
          ...state(),
          directGrants: [{ ...directGrant(), subjectId: "" }],
        },
      }),
      "Container manifest state.directGrants[0].subjectId is invalid",
    ],
    [
      "a bad access level and subject type",
      bundle({
        state: {
          ...state(),
          directGrants: [{ ...directGrant(), accessLevel: 1, subjectType: 1 }],
        },
      }),
      "Container manifest state.directGrants[0].accessLevel is invalid",
    ],
    [
      "a bad subject type and id",
      bundle({
        state: {
          ...state(),
          directGrants: [{ ...directGrant(), subjectType: 1, subjectId: 1 }],
        },
      }),
      "Container manifest state.directGrants[0].subjectType is invalid",
    ],
    [
      "an organization state head",
      bundle({
        state: {
          ...state(),
          referencedPrincipalHeads: [
            { ...groupHead(), principalType: "organization" },
          ],
        },
      }),
      "Container manifest state.referencedPrincipalHeads may reference only group principals",
    ],
    [
      "a malformed state head",
      bundle({
        state: {
          ...state(),
          referencedPrincipalHeads: [{ ...groupHead(), version: 0 }],
        },
      }),
      "Container manifest state.referencedPrincipalHeads[0].version is invalid",
    ],
    [
      "a bad grants and heads",
      bundle({
        state: {
          ...state(),
          directGrants: null,
          referencedPrincipalHeads: null,
        },
      }),
      "Container manifest state.directGrants is invalid",
    ],
    [
      "a state for another container",
      bundle({ state: { ...state(), containerId: "other-container" } }),
      "Container manifest state mismatch",
    ],
    [
      "a state at another epoch",
      bundle({ state: { ...state(), epoch: 5 } }),
      "Container manifest state mismatch",
    ],
  ];

  test.each(cases)("rejects %s", (_name, value, message) => {
    expect(rejection(() => toVerifiedContainerManifest(value))).toEqual({
      message,
      status: 409,
    });
  });

  test("projects the stored bundle without unknown keys", () => {
    const body = { eventType: "container.grant", extension: [1] };
    const verified = toVerifiedContainerManifest(
      bundle({
        event: { ...eventBundle(), body, extension: true },
        state: {
          ...state(),
          extension: true,
          directGrants: [{ ...directGrant(), extension: true }],
        },
      }),
    );
    expect(Object.keys(verified.state)).toEqual(Object.keys(state()));
    expect(Object.keys(verified.state.directGrants[0] ?? {})).toEqual([
      "accessLevel",
      "subjectId",
      "subjectType",
    ]);
    expect<unknown>(verified.state).toEqual(state());
    expect(verified.event.eventHash).toBe("event-hash");
    // Signed material reaches verification as the stored value itself.
    expect<unknown>(verified.event.body).toBe(body);
    expect(verified.checkpoint).toEqual({
      objectKind: "container",
      objectId: "container-id",
      organizationId: "organization-id",
      epoch: 4,
      manifestHash: "manifest-hash",
    });
  });
});
