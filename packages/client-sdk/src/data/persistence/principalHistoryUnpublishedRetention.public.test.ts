import { expect, test } from "bun:test";
import { signedRecoveryHistory } from "../../../test/helpers/principalHistoryRecovery";
import { createPublicHistoryFixture } from "../../../test/helpers/publicPrincipalHistory";
import { recoverPublicPrincipalHistory } from "../../workflows/principals/recoverPublicPrincipalHistory";
import { principalHistoryPrefixes } from "../sqlite/principalHistoryEvidenceSchema";
import { principalKeyEnvelopeArchive } from "../sqlite/principalHistoryRetentionSchema";
import { principalHistoryStages } from "../sqlite/principalHistoryStageSchema";

test("public attempts interrupted after completed acceptance stay bounded without losing the published prefix", async () => {
  const history = await signedRecoveryHistory(12);
  const bundles = history.bundle.previousStates.map((entry, index) => ({
    ...history.bundle,
    currentState: entry.state,
    currentProjection: entry.projection,
    currentGrants: entry.grants,
    previousStates: history.bundle.previousStates.slice(0, index),
  }));
  bundles.push(history.bundle);
  const previous = bundles[1];
  if (!previous) throw new Error("Missing published public head");
  const f = await createPublicHistoryFixture(history, bundles);
  const apiClient = f.client();
  const readPages = apiClient.getProjectionPolicyHistoryPages.bind(apiClient);
  apiClient.getProjectionPolicyHistoryPages = async function* (...args) {
    yield* readPages(...args);
    throw new Error("transport failed after its final accepted page");
  };
  try {
    const publishedOptions = { ...f.options, source: f.source(previous) };
    await recoverPublicPrincipalHistory(publishedOptions);
    const published = await f.db.select().from(principalHistoryPrefixes);
    expect(await f.db.select().from(principalHistoryStages)).toEqual([]);
    for (const bundle of bundles.slice(2))
      await expect(
        recoverPublicPrincipalHistory({
          ...f.options,
          apiClient,
          source: f.source(bundle),
        }),
      ).rejects.toThrow("transport failed after its final accepted page");
    const stages = await f.db.select().from(principalHistoryStages);
    expect(
      stages.map((stage) => stage.afterVersion + 1).sort((a, b) => a - b),
    ).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    expect(stages.every((stage) => stage.complete)).toBe(true);
    expect(await f.db.select().from(principalKeyEnvelopeArchive)).toEqual([]);
    expect(await f.db.select().from(principalHistoryPrefixes)).toEqual(
      published,
    );
    const requests = f.requests.length;
    const offline = await recoverPublicPrincipalHistory({
      ...publishedOptions,
      offline: true,
    });
    expect(offline.history.currentEntry.state.version).toBe(2);
    expect(f.requests).toHaveLength(requests);
    await recoverPublicPrincipalHistory(f.options);
    expect(
      (await f.db.select().from(principalHistoryStages)).map(
        (stage) => stage.afterVersion + 1,
      ),
    ).toEqual([11]);
    expect(
      (await f.db.select().from(principalHistoryPrefixes))[0]?.version,
    ).toBe(12);
    expect(await f.db.select().from(principalKeyEnvelopeArchive)).toEqual([]);
  } finally {
    f.close();
  }
}, 15_000);
