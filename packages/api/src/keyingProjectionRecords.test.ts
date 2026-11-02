import { describe, expect, test } from "bun:test";
import {
  readProjectionAccessEvent,
  readProjectionAccessManifest,
} from "./keyingProjectionRecords";

class ProjectionTestError extends Error {}

function projectionTestError(message: string): ProjectionTestError {
  return new ProjectionTestError(message);
}

function rejectionMessage(read: () => unknown): string {
  try {
    read();
  } catch (error) {
    if (error instanceof ProjectionTestError) {
      return error.message;
    }
    throw error;
  }
  throw new Error("expected the projection reader to reject");
}

function accessEvent(): Record<string, unknown> {
  return {
    version: 1,
    eventId: "event-id",
    eventType: "container.grant",
    objectKind: "container",
    objectId: "container-id",
    organizationId: "organization-id",
    previousManifestHash: null,
    dependencyManifestHashes: ["dependency-a", "dependency-b"],
    bodyHash: "body-hash",
    signerUserId: "signer-user",
    signerDeviceId: "signer-device",
    signerKeyFingerprint: "signer-fingerprint",
    signedAt: "2026-01-01T00:00:00.000Z",
    signature: "signature",
  };
}

function principalHead(): Record<string, unknown> {
  return {
    principalType: "group",
    principalId: "group-id",
    version: 2,
    keyEpoch: 3,
    stateHash: "state-hash",
    keyFingerprint: "key-fingerprint",
  };
}

function accessManifest(): Record<string, unknown> {
  return {
    version: 1,
    objectKind: "container",
    objectId: "container-id",
    organizationId: "organization-id",
    epoch: 4,
    previousManifestHash: "previous-hash",
    eventHash: "event-hash",
    structuralHash: "structural-hash",
    grantRoot: "grant-root",
    referencedPrincipalHeads: [principalHead()],
    keyTargetHash: "key-target-hash",
  };
}

function withField(
  base: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  return { ...base, [key]: value };
}

function withoutField(
  base: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const copy = { ...base };
  Reflect.deleteProperty(copy, key);
  return copy;
}

const notPlainObjects: readonly [string, unknown][] = [
  ["null", null],
  ["undefined", undefined],
  ["an array", []],
  ["a string", "event"],
  ["a number", 1],
  ["a date", new Date(0)],
  ["a class instance", new (class Event {})()],
];

describe("readProjectionAccessEvent", () => {
  const read = (value: unknown) =>
    readProjectionAccessEvent(value, "Event", projectionTestError);

  test.each(notPlainObjects)("rejects %s", (_name, value) => {
    expect(rejectionMessage(() => read(value))).toBe("Event is invalid");
  });

  const stringFields = [
    "eventId",
    "objectId",
    "organizationId",
    "bodyHash",
    "signerUserId",
    "signerDeviceId",
    "signerKeyFingerprint",
    "signedAt",
    "signature",
  ];
  const fieldCases: [string, Record<string, unknown>, string][] = [
    ...stringFields.flatMap(
      (key): [string, Record<string, unknown>, string][] => [
        [
          `missing ${key}`,
          withoutField(accessEvent(), key),
          `Event.${key} is invalid`,
        ],
        [
          `empty ${key}`,
          withField(accessEvent(), key, ""),
          `Event.${key} is invalid`,
        ],
        [
          `numeric ${key}`,
          withField(accessEvent(), key, 1),
          `Event.${key} is invalid`,
        ],
        [
          `null ${key}`,
          withField(accessEvent(), key, null),
          `Event.${key} is invalid`,
        ],
      ],
    ),
    [
      "unknown eventType",
      withField(accessEvent(), "eventType", "container.copy"),
      "Event.eventType is invalid",
    ],
    [
      "missing eventType",
      withoutField(accessEvent(), "eventType"),
      "Event.eventType is invalid",
    ],
    [
      "unknown objectKind",
      withField(accessEvent(), "objectKind", "group"),
      "Event.objectKind is invalid",
    ],
    [
      "version 2",
      withField(accessEvent(), "version", 2),
      "Event.version is invalid",
    ],
    [
      "version 0",
      withField(accessEvent(), "version", 0),
      "Event.version is invalid",
    ],
    [
      "fractional version",
      withField(accessEvent(), "version", 1.5),
      "Event.version is invalid",
    ],
    [
      "string version",
      withField(accessEvent(), "version", "1"),
      "Event.version is invalid",
    ],
    [
      "missing version",
      withoutField(accessEvent(), "version"),
      "Event.version is invalid",
    ],
    [
      "missing previousManifestHash",
      withoutField(accessEvent(), "previousManifestHash"),
      "Event.previousManifestHash is invalid",
    ],
    [
      "undefined previousManifestHash",
      withField(accessEvent(), "previousManifestHash", undefined),
      "Event.previousManifestHash is invalid",
    ],
    [
      "numeric previousManifestHash",
      withField(accessEvent(), "previousManifestHash", 1),
      "Event.previousManifestHash is invalid",
    ],
    [
      "string dependencies",
      withField(accessEvent(), "dependencyManifestHashes", "dependency"),
      "Event.dependencyManifestHashes is invalid",
    ],
    [
      "null dependencies",
      withField(accessEvent(), "dependencyManifestHashes", null),
      "Event.dependencyManifestHashes is invalid",
    ],
    [
      "numeric dependency entry",
      withField(accessEvent(), "dependencyManifestHashes", ["a", 2]),
      "Event.dependencyManifestHashes is invalid",
    ],
    [
      "missing dependencies",
      withoutField(accessEvent(), "dependencyManifestHashes"),
      "Event.dependencyManifestHashes is invalid",
    ],
    // The discriminators are checked before the fields that precede them.
    [
      "bad eventType and eventId",
      { ...accessEvent(), eventType: "x", eventId: "" },
      "Event.eventType is invalid",
    ],
    [
      "bad objectKind and version",
      { ...accessEvent(), objectKind: "x", version: 2 },
      "Event.objectKind is invalid",
    ],
    [
      "bad version and eventId",
      { ...accessEvent(), version: 2, eventId: "" },
      "Event.version is invalid",
    ],
    [
      "bad eventId and signature",
      { ...accessEvent(), eventId: "", signature: "" },
      "Event.eventId is invalid",
    ],
    [
      "bad dependencies and bodyHash",
      { ...accessEvent(), dependencyManifestHashes: [1], bodyHash: "" },
      "Event.dependencyManifestHashes is invalid",
    ],
    [
      "bad previous hash and dependencies",
      {
        ...accessEvent(),
        previousManifestHash: 1,
        dependencyManifestHashes: [1],
      },
      "Event.previousManifestHash is invalid",
    ],
  ];

  test.each(fieldCases)("rejects %s", (_name, value, message) => {
    expect(rejectionMessage(() => read(value))).toBe(message);
  });

  test("rebuilds the event in field order without unknown keys", () => {
    const stored = {
      ...accessEvent(),
      previousManifestHash: "",
      dependencyManifestHashes: [""],
      extension: "ignored",
    };
    const event = read(stored);
    expect(Object.keys(event)).toEqual([
      "version",
      "eventId",
      "eventType",
      "objectKind",
      "objectId",
      "organizationId",
      "previousManifestHash",
      "dependencyManifestHashes",
      "bodyHash",
      "signerUserId",
      "signerDeviceId",
      "signerKeyFingerprint",
      "signedAt",
      "signature",
    ]);
    expect<unknown>(event).toEqual(withoutField(stored, "extension"));
    expect(event.dependencyManifestHashes).not.toBe(
      stored.dependencyManifestHashes,
    );
  });

  test("accepts a null-prototype record", () => {
    const stored = Object.assign(Object.create(null), accessEvent());
    expect<unknown>(read(stored)).toEqual(accessEvent());
  });
});

describe("readProjectionAccessManifest", () => {
  const read = (value: unknown) =>
    readProjectionAccessManifest(value, "Manifest", projectionTestError);

  test.each(notPlainObjects)("rejects %s", (_name, value) => {
    expect(rejectionMessage(() => read(value))).toBe("Manifest is invalid");
  });

  const headWith = (key: string, value: unknown) =>
    withField(accessManifest(), "referencedPrincipalHeads", [
      principalHead(),
      withField(principalHead(), key, value),
    ]);
  const fieldCases: [string, Record<string, unknown>, string][] = [
    ...[
      "objectId",
      "organizationId",
      "eventHash",
      "structuralHash",
      "grantRoot",
      "keyTargetHash",
    ].flatMap((key): [string, Record<string, unknown>, string][] => [
      [
        `missing ${key}`,
        withoutField(accessManifest(), key),
        `Manifest.${key} is invalid`,
      ],
      [
        `empty ${key}`,
        withField(accessManifest(), key, ""),
        `Manifest.${key} is invalid`,
      ],
    ]),
    [
      "objectKind",
      withField(accessManifest(), "objectKind", "group"),
      "Manifest.objectKind is invalid",
    ],
    [
      "version 2",
      withField(accessManifest(), "version", 2),
      "Manifest.version is invalid",
    ],
    [
      "epoch 0",
      withField(accessManifest(), "epoch", 0),
      "Manifest.epoch is invalid",
    ],
    [
      "negative epoch",
      withField(accessManifest(), "epoch", -1),
      "Manifest.epoch is invalid",
    ],
    [
      "fractional epoch",
      withField(accessManifest(), "epoch", 1.5),
      "Manifest.epoch is invalid",
    ],
    [
      "string epoch",
      withField(accessManifest(), "epoch", "4"),
      "Manifest.epoch is invalid",
    ],
    [
      "infinite epoch",
      withField(accessManifest(), "epoch", Number.POSITIVE_INFINITY),
      "Manifest.epoch is invalid",
    ],
    [
      "NaN epoch",
      withField(accessManifest(), "epoch", Number.NaN),
      "Manifest.epoch is invalid",
    ],
    [
      "missing previous hash",
      withoutField(accessManifest(), "previousManifestHash"),
      "Manifest.previousManifestHash is invalid",
    ],
    [
      "object heads",
      withField(accessManifest(), "referencedPrincipalHeads", {}),
      "Manifest.referencedPrincipalHeads is invalid",
    ],
    [
      "null head",
      withField(accessManifest(), "referencedPrincipalHeads", [null]),
      "Manifest.referencedPrincipalHeads[0] is invalid",
    ],
    [
      "array head",
      withField(accessManifest(), "referencedPrincipalHeads", [
        principalHead(),
        [],
      ]),
      "Manifest.referencedPrincipalHeads[1] is invalid",
    ],
    [
      "user head",
      headWith("principalType", "user"),
      "Manifest.referencedPrincipalHeads[1].principalType is invalid",
    ],
    [
      "empty head id",
      headWith("principalId", ""),
      "Manifest.referencedPrincipalHeads[1].principalId is invalid",
    ],
    [
      "head version 0",
      headWith("version", 0),
      "Manifest.referencedPrincipalHeads[1].version is invalid",
    ],
    [
      "fractional key epoch",
      headWith("keyEpoch", 2.5),
      "Manifest.referencedPrincipalHeads[1].keyEpoch is invalid",
    ],
    [
      "missing state hash",
      withField(accessManifest(), "referencedPrincipalHeads", [
        withoutField(principalHead(), "stateHash"),
      ]),
      "Manifest.referencedPrincipalHeads[0].stateHash is invalid",
    ],
    [
      "empty key fingerprint",
      headWith("keyFingerprint", ""),
      "Manifest.referencedPrincipalHeads[1].keyFingerprint is invalid",
    ],
    [
      "bad objectKind and version",
      { ...accessManifest(), objectKind: "x", version: 2 },
      "Manifest.objectKind is invalid",
    ],
    [
      "bad version and objectId",
      { ...accessManifest(), version: 2, objectId: "" },
      "Manifest.version is invalid",
    ],
    [
      "bad epoch and heads",
      { ...accessManifest(), epoch: 0, referencedPrincipalHeads: null },
      "Manifest.epoch is invalid",
    ],
    [
      "bad heads and key target",
      {
        ...accessManifest(),
        referencedPrincipalHeads: null,
        keyTargetHash: "",
      },
      "Manifest.referencedPrincipalHeads is invalid",
    ],
    [
      "bad head type and id",
      headWith("principalType", "x"),
      "Manifest.referencedPrincipalHeads[1].principalType is invalid",
    ],
  ];

  test.each(fieldCases)("rejects %s", (_name, value, message) => {
    expect(rejectionMessage(() => read(value))).toBe(message);
  });

  test("keeps unsafe integer epochs the old reader accepted", () => {
    const epoch = 2 ** 60;
    expect(read(withField(accessManifest(), "epoch", epoch)).epoch).toBe(epoch);
  });

  test("rebuilds the manifest in field order without unknown keys", () => {
    const stored = {
      ...accessManifest(),
      previousManifestHash: null,
      referencedPrincipalHeads: [
        { ...principalHead(), principalType: "organization", extension: 1 },
      ],
      extension: "ignored",
    };
    const manifest = read(stored);
    expect(Object.keys(manifest)).toEqual([
      "version",
      "objectKind",
      "objectId",
      "organizationId",
      "epoch",
      "previousManifestHash",
      "eventHash",
      "structuralHash",
      "grantRoot",
      "referencedPrincipalHeads",
      "keyTargetHash",
    ]);
    expect(Object.keys(manifest.referencedPrincipalHeads[0] ?? {})).toEqual([
      "principalType",
      "principalId",
      "version",
      "keyEpoch",
      "stateHash",
      "keyFingerprint",
    ]);
    expect<unknown>(manifest).toEqual({
      ...withoutField(stored, "extension"),
      referencedPrincipalHeads: [
        { ...principalHead(), principalType: "organization" },
      ],
    });
  });
});
