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
    // Online discovery still reads the server-current directory head.
    expect(f.requests.length).toBeGreaterThan(before);
    await online.admins(principalPolicyHead(history.admin));
    // Completed Admins evidence needs no read, but never reuses the offline entry.
    expect(memo.directories.size).toBe(2);
    expect(memo.admins.size).toBe(2);
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

test("an operation shares selected evidence but never serves an expired lease", async () => {
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
    // The expired entry is evicted; the live caller rediscovers under its own
    // lease, which this unavailable server refuses.
    f.controls.failureStatus = 503;
    await expect(later.directory([])).rejects.toMatchObject({
      name: "PrincipalPolicyHistoryReadError",
    });
    delete f.controls.failureStatus;
    expect((await later.directory([])).policy.stateHash).toBe(
      first.policy.stateHash,
    );
    expect(f.requests).toHaveLength(count + 1);
  } finally {
    f.close();
  }
});

test("additional Admins citations reuse local proofs within the source lease", async () => {
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
    // Expired entries are evicted, never served; the completed local stage
    // re-verifies the selection under the live caller's lease.
    const expired = new Set(memo.admins.values());
    const reverified = await later.admins(head, [genesis]);
    expect(
      reverified.policy.retainedHistory.map((entry) => entry.state.version),
    ).toEqual([1, 66]);
    expect([...memo.admins.values()].some((entry) => expired.has(entry))).toBe(
      false,
    );
    expect(f.requests).toHaveLength(count);
  } finally {
    f.close();
  }
});

test("additional directory citations keep the verified view within its source lease", async () => {
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
    // An expired view is evicted rather than served; rediscovery is refused.
    await expect(later.directory([reference])).rejects.toMatchObject({
      name: "PrincipalPolicyHistoryReadError",
    });
    await expect(later.directory([])).rejects.toMatchObject({
      name: "PrincipalPolicyHistoryReadError",
    });
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

test.each(["directory", "admins"] as const)(
  "a reused %s keeps its producer's lifetime after hand-out",
  async (kind) => {
    const f = await createAuthorityRecoveryFixture(history);
    try {
      const memo: PrincipalRecoveryMemo = {
        directories: new Map(),
        admins: new Map(),
      };
      let producerCurrent = true;
      const producer = createPrincipalRecoveryReader(
        { ...f.options, stillCurrent: () => producerCurrent },
        memo,
      );
      const consumer = createPrincipalRecoveryReader(f.options, memo);
      const read = (reader: typeof producer) =>
        kind === "directory"
          ? reader.directory([])
          : reader.admins(principalPolicyHead(history.admin));
      await read(producer);
      const count = f.requests.length;
      await read(consumer);
      expect(f.requests).toHaveLength(count);
      expect(consumer.stillCurrent()).toBe(true);
      // The consumer holds the producer's evidence; its use must end with it.
      producerCurrent = false;
      expect(consumer.stillCurrent()).toBe(false);
    } finally {
      f.close();
    }
  },
);
