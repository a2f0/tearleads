import { beforeAll, expect, test } from "bun:test";
import {
  computePrincipalStateHash,
  signPrincipalState,
} from "@tearleads/crypto";
import { signedRecoveryHistory } from "../../../test/helpers/principalHistoryRecovery";
import { createPublicHistoryFixture } from "../../../test/helpers/publicPrincipalHistory";
import { principalHistoryPrefixes } from "../../data/sqlite/principalHistoryEvidenceSchema";
import { recoverPublicPrincipalHistory } from "./recoverPublicPrincipalHistory";

let history: Awaited<ReturnType<typeof signedRecoveryHistory>>;
let fork: typeof history;
beforeAll(async () => {
  history = await signedRecoveryHistory();
  fork = await signedRecoveryHistory(32);
});

async function cachedFork(genuine = history, cached = fork) {
  const f = await createPublicHistoryFixture(genuine, [cached.bundle]);
  try {
    await recoverPublicPrincipalHistory({
      ...f.options,
      source: f.source(cached.bundle),
      resolveTrustedUserIdentity: cached.resolveTrustedUserIdentity,
    });
    f.requests.length = 0;
    return f;
  } catch (error) {
    f.close();
    throw error;
  }
}

test("a lower genuine source replaces a higher disconnected prefix for warm and offline recovery", async () => {
  const f = await cachedFork(fork, history);
  try {
    const recovered = await recoverPublicPrincipalHistory(f.options);
    expect(recovered.history.currentEntry.state.stateHash).toBe(
      fork.expectedHead.stateHash,
    );
    expect(f.requests).toEqual([31, 0]);
    expect(
      (await f.db.select().from(principalHistoryPrefixes)).map(
        (row) => row.version,
      ),
    ).toEqual([32]);
    f.requests.length = 0;
    await recoverPublicPrincipalHistory(f.options);
    expect(f.requests).toEqual([31]);
    f.requests.length = 0;
    const offline = await recoverPublicPrincipalHistory({
      ...f.options,
      offline: true,
    });
    expect(offline.history.currentEntry.state.stateHash).toBe(
      fork.expectedHead.stateHash,
    );
    expect(f.requests).toEqual([]);
  } finally {
    f.close();
  }
});

test("a disconnected public prefix replays once online and remains unavailable offline", async () => {
  const f = await cachedFork();
  try {
    await expect(
      recoverPublicPrincipalHistory({ ...f.options, offline: true }),
    ).rejects.toMatchObject({ code: "missing_dependency" });
    expect(f.requests).toEqual([]);
    const recovered = await recoverPublicPrincipalHistory(f.options);
    expect(recovered.history.currentEntry.state.stateHash).toBe(
      history.expectedHead.stateHash,
    );
    expect(f.requests).toEqual([32, 0, 32, 64]);
    expect(
      (await f.db.select().from(principalHistoryPrefixes)).map(
        (row) => row.version,
      ),
    ).toEqual([66]);
    f.requests.length = 0;
    await recoverPublicPrincipalHistory(f.options);
    expect(f.requests).toEqual([65]);
  } finally {
    f.close();
  }
});

test("a failed lower-source replay preserves the cached candidate", async () => {
  const f = await cachedFork(fork, history);
  try {
    const before = await f.db.select().from(principalHistoryPrefixes);
    f.controls.mutate = (page) => {
      if (page.historyPage.afterVersion === 0)
        page.currentState.signature = history.bundle.currentState.signature;
    };
    await expect(recoverPublicPrincipalHistory(f.options)).rejects.toThrow();
    expect(f.requests).toEqual([31, 0]);
    expect(await f.db.select().from(principalHistoryPrefixes)).toEqual(before);
  } finally {
    f.close();
  }
});

test("a resumed lower-source replay also replaces its rejected higher prefix", async () => {
  const higherFork = await signedRecoveryHistory(99);
  const f = await cachedFork(history, higherFork);
  try {
    f.controls.failAfter = 32;
    await expect(
      recoverPublicPrincipalHistory(f.options),
    ).rejects.toMatchObject({
      name: "PrincipalPolicyHistoryReadError",
    });
    expect(f.requests).toEqual([65, 0, 32]);
    f.controls.failAfter = null;
    f.requests.length = 0;
    await recoverPublicPrincipalHistory(f.options);
    expect(f.requests).toEqual([32, 64]);
    expect(
      (await f.db.select().from(principalHistoryPrefixes)).map(
        (row) => row.version,
      ),
    ).toEqual([66]);
    f.requests.length = 0;
    await recoverPublicPrincipalHistory({ ...f.options, offline: true });
    expect(f.requests).toEqual([]);
  } finally {
    f.close();
  }
});

test.each([false, true])(
  "a disconnected fresh page stops after a bounded replay: cached=%s",
  async (cached) => {
    const f = cached
      ? await cachedFork()
      : await createPublicHistoryFixture(history);
    try {
      const entry = history.bundle.previousStates[32];
      if (!entry) throw new Error("Missing page entry");
      const signed = await signPrincipalState(
        { ...entry.state, prevStateHash: "f".repeat(64) },
        history.signingPrivateKey,
      );
      const disconnected = {
        ...entry,
        state: {
          ...signed,
          stateHash: await computePrincipalStateHash(signed),
          createdAt: entry.state.createdAt,
        },
      };
      f.controls.mutate = (page) => {
        if (page.historyPage.afterVersion === 32)
          page.previousStates[0] = disconnected;
      };
      await expect(
        recoverPublicPrincipalHistory(f.options),
      ).rejects.toMatchObject({ code: "stale_predecessor" });
      expect(f.requests).toEqual(cached ? [32, 0, 32] : [0, 32]);
      expect(
        (await f.db.select().from(principalHistoryPrefixes)).map(
          (row) => row.version,
        ),
      ).toEqual(cached ? [32] : []);
    } finally {
      f.close();
    }
  },
);

test("cached public recovery preserves transport and lifetime failures without replay", async () => {
  const f = await cachedFork();
  try {
    f.controls.failAfter = 32;
    await expect(
      recoverPublicPrincipalHistory(f.options),
    ).rejects.toMatchObject({ name: "PrincipalPolicyHistoryReadError" });
    expect(f.requests).toEqual([32]);
    f.controls.failAfter = null;
    f.requests.length = 0;
    let current = true;
    f.controls.mutate = () => {
      current = false;
    };
    await expect(
      recoverPublicPrincipalHistory({
        ...f.options,
        stillCurrent: () => current,
      }),
    ).rejects.toMatchObject({ name: "ProjectionVerificationCancelledError" });
    expect(f.requests).toEqual([32]);
  } finally {
    f.close();
  }
});
