import { beforeAll, expect, test } from "bun:test";
import { verifyPrincipalPolicyHistoryReferences } from "@tearleads/crypto";
import { and, eq } from "drizzle-orm";
import { signedRecoveryHistory } from "../../../test/helpers/principalHistoryRecovery";
import { createPublicHistoryFixture } from "../../../test/helpers/publicPrincipalHistory";
import { isProjectionVerificationCancelledError } from "../../data/keyingProjectionVerification/types";
import { loadPrincipalHistoryReference } from "../../data/persistence/principalHistoryEvidencePersistence";
import {
  principalHistoryEntries,
  principalHistoryPrefixes,
} from "../../data/sqlite/principalHistoryEvidenceSchema";
import { principalHistoryStages } from "../../data/sqlite/principalHistoryStageSchema";
import { recoverPublicPrincipalHistory } from "./recoverPublicPrincipalHistory";

let history: Awaited<ReturnType<typeof signedRecoveryHistory>>;
beforeAll(async () => {
  history = await signedRecoveryHistory(67);
}, 30_000);

function earlier(version: number) {
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

test("public recovery extends durable prefixes and selects older heads without retaining full history", async () => {
  const previous = earlier(66);
  const f = await createPublicHistoryFixture(history, [previous]);
  try {
    await recoverPublicPrincipalHistory({
      ...f.options,
      source: f.source(previous),
    });
    f.requests.length = 0;
    const recovered = await recoverPublicPrincipalHistory({
      ...f.options,
      apiClient: f.client(),
    });
    expect(f.requests).toEqual([66]);
    expect(recovered.history.retainedEntries).toHaveLength(1);
    const proof = await loadPrincipalHistoryReference({
      execSql: f.options.execSql,
      scopeId: recovered.scopeId,
      history: recovered.history,
      version: 16,
    });
    const selected = await verifyPrincipalPolicyHistoryReferences({
      history: recovered.history,
      references: [proof],
    });
    expect(
      selected.ok &&
        selected.value.retainedEntries.map(({ state }) => state.version),
    ).toEqual([16, 67]);
    expect(await f.db.select().from(principalHistoryStages)).toEqual([]);
    expect(
      (await f.db.select().from(principalHistoryPrefixes)).map(
        (row) => row.currentJson,
      ),
    ).toEqual(["null"]);
    f.requests.length = 0;
    const older = await recoverPublicPrincipalHistory({
      ...f.options,
      source: f.source(previous),
    });
    expect(older.history.currentEntry.state.version).toBe(67);
    expect(f.requests).toEqual([65]);
    expect(
      (await f.db.select().from(principalHistoryPrefixes))[0]?.version,
    ).toBe(67);
  } finally {
    f.close();
  }
});

test("interrupted public recovery resumes verified progress with a new transport", async () => {
  const f = await createPublicHistoryFixture(history);
  try {
    f.controls.failAfter = 32;
    await expect(
      recoverPublicPrincipalHistory(f.options),
    ).rejects.toMatchObject({ name: "PrincipalPolicyHistoryReadError" });
    expect(f.requests).toEqual([0, 32]);
    expect(
      (await f.db.select().from(principalHistoryStages))[0]?.afterVersion,
    ).toBe(32);
    f.controls.failAfter = null;
    f.requests.length = 0;
    await recoverPublicPrincipalHistory({
      ...f.options,
      apiClient: f.client(),
    });
    expect(f.requests).toEqual([32, 64]);
    expect(await f.db.select().from(principalHistoryStages)).toEqual([]);
  } finally {
    f.close();
  }
});

test("offline public recovery requires the private key and rekeying reuses public rows", async () => {
  const f = await createPublicHistoryFixture(history);
  try {
    await recoverPublicPrincipalHistory(f.options);
    const entries = await f.db.select().from(principalHistoryEntries);
    f.requests.length = 0;
    await recoverPublicPrincipalHistory({ ...f.options, offline: true });
    const protection = {
      ...f.options.protection,
      localKey: new Uint8Array(32).fill(8),
    };
    await expect(
      recoverPublicPrincipalHistory({
        ...f.options,
        protection,
        offline: true,
      }),
    ).rejects.toMatchObject({ code: "missing_dependency" });
    await recoverPublicPrincipalHistory({ ...f.options, offline: true });
    expect(f.requests).toEqual([]);
    await recoverPublicPrincipalHistory({ ...f.options, protection });
    expect(f.requests).toEqual([0, 32, 64]);
    expect((await f.db.select().from(principalHistoryEntries)).length).toBe(
      entries.length,
    );
    expect(await f.db.select().from(principalHistoryPrefixes)).toHaveLength(1);
  } finally {
    f.close();
  }
});

test("public recovery authenticates stored source proofs and replays lost evidence once", async () => {
  const previous = earlier(66);
  const f = await createPublicHistoryFixture(history, [previous]);
  try {
    const result = await recoverPublicPrincipalHistory(f.options);
    const rows = await f.db.select().from(principalHistoryEntries);
    const row = rows.find(
      (candidate) => JSON.parse(candidate.entryJson).state.version === 66,
    );
    if (!row) throw new Error("Missing source entry");
    const entry = JSON.parse(row.entryJson);
    entry.state.signature = history.bundle.currentState.signature;
    await f.db
      .update(principalHistoryEntries)
      .set({ entryJson: JSON.stringify(entry) })
      .where(
        and(
          eq(principalHistoryEntries.scopeId, result.scopeId),
          eq(principalHistoryEntries.leafHash, row.leafHash),
        ),
      )
      .run();
    const options = { ...f.options, source: f.source(previous) };
    await expect(
      recoverPublicPrincipalHistory({ ...options, offline: true }),
    ).rejects.toThrow("proof root does not match");
    f.requests.length = 0;
    await recoverPublicPrincipalHistory(options);
    expect(f.requests).toEqual([65, 0, 32, 64]);
    f.requests.length = 0;
    await recoverPublicPrincipalHistory(options);
    expect(f.requests).toEqual([65]);
  } finally {
    f.close();
  }
});

test("strict public Admins verification cannot reuse a general history prefix", async () => {
  const signed = await signedRecoveryHistory(4, (version, userId) => [
    { userId, role: "admin" },
    ...(version === 1
      ? [{ userId: "other-user", role: "member" as const }]
      : []),
  ]);
  const f = await createPublicHistoryFixture(signed);
  try {
    await recoverPublicPrincipalHistory(f.options);
    f.requests.length = 0;
    await expect(
      recoverPublicPrincipalHistory({ ...f.options, strictAdmins: true }),
    ).rejects.toThrow("only direct admin users");
    expect(f.requests).toEqual([0]);
  } finally {
    f.close();
  }
});

test("a warm public prefix checks the returned head artifact against its private root", async () => {
  const f = await createPublicHistoryFixture(history);
  try {
    await recoverPublicPrincipalHistory(f.options);
    f.controls.mutate = (page) => {
      page.currentState.signature =
        history.bundle.previousStates[0]?.state.signature ?? "";
    };
    f.requests.length = 0;
    await expect(recoverPublicPrincipalHistory(f.options)).rejects.toThrow(
      "proof root does not match",
    );
    expect(f.requests).toEqual([66]);
  } finally {
    f.close();
  }
});

test("public recovery stops page publication when its lifetime ends", async () => {
  const f = await createPublicHistoryFixture(history);
  try {
    let current = true;
    f.controls.mutate = (page) => {
      if (page.historyPage.afterVersion === 32) current = false;
    };
    const error = await recoverPublicPrincipalHistory({
      ...f.options,
      stillCurrent: () => current,
    }).catch((error: unknown) => error);
    expect(isProjectionVerificationCancelledError(error)).toBe(true);
    expect(
      (await f.db.select().from(principalHistoryStages))[0]?.afterVersion,
    ).toBe(32);
    expect(await f.db.select().from(principalHistoryPrefixes)).toEqual([]);
    f.controls.mutate = null;
    f.requests.length = 0;
    await recoverPublicPrincipalHistory(f.options);
    expect(f.requests).toEqual([32, 64]);
  } finally {
    f.close();
  }
});
