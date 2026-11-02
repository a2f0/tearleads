import { describe, expect, test } from "bun:test";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import { ContainerMutationError } from "../errors";
import {
  readContainerKeyEpoch,
  readContainerKeyWraps,
  userRecipientKeysFromRequest,
} from "./containerKekRecords";

function rejection(read: () => unknown): string {
  try {
    read();
  } catch (error) {
    if (error instanceof ContainerMutationError && error.status === 400) {
      return error.message;
    }
    throw error;
  }
  throw new Error("expected the reader to reject");
}

const without = (base: Record<string, unknown>, key: string) => {
  const copy = { ...base };
  Reflect.deleteProperty(copy, key);
  return copy;
};

function keyEpoch(): Record<string, unknown> {
  return {
    id: "key-epoch-id",
    containerId: "container-id",
    keyEpoch: 3,
    accessManifestHash: "access-manifest-hash",
    parentContainerKeyEpochId: null,
    createdByEventHash: "event-hash",
    createdByManifestHash: "manifest-hash",
  };
}

function keyWrap(): Record<string, unknown> {
  return {
    containerKeyEpochId: "key-epoch-id",
    recipientKind: "user",
    recipientId: "user-id",
    recipientKeyEpochId: "recipient-key-epoch-id",
    recipientKeyFingerprint: "recipient-fingerprint",
    kemCipherText: "kem-cipher-text",
    wrappedKey: "wrapped-key",
    wrapManifestHash: "wrap-manifest-hash",
  };
}

describe("readContainerKeyEpoch", () => {
  const cases: [string, unknown, string][] = [
    ["null", null, "Epoch is invalid"],
    ["an array", [keyEpoch()], "Epoch is invalid"],
    ["an empty id", { ...keyEpoch(), id: "" }, "Epoch.id is invalid"],
    [
      "a missing container id",
      without(keyEpoch(), "containerId"),
      "Epoch.containerId is invalid",
    ],
    [
      "a zero key epoch",
      { ...keyEpoch(), keyEpoch: 0 },
      "Epoch.keyEpoch is invalid",
    ],
    [
      "a fractional key epoch",
      { ...keyEpoch(), keyEpoch: 2.5 },
      "Epoch.keyEpoch is invalid",
    ],
    [
      "an empty manifest hash",
      { ...keyEpoch(), accessManifestHash: "" },
      "Epoch.accessManifestHash is invalid",
    ],
    [
      "a missing parent epoch",
      without(keyEpoch(), "parentContainerKeyEpochId"),
      "Epoch.parentContainerKeyEpochId is invalid",
    ],
    [
      "a numeric parent epoch",
      { ...keyEpoch(), parentContainerKeyEpochId: 1 },
      "Epoch.parentContainerKeyEpochId is invalid",
    ],
    [
      "an empty event hash",
      { ...keyEpoch(), createdByEventHash: "" },
      "Epoch.createdByEventHash is invalid",
    ],
    [
      "an empty created manifest",
      { ...keyEpoch(), createdByManifestHash: "" },
      "Epoch.createdByManifestHash is invalid",
    ],
    [
      "a bad id and epoch",
      { ...keyEpoch(), id: "", keyEpoch: 0 },
      "Epoch.id is invalid",
    ],
    [
      "a bad epoch and parent",
      { ...keyEpoch(), keyEpoch: 0, parentContainerKeyEpochId: 1 },
      "Epoch.keyEpoch is invalid",
    ],
  ];

  test.each(cases)("rejects %s", (_name, value, message) => {
    expect(rejection(() => readContainerKeyEpoch(value, "Epoch"))).toBe(
      message,
    );
  });

  test("keeps an empty parent epoch id and drops unknown keys", () => {
    const epoch = readContainerKeyEpoch(
      { ...keyEpoch(), parentContainerKeyEpochId: "", extension: true },
      "Epoch",
    );
    expect(Object.keys(epoch)).toEqual(Object.keys(keyEpoch()));
    expect<unknown>(epoch).toEqual({
      ...keyEpoch(),
      parentContainerKeyEpochId: "",
    });
  });
});

describe("readContainerKeyWraps", () => {
  const cases: [string, unknown, string][] = [
    ["an object", keyWrap(), "Wraps is invalid"],
    ["a null entry", [keyWrap(), null], "Wraps[1] is invalid"],
    [
      "an unknown recipient kind",
      [{ ...keyWrap(), recipientKind: "device" }],
      "Wraps[0].recipientKind is invalid",
    ],
    [
      "a bad kind and epoch id",
      [{ ...keyWrap(), recipientKind: 1, containerKeyEpochId: "" }],
      "Wraps[0].recipientKind is invalid",
    ],
    ...Object.keys(keyWrap())
      .filter((key) => key !== "recipientKind")
      .map((key): [string, unknown, string] => [
        `an empty ${key}`,
        [{ ...keyWrap(), [key]: "" }],
        `Wraps[0].${key} is invalid`,
      ]),
    [
      "a bad epoch id and recipient",
      [{ ...keyWrap(), containerKeyEpochId: "", recipientId: "" }],
      "Wraps[0].containerKeyEpochId is invalid",
    ],
  ];

  test.each(cases)("rejects %s", (_name, value, message) => {
    expect(rejection(() => readContainerKeyWraps(value, "Wraps"))).toBe(
      message,
    );
  });

  test("keeps the wrap field order and drops unknown keys", () => {
    const [wrap] = readContainerKeyWraps(
      [{ ...keyWrap(), recipientKind: "group", extension: true }],
      "Wraps",
    );
    expect(Object.keys(wrap ?? {})).toEqual(Object.keys(keyWrap()));
    expect<unknown>(wrap).toEqual({ ...keyWrap(), recipientKind: "group" });
  });
});

describe("userRecipientKeysFromRequest", () => {
  const request = (userRecipientKeys: unknown[]) =>
    ({ userRecipientKeys }) as unknown as ContainerMutationRequest;
  const key = () => ({
    userId: "user-id",
    recipientKeyEpochId: "recipient-key-epoch-id",
    recipientKeyFingerprint: "recipient-fingerprint",
  });

  test.each([
    ["a null key", [key(), null], "userRecipientKeys[1] is invalid"],
    [
      "an empty user id",
      [{ ...key(), userId: "" }],
      "userRecipientKeys[0].userId is invalid",
    ],
    [
      "a missing epoch id",
      [without(key(), "recipientKeyEpochId")],
      "userRecipientKeys[0].recipientKeyEpochId is invalid",
    ],
    [
      "a numeric fingerprint",
      [{ ...key(), recipientKeyFingerprint: 1 }],
      "userRecipientKeys[0].recipientKeyFingerprint is invalid",
    ],
  ])("rejects %s", (_name, keys, message) => {
    expect(rejection(() => userRecipientKeysFromRequest(request(keys)))).toBe(
      message,
    );
  });

  test("reads keys in order and treats an absent list as empty", () => {
    expect(
      userRecipientKeysFromRequest(request([{ ...key(), extension: 1 }])),
    ).toEqual([key()]);
    expect(
      userRecipientKeysFromRequest({} as unknown as ContainerMutationRequest),
    ).toEqual([]);
  });
});
