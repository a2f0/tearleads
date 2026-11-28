import { beforeAll, expect, test } from "bun:test";
import { principalHistoryIndexLeaf } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { signedRecoveryHistory } from "../../../../test/helpers/data/principalHistoryRecovery";
import { createPublicHistoryFixture } from "../../../../test/helpers/data/publicPrincipalHistory";
import { PrincipalPolicyBundleRepository } from "../../../data/persistence/principalPolicy/principalPolicyBundleRepository";
import { writePrincipalPolicyBundleInTransaction } from "../../../data/persistence/principalPolicy/principalPolicyPersistence";
import {
  principalHistoryEntries,
  principalHistoryEvidenceTables,
} from "../../../data/sqlite/schema/principalHistoryEvidenceSchema";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../../data/sqlite/sqlSchema";
import { recoverPublicPrincipalHistory } from "./recoverPublicPrincipalHistory";

let history: Awaited<ReturnType<typeof signedRecoveryHistory>>;
beforeAll(async () => {
  history = await signedRecoveryHistory(67);
}, 30_000);

async function holdBundle(
  options: {
    execSql: ExecSql;
    organizationId: string;
  },
  bundle: PrincipalPolicyBundleResponse,
) {
  await new PrincipalPolicyBundleRepository(
    options.execSql,
  ).ensurePrincipalPolicyTables();
  await getClientSQLitePersistenceRuntime(options.execSql).transaction((tx) =>
    writePrincipalPolicyBundleInTransaction(
      tx,
      bundle,
      new Date().toISOString(),
      options.organizationId,
    ),
  );
}

async function holdHeadEntryOnly(
  options: {
    execSql: ExecSql;
    organizationId: string;
  },
  bundle: PrincipalPolicyBundleResponse,
) {
  await ensureSqlTables(options.execSql, principalHistoryEvidenceTables);
  const entry = {
    state: bundle.currentState,
    projection: bundle.currentProjection,
    grants: bundle.currentGrants,
  };
  await getClientSQLitePersistenceRuntime(options.execSql)
    .db.insert(principalHistoryEntries)
    .values({
      scopeId: "other-scope",
      organizationId: options.organizationId,
      leafHash: await principalHistoryIndexLeaf(entry.state),
      entryJson: JSON.stringify(entry),
    })
    .run();
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

test("public recovery verifies a complete held bundle chain without network requests", async () => {
  const f = await createPublicHistoryFixture(history);
  try {
    await holdBundle(f.options, history.bundle);
    const recovered = await recoverPublicPrincipalHistory(f.options);
    expect(recovered.history.currentEntry.state).toEqual(
      history.bundle.currentState,
    );
    expect(f.requests).toEqual([]);
    expect(f.knownHashes).toEqual([]);
  } finally {
    f.close();
  }
});

test("public recovery verifies an earlier head from a newer cached bundle without network requests", async () => {
  const previous = earlier(66);
  const f = await createPublicHistoryFixture(history, [previous]);
  try {
    await holdBundle(f.options, history.bundle);
    const recovered = await recoverPublicPrincipalHistory({
      ...f.options,
      source: f.source(previous),
    });
    expect(recovered.history.currentEntry.state).toEqual(previous.currentState);
    expect(f.requests).toEqual([]);
    expect(f.knownHashes).toEqual([]);
  } finally {
    f.close();
  }
});

test("public recovery names a held head when only the head entry is stored locally", async () => {
  const f = await createPublicHistoryFixture(history);
  try {
    await holdHeadEntryOnly(f.options, history.bundle);
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
    // Verified earlier held pages stay staged; only the head page is fetched.
    expect(f.requests).toEqual([64]);
    expect(f.knownHashes).toEqual([null]);
  } finally {
    f.close();
  }
});

test("a tampered held history prefix never verifies and falls back online", async () => {
  const f = await createPublicHistoryFixture(history);
  try {
    const first = history.bundle.previousStates[0];
    const second = history.bundle.previousStates[1];
    if (!first || !second) throw new Error("Missing signed fixture entries");
    await holdBundle(f.options, {
      ...history.bundle,
      previousStates: [
        {
          ...first,
          state: { ...first.state, signature: second.state.signature },
        },
        ...history.bundle.previousStates.slice(1),
      ],
    });
    const recovered = await recoverPublicPrincipalHistory(f.options);
    expect(recovered.history.currentEntry.state).toEqual(
      history.bundle.currentState,
    );
    expect(f.requests).toEqual([0, 32, 64]);
    expect(f.knownHashes).toEqual([null, null, null]);
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
