import { beforeAll, expect, test } from "bun:test";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { signedRecoveryHistory } from "../../../../test/helpers/principalHistoryRecovery";
import { createPublicHistoryFixture } from "../../../../test/helpers/publicPrincipalHistory";
import {
  ensurePrincipalPolicyTables,
  writePrincipalPolicyBundleInTransaction,
} from "../../../data/persistence/principalPolicy/principalPolicyPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import { recoverPublicPrincipalHistory } from "./recoverPublicPrincipalHistory";

let history: Awaited<ReturnType<typeof signedRecoveryHistory>>;
beforeAll(async () => {
  history = await signedRecoveryHistory(67);
}, 30_000);

async function holdBundle(
  options: {
    execSql: Parameters<typeof ensurePrincipalPolicyTables>[0];
    organizationId: string;
  },
  bundle: PrincipalPolicyBundleResponse,
) {
  await ensurePrincipalPolicyTables(options.execSql);
  await getClientSQLitePersistenceRuntime(options.execSql).transaction((tx) =>
    writePrincipalPolicyBundleInTransaction(
      tx,
      bundle,
      new Date().toISOString(),
      options.organizationId,
    ),
  );
}

function earlier(version: number): PrincipalPolicyBundleResponse {
  const entry = history.bundle.previousStates[version - 1];
  if (!entry) throw new Error("Missing signed fixture head");
  return {
    ...history.bundle,
    currentState: entry.state,
    currentProjection: entry.projection,
    currentGrants: entry.grants,
    previousStates: history.bundle.previousStates.slice(0, version - 1),
  };
}

test("public recovery names a held head and verifies that copy", async () => {
  const f = await createPublicHistoryFixture(history);
  try {
    await holdBundle(f.options, history.bundle);
    const recovered = await recoverPublicPrincipalHistory(f.options);
    expect(recovered.history.currentEntry.state).toEqual(
      history.bundle.currentState,
    );
    expect(f.requests).toEqual([0, 32, 64]);
    expect(f.knownHashes).toEqual(
      Array(3).fill(history.bundle.currentState.stateHash),
    );
  } finally {
    f.close();
  }
});

test("public recovery finds a held head inside a newer cached chain", async () => {
  const previous = earlier(66);
  const f = await createPublicHistoryFixture(history, [previous]);
  try {
    await holdBundle(f.options, history.bundle);
    await recoverPublicPrincipalHistory({
      ...f.options,
      source: f.source(previous),
    });
    expect(f.knownHashes).toEqual(
      Array(3).fill(previous.currentState.stateHash),
    );
  } finally {
    f.close();
  }
});

test("a rejected held head never verifies and falls back to the served one", async () => {
  const f = await createPublicHistoryFixture(history);
  try {
    // Same exact reference, but signed bytes that do not authenticate it.
    await holdBundle(f.options, {
      ...history.bundle,
      currentState: {
        ...history.bundle.currentState,
        signature: history.bundle.previousStates[0]?.state.signature ?? "",
      },
    });
    const recovered = await recoverPublicPrincipalHistory(f.options);
    expect(recovered.history.currentEntry.state.signature).toBe(
      history.bundle.currentState.signature,
    );
    // Verified earlier pages stay staged; only the head page is read again.
    const hash = history.bundle.currentState.stateHash;
    expect(f.requests).toEqual([0, 32, 64, 64]);
    expect(f.knownHashes).toEqual([hash, hash, hash, null]);
  } finally {
    f.close();
  }
});

test("a device without the head names none", async () => {
  const f = await createPublicHistoryFixture(history);
  try {
    await recoverPublicPrincipalHistory(f.options);
    expect(f.knownHashes).toEqual([null, null, null]);
  } finally {
    f.close();
  }
});
