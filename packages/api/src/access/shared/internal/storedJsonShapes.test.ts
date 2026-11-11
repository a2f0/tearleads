import { describe, expect, test } from "bun:test";
import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { readCurrentCommitLsn } from "../../../documents/commitLsn";
import {
  isContainerDirectGrant,
  isReferencedPrincipalHead,
  readJsonArray,
} from "./accessManifestJson";
import { loadCurrentContainerManifestTargetClosure } from "./containerKekTargetClosure";
import { listDocumentContentWriteDependencyHashes } from "./contentWriteDependencies";
import { readStoredPrincipalContainerGrants } from "./principalStateRecords";

/** An executor whose every raw query answers `rows`. */
function rowsExecutor(rows: readonly unknown[]): DatabaseTransaction {
  const executor = { execute: async () => ({ rows }) };
  return executor as unknown as DatabaseTransaction;
}

async function rejection(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw error;
  }
  throw new Error("expected a rejection");
}

function head(): Record<string, unknown> {
  return {
    principalType: "group",
    principalId: "group-id",
    version: 1,
    keyEpoch: 1,
    stateHash: "state-hash",
    keyFingerprint: "key-fingerprint",
  };
}

describe("stored access manifest JSON lists", () => {
  test.each([
    ["a head", head(), true],
    [
      "empty strings and any number",
      { ...head(), principalId: "", version: -1.5, keyEpoch: Number.NaN },
      true,
    ],
    [
      "an organization head",
      { ...head(), principalType: "organization" },
      true,
    ],
    ["a user head", { ...head(), principalType: "user" }, false],
    ["a string version", { ...head(), version: "1" }, false],
    [
      "a missing key fingerprint",
      { ...head(), keyFingerprint: undefined },
      false,
    ],
    ["an array", [head()], false],
    ["null", null, false],
    ["a class instance", Object.assign(new (class Head {})(), head()), false],
  ])("isReferencedPrincipalHead: %s", (_name, value, accepted) => {
    expect(isReferencedPrincipalHead(value)).toBe(accepted);
  });

  test.each([
    [
      "a grant",
      { accessLevel: "read", subjectId: "", subjectType: "user" },
      true,
    ],
    [
      "an unknown level",
      { accessLevel: "owner", subjectId: "s", subjectType: "user" },
      false,
    ],
    [
      "an unknown subject type",
      { accessLevel: "read", subjectId: "s", subjectType: "device" },
      false,
    ],
    [
      "a numeric subject",
      { accessLevel: "read", subjectId: 1, subjectType: "user" },
      false,
    ],
    [
      "a class instance",
      Object.assign(new Date(0), {
        accessLevel: "read",
        subjectId: "s",
        subjectType: "user",
      }),
      false,
    ],
  ])("isContainerDirectGrant: %s", (_name, value, accepted) => {
    expect(isContainerDirectGrant(value)).toBe(accepted);
  });

  test("readJsonArray returns the stored items themselves", () => {
    const stored = [{ ...head(), extension: true }];
    const [item] = readJsonArray(stored, "heads", isReferencedPrincipalHead);
    expect<unknown>(item).toBe(stored[0]);
    expect(() => readJsonArray({}, "heads", isReferencedPrincipalHead)).toThrow(
      "heads is not an array",
    );
    expect(() =>
      readJsonArray([head(), {}], "heads", isReferencedPrincipalHead),
    ).toThrow("heads[1] is invalid");
  });
});

describe("readStoredPrincipalContainerGrants", () => {
  test.each([
    ["an object", {}, "Stored principal container grants are invalid"],
    ["null", null, "Stored principal container grants are invalid"],
    ["a null grant", [null], "Stored principal container grant is invalid"],
    ["an array grant", [[]], "Stored principal container grant is invalid"],
    [
      "an unknown level",
      [{ accessLevel: "owner", containerId: "c" }],
      "Stored principal container grant is invalid",
    ],
    [
      "a numeric container",
      [{ accessLevel: "read", containerId: 1 }],
      "Stored principal container grant is invalid",
    ],
  ])("rejects %s", async (_name, value, message) => {
    expect(
      await rejection(async () => readStoredPrincipalContainerGrants(value)),
    ).toBe(message);
  });

  test("rebuilds each grant as accessLevel then containerId", () => {
    const [grant] = readStoredPrincipalContainerGrants([
      { containerId: "", accessLevel: "admin", extension: 1 },
    ]);
    expect(Object.keys(grant ?? {})).toEqual(["accessLevel", "containerId"]);
    expect(grant).toEqual({ accessLevel: "admin", containerId: "" });
  });
});

function baseState(): Record<string, unknown> {
  return {
    version: 1,
    containerId: "container-id",
    containerKeyEpochId: "key-epoch-id",
    parentContainerId: null,
  };
}

function closureRow(): Record<string, unknown> {
  return {
    id: "container-id",
    manifestHash: "manifest-hash",
    objectKind: "container",
    objectId: "container-id",
    state: baseState(),
    depth: 0,
    cycleDetected: false,
  };
}

function closureState(state: unknown): Record<string, unknown> {
  return { ...closureRow(), state };
}

describe("loadCurrentContainerManifestTargetClosure stored rows", () => {
  const load = (rows: unknown[]) =>
    loadCurrentContainerManifestTargetClosure({
      containerIds: ["container-id"],
      executor: rowsExecutor(rows),
    });

  test.each([
    [
      "a null row",
      null,
      "Unexpected row shape from container ancestor KEK closure",
    ],
    [
      "a string cycle flag",
      { ...closureRow(), cycleDetected: "false" },
      "Unexpected row shape from container ancestor KEK closure",
    ],
    [
      "a numeric cycle flag",
      { ...closureRow(), cycleDetected: 0 },
      "Unexpected row shape from container ancestor KEK closure",
    ],
    [
      "a fractional depth",
      { ...closureRow(), depth: 0.5 },
      "Unexpected row shape from container ancestor KEK closure",
    ],
    [
      "an unsafe depth",
      { ...closureRow(), depth: 2 ** 60 },
      "Unexpected row shape from container ancestor KEK closure",
    ],
    [
      "a numeric manifest hash",
      { ...closureRow(), manifestHash: 1 },
      "Unexpected row shape from container ancestor KEK closure",
    ],
    [
      "a cycle",
      { ...closureRow(), cycleDetected: true },
      "Container parent cycle detected at container container-id",
    ],
    ["a null state", closureState(null), "Container manifest state is invalid"],
    ["an array state", closureState([]), "Container manifest state is invalid"],
    [
      "an empty state string",
      closureState(""),
      "Container manifest state is invalid",
    ],
    [
      "unparseable state text",
      closureState("{"),
      "Container manifest state is invalid",
    ],
    [
      "state text of an array",
      closureState("[]"),
      "Container manifest state is invalid",
    ],
    [
      "state version 2",
      closureState({ ...baseState(), version: 2 }),
      "Container manifest state mismatch",
    ],
    [
      "another container's state",
      closureState({ ...baseState(), containerId: "other" }),
      "Container manifest state mismatch",
    ],
    [
      "no key epoch",
      closureState({ ...baseState(), containerKeyEpochId: "" }),
      "Container manifest has no current KEK epoch",
    ],
    [
      "an empty parent",
      closureState({ ...baseState(), parentContainerId: "" }),
      "Container manifest parent is invalid",
    ],
    [
      "a missing parent",
      closureState({ ...baseState(), parentContainerId: undefined }),
      "Container manifest parent is invalid",
    ],
    [
      "a numeric parent",
      closureState({ ...baseState(), parentContainerId: 7 }),
      "Container manifest parent is invalid",
    ],
  ])("rejects %s", async (_name, row, message) => {
    expect(await rejection(() => load([row]))).toBe(message);
  });

  test("reads state stored as JSON text", async () => {
    const targets = await load([
      closureState(
        JSON.stringify({ ...baseState(), parentContainerId: "parent-id" }),
      ),
    ]);
    expect(targets.get("container-id")).toEqual({
      containerId: "container-id",
      containerManifestHash: "manifest-hash",
      containerKeyEpochId: "key-epoch-id",
      parentContainerId: "parent-id",
    });
  });
});

describe("raw query rows", () => {
  test("write dependency hashes must be strings and come back sorted", async () => {
    const list = (rows: unknown[]) =>
      listDocumentContentWriteDependencyHashes(
        "00000000-0000-4000-8000-000000000000",
        rowsExecutor(rows),
      );
    expect(await list([{ hash: "b" }, { hash: "a" }])).toEqual(["a", "b"]);
    expect(await rejection(() => list([{ hash: 1 }]))).toBe(
      "Invalid stored write dependency hash",
    );
    expect(await rejection(() => list([{}]))).toBe(
      "Invalid stored write dependency hash",
    );
  });

  test("the Postgres commit LSN must be a non-empty string", async () => {
    const read = (rows: unknown[]) => readCurrentCommitLsn(rowsExecutor(rows));
    expect(await read([{ commitLsn: "0/16B3748" }])).toBe("0/16B3748");
    for (const rows of [[], [null], [{ commitLsn: "" }], [{ commitLsn: 1 }]]) {
      expect(await rejection(() => read(rows))).toBe(
        "Failed to read current commit LSN.",
      );
    }
  });
});
