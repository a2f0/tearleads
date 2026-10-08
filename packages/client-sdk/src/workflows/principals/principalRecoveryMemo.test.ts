import { beforeAll, expect, test } from "bun:test";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import {
  createPrincipalRecoveryReader,
  type PrincipalRecoveryMemo,
} from "./principalRecoveryMemo";
import { recoverScopedPrincipalPolicyHistory } from "./recoverScopedPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

test("online directory and Admins recovery cannot reuse an offline batch entry", async () => {
  const f = await createAuthorityRecoveryFixture(history);
  try {
    await recoverScopedPrincipalPolicyHistory(f.options);
    const memo: PrincipalRecoveryMemo = {
      directories: new Map(),
      admins: new Map(),
    };
    const offline = createPrincipalRecoveryReader(
      { ...f.options, offline: true },
      memo,
    );
    const before = f.requests.length;
    await offline.directory([]);
    await offline.admins(principalPolicyHead(history.admin));
    expect(f.requests).toHaveLength(before);
    const online = createPrincipalRecoveryReader(
      { ...f.options, offline: false },
      memo,
    );
    await online.directory([]);
    expect(f.requests.length).toBeGreaterThan(before);
    const directoryReads = f.requests.length;
    await online.admins(principalPolicyHead(history.admin));
    expect(f.requests.length).toBeGreaterThan(directoryReads);
  } finally {
    f.close();
  }
});

test("a failed batch recovery can retry after the transport recovers", async () => {
  const f = await createAuthorityRecoveryFixture(history);
  try {
    const memo: PrincipalRecoveryMemo = {
      directories: new Map(),
      admins: new Map(),
    };
    const reader = createPrincipalRecoveryReader(f.options, memo);
    f.controls.failureStatus = 503;
    await expect(reader.directory([])).rejects.toMatchObject({
      name: "PrincipalPolicyHistoryReadError",
    });
    delete f.controls.failureStatus;
    expect((await reader.directory([])).policy.principalId).toBe(
      history.organizationId,
    );
  } finally {
    f.close();
  }
});

test("a directory batch shares selected evidence without dropping its original lease", async () => {
  const f = await createAuthorityRecoveryFixture(history);
  try {
    const memo: PrincipalRecoveryMemo = {
      directories: new Map(),
      admins: new Map(),
    };
    let originalCurrent = true;
    const original = createPrincipalRecoveryReader(
      { ...f.options, stillCurrent: () => originalCurrent },
      memo,
    );
    const first = await original.directory([
      principalPolicyHead(history.directory),
    ]);
    const count = f.requests.length;
    const later = createPrincipalRecoveryReader(
      { ...f.options, stillCurrent: () => true },
      memo,
    );
    expect((await later.directory([])).policy.stateHash).toBe(
      first.policy.stateHash,
    );
    expect(f.requests).toHaveLength(count);
    originalCurrent = false;
    await expect(later.directory([])).rejects.toThrow("generation expired");
    expect(f.requests).toHaveLength(count);
  } finally {
    f.close();
  }
});

test("additional Admins citations reuse local proofs and keep the source lease", async () => {
  const f = await createAuthorityRecoveryFixture(history);
  try {
    const memo: PrincipalRecoveryMemo = {
      directories: new Map(),
      admins: new Map(),
    };
    const head = principalPolicyHead(history.admin);
    const firstEntry = history.admin.previousStates[0];
    if (!firstEntry) throw new Error("Missing Admins genesis");
    const genesis = principalPolicyHead({
      ...history.admin,
      currentState: firstEntry.state,
    });
    let sourceCurrent = true;
    const source = createPrincipalRecoveryReader(
      { ...f.options, stillCurrent: () => sourceCurrent },
      memo,
    );
    await source.admins(head, [head]);
    const count = f.requests.length;
    // A redundant HTTP read would fail; only the authenticated local proof works.
    f.controls.failureStatus = 503;
    const later = createPrincipalRecoveryReader(f.options, memo);
    const selected = await later.admins(head, [genesis]);
    expect(
      selected.policy.retainedHistory.map((entry) => entry.state.version),
    ).toEqual([1, 66]);
    expect(f.requests).toHaveLength(count);
    sourceCurrent = false;
    await expect(later.admins(head, [genesis])).rejects.toThrow(
      "generation expired",
    );
    await expect(later.admins(head)).rejects.toThrow("generation expired");
    expect(f.requests).toHaveLength(count);
  } finally {
    f.close();
  }
});

test("additional directory citations keep the verified view and its source lease", async () => {
  const f = await createAuthorityRecoveryFixture(history);
  try {
    const memo: PrincipalRecoveryMemo = {
      directories: new Map(),
      admins: new Map(),
    };
    let sourceCurrent = true;
    const source = createPrincipalRecoveryReader(
      { ...f.options, stillCurrent: () => sourceCurrent },
      memo,
    );
    const first = await source.directory([]);
    const entry = history.directory.previousStates[31];
    if (!entry) throw new Error("Missing directory predecessor");
    const reference = principalPolicyHead({
      ...history.directory,
      currentState: entry.state,
    });
    // Another batch can advance the private prefix while this view is in use.
    const advanced = await history.extend(history.directory, 67);
    f.policies.set(history.organizationId, advanced);
    const fresh = await createPrincipalRecoveryReader(f.options).directory([]);
    expect(fresh.policy.version).toBe(67);
    const count = f.requests.length;
    f.controls.failureStatus = 503;
    const later = createPrincipalRecoveryReader(f.options, memo);
    const selected = await later.directory([reference]);
    expect(selected.policy.stateHash).toBe(first.policy.stateHash);
    expect(
      selected.policy.retainedHistory.map((value) => value.state.version),
    ).toEqual([1, 32, 66]);
    expect(f.requests).toHaveLength(count);
    sourceCurrent = false;
    await expect(later.directory([reference])).rejects.toThrow(
      "generation expired",
    );
    await expect(later.directory([])).rejects.toThrow("generation expired");
    expect(f.requests).toHaveLength(count);
  } finally {
    f.close();
  }
});

test("a directory memo still authenticates an added historical citation", async () => {
  const f = await createAuthorityRecoveryFixture(history);
  try {
    const reader = createPrincipalRecoveryReader(f.options, {
      directories: new Map(),
      admins: new Map(),
    });
    await reader.directory([]);
    const entry = history.directory.previousStates[31];
    if (!entry) throw new Error("Missing directory predecessor");
    const reference = principalPolicyHead({
      ...history.directory,
      currentState: entry.state,
    });
    const count = f.requests.length;
    f.controls.failureStatus = 503;
    await expect(
      reader.directory([{ ...reference, stateHash: "0".repeat(64) }]),
    ).rejects.toMatchObject({ code: "object_mismatch" });
    expect((await reader.directory([reference])).policy.version).toBe(66);
    expect(f.requests).toHaveLength(count);
  } finally {
    f.close();
  }
});
